"""Bounded Codex app-server stdio adapter. Never expose JSON-RPC to the browser."""
import fcntl
import json
import os
import queue
import signal
import subprocess
import threading
import time
import uuid
import re
import tomllib
from pathlib import Path

class RuntimeFailure(Exception):
    pass

class Codex:
    def __init__(self, binary, workspace, lock_path, timeout=180):
        self.binary=str(Path(binary).resolve(strict=True))
        self.workspace=str(Path(workspace).resolve(strict=True))
        self.lock_path=lock_path
        self.timeout=timeout

    def answer(self, history, thread, on_thread, progress, cancelled):
        # Same configured lock inode must be used by the existing Issue runner.
        with open(self.lock_path,'a') as lock:
            try:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeFailure('السيرفر ينفّذ مهمة أخرى؛ حاول بعد انتهائها') from None
            return self._answer(history,thread,on_thread,progress,cancelled)

    def _answer(self, history, thread, on_thread, progress, cancelled):
        disabled=['shell_tool','unified_exec','apps','plugins','multi_agent','computer_use','browser_use',
                  'browser_use_external','code_mode_host','hooks','memories','image_generation','view_image']
        args=[self.binary,'app-server','--listen','stdio://']
        for feature in disabled:
            args += ['-c','features.'+feature+'=false']
        config_path=Path(os.environ.get('CODEX_HOME',str(Path.home()/'.codex')))/'config.toml'
        if config_path.is_file():
            with config_path.open('rb') as config_file:
                config=tomllib.load(config_file)
            for name in config.get('mcp_servers',{}):
                if not re.fullmatch(r'[A-Za-z0-9_-]+',name):
                    raise RuntimeFailure('اسم تكامل غير مدعوم؛ يلزم ملف إعداد مخصص للمحادثات')
                args += ['-c',f'mcp_servers.{name}.enabled=false']
        args += ['-c','web_search="disabled"','-c','sandbox_mode="read-only"','-c','approval_policy="never"',
                 '-c','shell_environment_policy.inherit="none"']
        # The operator must verify no inherited MCP/hook integrations before enabling this service.
        # Do not pass incoming JWTs, service credentials, or arbitrary frontend configuration.
        env={k:v for k,v in os.environ.items() if k in ('PATH','HOME','CODEX_HOME','LANG','SSL_CERT_FILE','SSL_CERT_DIR','HTTP_PROXY','HTTPS_PROXY','NO_PROXY')}
        proc=subprocess.Popen(args,cwd=self.workspace,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL,text=True,env=env,start_new_session=True,bufsize=1)
        incoming=queue.Queue()
        def reader():
            try:
                for line in proc.stdout:
                    if len(line)>1000000:
                        incoming.put(RuntimeFailure('استجابة المحرك تتجاوز الحد'));break
                    incoming.put(json.loads(line))
            except (ValueError,OSError):
                incoming.put(RuntimeFailure('تعذر قراءة استجابة المحرك'))
            finally:
                incoming.put(None)
        threading.Thread(target=reader,daemon=True).start()
        serial=0; deadline=time.monotonic()+self.timeout; backlog=[]
        def send(value):
            proc.stdin.write(json.dumps(value,ensure_ascii=False)+'\n');proc.stdin.flush()
        def recv():
            while True:
                if cancelled():
                    raise RuntimeFailure('أُوقف الطلب')
                if time.monotonic()>deadline:
                    raise RuntimeFailure('انتهت مهلة المحادثة؛ أعد المحاولة بعد المراجعة')
                try:
                    value=incoming.get(timeout=.2)
                    if value is None or isinstance(value,Exception):
                        raise RuntimeFailure('توقف محرك Codex')
                    # Fail closed on tool calls/permission requests. No generic RPC proxy or approval bypass.
                    if 'method' in value and 'id' in value:
                        send({'id':value['id'],'error':{'code':-32601,'message':'Unavailable in dashboard conversation'}})
                        raise RuntimeFailure('هذا الطلب يحتاج مسار تنفيذ معتمد خارج محادثة القراءة')
                    return value
                except queue.Empty:
                    continue
        def call(method,params):
            nonlocal serial
            serial+=1; sid=serial
            send({'id':sid,'method':method,'params':params})
            while True:
                value=recv()
                if value.get('id')==sid:
                    if 'error' in value:
                        raise RuntimeFailure('المحرك رفض الطلب؛ راجع توافق الإعداد وتسجيل الدخول')
                    return value.get('result',{})
                backlog.append(value)
        try:
            call('initialize',{'clientInfo':{'name':'swnw_digital_team','title':'Swnw Digital Team','version':'1.0.0'}})
            send({'method':'initialized','params':{}})
            params={'cwd':self.workspace,'approvalPolicy':'never','sandbox':'read-only'}
            if thread:
                params['threadId']=thread
                result=call('thread/resume',params)
            else:
                params['developerInstructions']='أنت Codex في محادثة سونو. أجب بالعربية. هذه قناة نقاش للقراءة فقط، ولا تنفذ أوامر أو تتصل بأي أداة أو مصدر خارجي. لا تدّع تنفيذ مهمة. ناقش فقط الرسائل المقدمة. طلبات التنفيذ تنتظر مسار المالك.'
                result=call('thread/start',params)
            thread_id=result.get('thread',{}).get('id')
            if not thread_id:
                raise RuntimeFailure('لم يتم إنشاء جلسة Codex')
            on_thread(thread_id)
            # Send only the latest message when resuming. New threads receive only common-visible history.
            context=history
            prompt=json.dumps(context,ensure_ascii=False)
            turn=call('turn/start',{'threadId':thread_id,'input':[{'type':'text','text':prompt}],
                'approvalPolicy':'never','sandboxPolicy':{'type':'readOnly','networkAccess':False}})
            tid=turn.get('turn',{}).get('id'); text=''; item_text={}
            while True:
                v=backlog.pop(0) if backlog else recv()
                method=v.get('method'); p=v.get('params',{})
                if p.get('threadId') not in (None,thread_id):
                    continue
                if method=='item/agentMessage/delta':
                    text+=str(p.get('delta',''))
                    if len(text)>24000:
                        raise RuntimeFailure('الرد يتجاوز الحد')
                    progress(text)
                elif method=='item/completed':
                    item=p.get('item',{})
                    if item.get('type')=='agentMessage':
                        item_text[item.get('id','final')]=item.get('text','')
                    elif item.get('type') not in ('userMessage','reasoning','plan'):
                        raise RuntimeFailure('محرك المحادثة حاول استخدام أداة؛ أوقف التشغيل للمراجعة')
                elif method=='turn/completed' and p.get('turn',{}).get('id')==tid:
                    if p['turn'].get('status')!='completed':
                        raise RuntimeFailure('لم يكتمل رد Codex')
                    answer='\n'.join(item_text.values()) or text
                    if not answer.strip():
                        raise RuntimeFailure('لم يصل نص من Codex')
                    return answer
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid,signal.SIGTERM)
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=3)
            for stream in (proc.stdin,proc.stdout):
                if stream:
                    stream.close()


class ClaudeChat:
    """Read-only Claude Code chat adapter (`claude -p`, no tools). Owner subscription login only.

    Never passes ANTHROPIC_API_KEY or any browser token; all tools and MCP are disabled."""
    def __init__(self, binary, workspace, timeout=180, popen=subprocess.Popen):
        self.binary=str(Path(binary).resolve(strict=True))
        self.workspace=str(Path(workspace).resolve(strict=True))
        self.timeout=timeout
        self.popen=popen

    def command(self, thread):
        sid=thread or str(uuid.uuid4())
        args=[self.binary,'-p','--output-format','stream-json','--verbose','--tools','',
              '--strict-mcp-config','--disable-slash-commands','--permission-mode','plan',
              '--setting-sources','user',
              '--append-system-prompt','أنت Claude Code في محادثة سونو. أجب بالعربية. هذه قناة نقاش للقراءة فقط: لا تنفذ أوامر ولا تعدل ملفات ولا تدّع تنفيذ مهمة. طلبات التنفيذ تنتظر موافقة المالك.']
        args += ['--resume',thread] if thread else ['--session-id',sid]
        return args,sid

    def answer(self, history, thread, on_thread, progress, cancelled):
        args,sid=self.command(thread)
        env={k:v for k,v in os.environ.items() if k in ('PATH','HOME','LANG','SSL_CERT_FILE','SSL_CERT_DIR','HTTP_PROXY','HTTPS_PROXY','NO_PROXY')}
        proc=self.popen(args,cwd=self.workspace,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                        text=True,env=env,start_new_session=True,bufsize=1)
        incoming=queue.Queue()
        def reader():
            try:
                for line in proc.stdout:
                    if len(line)>1000000:
                        incoming.put(RuntimeFailure('x'));break
                    incoming.put(json.loads(line))
            except (ValueError,OSError):
                incoming.put(RuntimeFailure('x'))
            finally:
                incoming.put(None)
        threading.Thread(target=reader,daemon=True).start()
        try:
            proc.stdin.write(json.dumps(history,ensure_ascii=False));proc.stdin.close()
            deadline=time.monotonic()+self.timeout; text=''; final=None; saved=False
            while True:
                if cancelled():raise RuntimeFailure('أُوقف الطلب')
                if time.monotonic()>deadline:raise RuntimeFailure('انتهت مهلة المحادثة؛ أعد المحاولة بعد المراجعة')
                try:v=incoming.get(timeout=.2)
                except queue.Empty:continue
                if v is None or isinstance(v,Exception):
                    if final is None:raise RuntimeFailure('توقف محرك Claude')
                    break
                if not saved and v.get('session_id'):
                    on_thread(v['session_id']);saved=True
                kind=v.get('type')
                if kind=='assistant':
                    for block in v.get('message',{}).get('content',[]):
                        if block.get('type')=='text':
                            text+=block.get('text','')
                            if len(text)>24000:raise RuntimeFailure('الرد يتجاوز الحد')
                            progress(text)
                        elif block.get('type')=='tool_use':
                            raise RuntimeFailure('محرك المحادثة حاول استخدام أداة؛ أوقف التشغيل للمراجعة')
                elif kind=='result':
                    if v.get('is_error'):raise RuntimeFailure('لم يكتمل رد Claude')
                    final=v.get('result') or text
                    break
            if not final or not final.strip():raise RuntimeFailure('لم يصل نص من Claude')
            return final
        finally:
            if proc.poll() is None:
                try:os.killpg(proc.pid,signal.SIGTERM)
                except ProcessLookupError:pass
            try:proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=3)
            if proc.stdout:proc.stdout.close()
