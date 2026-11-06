"""Loopback-only HTTP API for the existing Swnw dashboard. Python standard library."""
import json
import os
import socket
import socketserver
import stat
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from auth import Auth
from runtime import Codex, ClaudeChat, RuntimeFailure, Unsupported
import uploads
import knowledge
from store import Store, Denied, Invalid, ENGINES

PREFIX='/api/digital-team'

class Service:
    def __init__(self, store, auth, runtime=None, shared_codex=False, claude=None, knowledge_base=None):
        self.store,self.auth,self.runtime,self.shared_codex=store,auth,runtime,shared_codex
        self.engines={k:v for k,v in (('codex',runtime),('claude',claude)) if v}
        self.tokens={}; self.tokens_lock=threading.Lock()
        self.knowledge_base=knowledge_base; self.build_hints={}  # hints only: never used for permissions

    def available(self, agent, actor):
        # Claude Code runs on the owner's personal subscription: owner-only, never shared via a flag.
        if agent not in self.engines:return False
        return actor.owner or (agent=='codex' and (self.shared_codex or self.store.employees_enabled()))

    def handle(self, method, path, token, data=None):
        a=self.auth.actor(token);self.store.remember(a)
        data=data or {}; u=urlsplit(path); parts=u.path.removeprefix(PREFIX).strip('/').split('/')
        directory=lambda:self.store.directory(a,self.auth.directory(token,a) if a.owner else [])
        if method=='GET' and parts==['bootstrap']:
            out=self.store.bootstrap(a)
            for agent in out['agents']:
                if agent['code'] in ENGINES:
                    agent['connected']=self.available(agent['code'],a)
            return out
        if method=='GET' and parts==['users']:
            return {'users':directory()}
        if parts==['grants']:
            if method=='GET':return {'grants':self.store.grants(a)}
            if method=='POST':
                self.store.set_grant(a,data,directory());return {'ok':True}
        if parts==['rooms']:
            if method=='GET':return {'rooms':self.store.rooms(a)}
            if method=='POST':return {'id':self.store.create(a,data,directory())}
        if parts==['employees']:
            if method=='GET':return self.store.employees_info(a)
            if method=='POST':return self.store.set_employees(a,data)
        if parts==['limit']:
            if method=='GET':return self.store.limit_info(a)
            if method=='POST':return self.store.set_limit(a,data.get('limit'))
        if method=='GET' and parts==['export']:
            q=parse_qs(u.query);g=lambda k:q.get(k,[None])[0]
            return self.store.export(a,g('from'),g('to'),g('room'))
        if len(parts)>=2 and parts[0]=='rooms':
            room=parts[1]
            if len(parts)==3 and parts[2]=='messages':
                if method=='GET':return self.store.history(a,room,parse_qs(u.query).get('before',[None])[0])
                if method=='POST':
                    targets=data.get('targets',[])
                    targets=targets if isinstance(targets,list) else []
                    wanted=[x for x in targets if x in ENGINES]
                    if not wanted and len(self.store.room_agents(room))==1 and self.store.room_agents(room)[0] in ENGINES:
                        wanted=self.store.room_agents(room)
                    for engine in wanted:
                        if not self.available(engine,a):
                            raise Invalid('ربط المحرك لهذا الحساب لم يُفعّل بعد')
                    out=self.store.send(a,room,data)
                    # Token kept in RAM only for re-verifying queued work; never persist it or pass it to Codex.
                    with self.tokens_lock:
                        self.tokens[(room,a.id)]=(token,time.time()+240)
                    self.build_hints[(room,a.id)]=str(data.get('client_build',''))[:40]
                    return out
            if len(parts)==3 and parts[2]=='attachments' and method=='POST':
                return self.store.add_attachment(a,room,data)
            if len(parts)==3 and parts[2]=='members':
                if method=='GET':return {'members':self.store.members(a,room),'agents':self.store.room_agents(room)}
                if method=='POST':
                    self.store.set_members(a,room,data,directory());return {'ok':True}
            if len(parts)==4 and parts[2]=='cancel' and method=='POST':
                self.store.cancel(a,room,parts[3]);return {'ok':True}
        raise Invalid('مسار غير مدعوم')

    def work_once(self):
        job=self.store.claim()
        if not job:return False
        try:
            with self.tokens_lock:
                saved=self.tokens.get((job['room'],job['user_id']))
            if not saved or saved[1]<time.time():
                raise RuntimeFailure('انتهت جلسة الطلب؛ أرسل رسالة جديدة بعد تسجيل الدخول')
            actor=self.auth.actor(saved[0])
            with self.store.lock:
                self.store.membership(actor,job['room'],send=True)
            engine=self.engines.get(job['agent'])
            if not engine or not self.available(job['agent'],actor):
                raise RuntimeFailure('المحرك غير متصل لهذا الحساب')
            history,thread=self.store.context(job)
            history=self.with_knowledge(history,actor,saved[0],job)
            def cancelled():
                with self.store.lock:
                    if not self.store.current(job):return True
                    try:self.store.membership(actor,job['room'],send=True)
                    except Denied:return True
                return False
            files=self.store.job_attachments(job)
            extra={'attachments':files} if files else {}  # engines without file support never see the kwarg
            answer=engine.answer(history,thread,lambda t:self.store.session(job,t),
                lambda text:self.store.progress(job,text),cancelled,**extra)
            self.store.finish(job,answer)
        except Unsupported as e:
            # Clear, user-facing reason (e.g. engine cannot read PDFs); the file is never silently ignored.
            self.store.finish(job,error=str(e))
        except (Denied,Invalid,RuntimeFailure):
            self.store.finish(job,error='تعذر إكمال الرد؛ تحقق من الاتصال والصلاحية ثم أرسل رسالة جديدة')
        except Exception:
            # Never expose stack traces, credential values, internal paths, or raw model errors to users.
            self.store.finish(job,error='تعذر تشغيل المحرك؛ يحتاج مراجعة المشغل')
        finally:
            with self.tokens_lock:
                self.tokens={k:v for k,v in self.tokens.items() if v[1]>time.time()}
        return True

    def with_knowledge(self, history, actor, token, job):
        """Phase 1 Sono knowledge: server-side filtered, labelled DATA entry prepended to the engine input."""
        kb=self.knowledge_base
        if kb is None:return history
        try:
            if actor.owner:viewer=knowledge.Viewer(owner=True)
            else:viewer=knowledge.Viewer(owner=False,roles=tuple(self.auth.viewer_roles(token,actor.id) or ()))
            question=history[-1]['body'] if history else ''
            hint=self.build_hints.get((job['room'],job['user_id']))
            return [kb.context_entry(viewer,question,hint)]+list(history)
        except Exception:
            return [{'name':'مرجع-النظام','kind':'reference_data','body':'حزمة المعرفة غير متاحة الآن؛ قل ذلك صراحة ولا تجب من الذاكرة عن شاشات الداشبورد.'}]+list(history)

    def worker(self):
        while True:
            if not self.work_once():time.sleep(.4)


def handler(service,origin):
    origins={x.strip() for x in origin.split(',') if x.strip()}
    class Handler(BaseHTTPRequestHandler):
        server_version='SwnwChat/1'
        def setup(self):
            super().setup()
            self.connection.settimeout(10)
        def log_message(self,*args):pass
        def respond(self,status,value):
            raw=json.dumps(value,ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Length',str(len(raw)))
            self.end_headers();self.wfile.write(raw)
        def do_GET(self):self.dispatch()
        def do_POST(self):self.dispatch()
        def dispatch(self):
            try:
                if self.headers.get('Origin') not in (None,*origins):raise Denied('مصدر الطلب غير مصرح به')
                if self.headers.get('Sec-Fetch-Site')=='cross-site':raise Denied('مصدر الطلب غير مصرح به')
                if not self.path.startswith(PREFIX+'/'):raise Invalid('مسار غير مدعوم')
                auth=self.headers.get('Authorization','')
                if not auth.startswith('Bearer '):raise Denied('سجّل الدخول أولًا')
                data=None
                if self.command=='POST':
                    if self.headers.get('Content-Type','').split(';')[0]!='application/json':raise Invalid('JSON مطلوب')
                    size=int(self.headers.get('Content-Length','0'))
                    upload=self.path.split('?')[0].rstrip('/').endswith('/attachments')
                    message=self.path.split('?')[0].rstrip('/').endswith('/messages')
                    limit=uploads.MAX_REQUEST if upload else uploads.MAX_MESSAGE_REQUEST if message else 24000
                    if not 1<=size<=limit:raise Invalid('حجم الطلب غير صالح' if not message else 'الرسالة أكبر من الحد التقني؛ قسّمها أو أرفقها كملف نصي')
                    data=json.loads(self.rfile.read(size))
                    if not isinstance(data,dict):raise Invalid('طلب غير صالح')
                self.respond(200,service.handle(self.command,self.path,auth[7:],data))
            except Denied as e:self.respond(403,{'error':str(e)})
            except (Invalid,ValueError,TypeError,json.JSONDecodeError) as e:self.respond(400,{'error':str(e)[:240]})
            except Exception:self.respond(503,{'error':'خدمة المحادثات غير متاحة'})
    return Handler


class UnixServer(ThreadingHTTPServer):
    """HTTP over a Unix socket (no TCP port at all). Directory/mode decide who may connect."""
    address_family=socket.AF_UNIX
    def server_bind(self):
        path=self.server_address
        try:
            if stat.S_ISSOCK(os.lstat(path).st_mode):os.unlink(path)
        except FileNotFoundError:pass
        socketserver.TCPServer.server_bind(self)
        os.chmod(path,0o660)
        self.server_name,self.server_port='unix',0
    def get_request(self):
        request,_=self.socket.accept()
        return request,('unix',0)


def main():
    os.umask(0o077)
    state=Path(os.environ['SWNW_CHAT_STATE']).resolve();state.mkdir(mode=0o700,parents=True,exist_ok=True)
    auth=Auth(os.environ['SWNW_CHAT_SUPABASE_URL'],os.environ['SWNW_CHAT_SUPABASE_ANON_KEY'])
    runtime=None
    if os.environ.get('SWNW_CHAT_CODEX_ENABLED')=='1':
        # Operator must run and retain installed-version protocol/isolation checks before enabling.
        runtime=Codex(os.environ['SWNW_CHAT_CODEX_BIN'],os.environ['SWNW_CHAT_WORKSPACE'],os.environ['SWNW_CHAT_SHARED_LOCK'])
    claude=None
    if os.environ.get('SWNW_CHAT_CLAUDE_ENABLED')=='1':
        claude=ClaudeChat(os.environ['SWNW_CHAT_CLAUDE_BIN'],os.environ['SWNW_CHAT_WORKSPACE'],code_dir=os.environ.get('SWNW_CHAT_CODE_DIR') or None)
    kb=None
    if os.environ.get("SWNW_CHAT_KNOWLEDGE_DIR"):
        kb=knowledge.Knowledge(os.environ["SWNW_CHAT_KNOWLEDGE_DIR"],os.environ.get("SWNW_CHAT_RELEASE_ID"),os.environ.get("SWNW_CHAT_RELEASE_FILE"))
    service=Service(Store(str(state/"chat.sqlite3")),auth,runtime,os.environ.get("SWNW_CHAT_SHARED_CODEX")=="1",claude,kb)
    threading.Thread(target=service.worker,daemon=True).start()
    sock=os.environ.get('SWNW_CHAT_SOCKET')
    if sock:
        server=UnixServer(sock,handler(service,os.environ['SWNW_CHAT_ORIGIN']))
    else:
        server=ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('SWNW_CHAT_PORT','18092'))),handler(service,os.environ['SWNW_CHAT_ORIGIN']))
    server.serve_forever()

if __name__=='__main__':main()
