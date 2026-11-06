import base64
import json
import os
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server/digital_team'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import uploads
from store import Denied, Invalid, Actor
from app import Service, handler, ThreadingHTTPServer
from runtime import Codex, ClaudeChat, Unsupported, RuntimeFailure
from test_digital_team_server import StoreTest

PNG=b'\x89PNG\r\n\x1a\n'+b'0'*64
JPG=b'\xff\xd8\xff\xe0'+b'0'*64
WEBP=b'RIFF\x10\x00\x00\x00WEBPVP8 '+b'0'*8
PDF=b'%PDF-1.4\n'+b'0'*32
b64=lambda raw:base64.b64encode(raw).decode()
def payload(raw,name='a.png',mime=None):
    d={'name':name,'data':b64(raw)}
    if mime:d['mime']=mime
    return d


class UploadValidationTest(unittest.TestCase):
    def test_allowlist_by_content(self):
        for raw,name,kind,mime in ((PNG,'a.png','image','image/png'),(JPG,'a.jpg','image','image/jpeg'),(WEBP,'a.webp','image','image/webp'),
                                   (PDF,'a.pdf','pdf','application/pdf'),('مرحبا'.encode(),'n.txt','text','text/plain'),
                                   (b'a,b\n1,2','t.csv','text','text/csv'),(b'# t','r.md','text','text/markdown')):
            got=uploads.decode_payload(payload(raw,name))
            self.assertEqual((got[2],got[3]),(kind,mime),name)
    def test_rejections(self):
        bad=[(b'<svg xmlns="http://www.w3.org/2000/svg"/>','x.svg'),(b'<html></html>','x.html'),(b'MZ\x90\x00','x.exe'),(b'#!/bin/sh\n','x.sh'),
             (b'plain text','noext'),(b'a\x00b','x.txt'),(b'\xff\xfe\xfa','x.txt'),(b'PK\x03\x04','x.docx'),(b'GIF89a....','x.gif')]
        for raw,name in bad:
            with self.assertRaises(uploads.UploadRejected,msg=name):uploads.decode_payload(payload(raw,name))
        for d in ({'name':'a.png'},{'data':b64(PNG)},{'name':'a.png','data':'***not-base64***'},{'name':'a.png','data':''},{'name':5,'data':'AAAA'}):
            with self.assertRaises(uploads.UploadRejected):uploads.decode_payload(d)
    def test_size_limit_and_declared_type(self):
        with self.assertRaises(uploads.UploadRejected):uploads.decode_payload(payload(PNG+b'0'*uploads.MAX_BYTES))
        with self.assertRaises(uploads.UploadRejected):uploads.decode_payload(payload(PNG,mime='image/jpeg'))
        with self.assertRaises(uploads.UploadRejected):uploads.decode_payload(payload(PNG,mime='application/pdf'))
        uploads.decode_payload(payload(PNG,mime='image/png'))
    def test_name_sanitised(self):
        self.assertEqual(uploads.clean_name('../../etc/passwd'),'passwd')
        self.assertEqual(uploads.clean_name('C:\\x\\<b>a.png'),'ba.png')
        self.assertNotIn('\u202e',uploads.clean_name('a\u202e.png'))
        self.assertLessEqual(len(uploads.clean_name('x'*500)),80)
        self.assertEqual(uploads.clean_name(''),'ملف')


class AttachmentStoreTest(StoreTest):
    def up(self,room,raw=PNG,name='scan.png',actor=None):
        return self.s.add_attachment(actor or self.owner,room,payload(raw,name))
    def test_owner_only_and_membership(self):
        self.grant(self.a);room=self.room(users=['a'])
        with self.assertRaises(Denied):self.up(room,actor=self.a)
        with self.assertRaises(Denied):self.up('missing')
        other=self.room(actor=self.owner)
        self.s.db.execute('DELETE FROM members WHERE room=? AND user_id=?',(other,'owner'))
        with self.assertRaises(Denied):self.up(other)
        with self.assertRaises(Denied):self.send(room,self.a,key='request-0009',attachments=['x'])
    def test_stored_privately_with_random_name(self):
        room=self.room();out=self.up(room,name='../../patient.png')
        self.assertEqual(out['name'],'patient.png')
        files=list(self.s.upload_dir.iterdir());self.assertEqual(len(files),1)
        f=files[0];self.assertNotIn('patient',f.name);self.assertTrue(f.name.endswith('.png'))
        self.assertEqual(stat.S_IMODE(f.stat().st_mode),0o600);self.assertEqual(stat.S_IMODE(self.s.upload_dir.stat().st_mode),0o700)
        self.assertEqual(f.read_bytes(),PNG)
        self.assertEqual(self.s.upload_dir.parent,Path(self.path).resolve().parent)
    def test_send_links_and_history_hides_paths(self):
        room=self.room();a=self.up(room);b=self.up(room,b'hello','n.txt')
        self.send(room,attachments=[a['id'],b['id']])
        h=self.s.history(self.owner,room)['messages'][0]
        self.assertEqual([x['name'] for x in h['attachments']],['scan.png','n.txt'])
        self.assertNotIn('stored',json.dumps(h));self.assertNotIn(str(self.s.upload_dir),json.dumps(h))
        job=self.s.claim();files=self.s.job_attachments(job)
        self.assertEqual({f['kind'] for f in files},{'image','text'});self.assertTrue(all(Path(f['path']).is_file() for f in files))
        history,_=self.s.context(job);self.assertIn('[مرفقات: scan.png، n.txt]',history[-1]['body'])
    def test_blank_body_allowed_only_with_attachment(self):
        room=self.room();a=self.up(room)
        self.s.send(self.owner,room,{'body':'  ','request_key':'request-1000','attachments':[a['id']]})
        with self.assertRaises(Invalid):self.s.send(self.owner,room,{'body':'  ','request_key':'request-1001'})
    def test_attachment_isolation(self):
        r1=self.room();r2=self.room();a=self.up(r1)
        with self.assertRaises(Invalid):self.send(r2,attachments=[a['id']],key='request-2000')   # other room
        self.send(r1,attachments=[a['id']],key='request-2001')
        with self.assertRaises(Invalid):self.send(r1,attachments=[a['id']],key='request-2002')   # already used
        with self.assertRaises(Invalid):self.send(r1,attachments=['nope'],key='request-2003')
        with self.assertRaises(Invalid):self.send(r1,attachments='x',key='request-2004')
    def test_count_limit_and_idempotency(self):
        room=self.room();ids=[self.up(room)['id'] for _ in range(4)]
        with self.assertRaises(Invalid):self.send(room,attachments=ids)
        first=self.send(room,attachments=ids[:2]);again=self.send(room,attachments=ids[:2])
        self.assertTrue(again['duplicate']);self.assertEqual(first['message_id'],again['message_id'])
        with self.assertRaises(Invalid):self.send(room,attachments=ids[:1])
    def test_pending_cap_and_purge(self):
        room=self.room()
        for _ in range(uploads.MAX_PENDING):self.up(room)
        with self.assertRaises(Invalid):self.up(room)
        self.s.db.execute('UPDATE attachments SET created=created-?',(uploads.PENDING_TTL+5,))
        self.up(room)
        self.assertEqual(self.s.db.execute('SELECT COUNT(*) FROM attachments').fetchone()[0],1)
        self.assertEqual(len(list(self.s.upload_dir.iterdir())),1)
    def test_invalid_type_not_stored(self):
        room=self.room()
        with self.assertRaises(Invalid):self.up(room,b'<svg/>','x.svg')
        self.assertFalse(self.s.upload_dir.exists() and list(self.s.upload_dir.iterdir()))
    def test_export_includes_attachments(self):
        room=self.room();a=self.up(room,name='lab.png');self.send(room,attachments=[a['id']])
        self.s.db.execute('UPDATE messages SET created=?',(1793970000.0,))
        rows=self.s.export(self.owner,'2026-11-06T00:00','2026-11-07T00:00')['rows']
        self.assertIn('lab.png (image/png, %d bytes)'%len(PNG),rows[0]['attachments'])
        self.assertNotIn(str(self.s.upload_dir),json.dumps(rows))


class FakeAuth:
    def __init__(self,actors):self.actors=actors
    def actor(self,token):return self.actors[token]
    def directory(self,token,a):return []

class FakeEngine:
    def __init__(self):self.calls=[]
    def answer(self,history,thread,on_thread,progress,cancelled,attachments=None):
        self.calls.append(attachments);return 'تم'

class PdfRefuser:
    def answer(self,*a,**k):raise Unsupported('Codex لا يقرأ ملفات PDF؛ جرّب Claude')

class UploadServiceTest(StoreTest):
    def svc(self,engine=None):
        return Service(self.s,FakeAuth({'o':self.owner,'e':self.a}),engine,False,engine)
    def test_route_and_worker_passes_files(self):
        eng=FakeEngine();svc=self.svc(eng);room=self.room()
        out=svc.handle('POST','/api/digital-team/rooms/%s/attachments'%room,'o',payload(PNG))
        self.assertEqual(out['kind'],'image')
        svc.handle('POST','/api/digital-team/rooms/%s/messages'%room,'o',{'body':'شوف','request_key':'request-3000','attachments':[out['id']]})
        self.assertTrue(svc.work_once());self.assertEqual(len(eng.calls[0]),1);self.assertEqual(eng.calls[0][0]['kind'],'image')
    def test_no_files_keeps_old_engine_signature(self):
        class Old:
            def answer(self,history,thread,on_thread,progress,cancelled):return 'ok'
        svc=self.svc(Old());room=self.room()
        svc.handle('POST','/api/digital-team/rooms/%s/messages'%room,'o',{'body':'x','request_key':'request-3001'})
        svc.work_once();self.assertEqual(self.s.history(self.owner,room)['messages'][-1]['body'],'ok')
    def test_unsupported_reason_is_shown(self):
        svc=self.svc(PdfRefuser());room=self.room()
        a=svc.handle('POST','/api/digital-team/rooms/%s/attachments'%room,'o',payload(PDF,'a.pdf'))
        svc.handle('POST','/api/digital-team/rooms/%s/messages'%room,'o',{'body':'x','request_key':'request-3002','attachments':[a['id']]})
        svc.work_once()
        job=self.s.history(self.owner,room)['jobs'][0];self.assertEqual(job['state'],'failed');self.assertIn('PDF',job['error'])
    def test_claude_room_uses_claude_engine_owner_only_shared_limit(self):
        cx, cl = FakeEngine(), FakeEngine()
        svc = Service(self.s, FakeAuth({'o': self.owner, 'e': self.a}), cx, False, cl)
        room = self.room(agents=['claude'])
        svc.handle('POST', '/api/digital-team/rooms/%s/messages' % room, 'o', {'body': 'سؤال', 'request_key': 'request-4000'})
        self.assertTrue(svc.work_once())
        self.assertEqual((len(cx.calls), len(cl.calls)), (0, 1))
        self.assertEqual(self.s.history(self.owner, room)['messages'][-1]['author'], 'agent:claude')
        self.grant(self.a, agent='claude')
        r2 = self.room(agents=['claude'], users=['a'])
        with self.assertRaises(Invalid):
            svc.handle('POST', '/api/digital-team/rooms/%s/messages' % r2, 'e', {'body': 'x', 'request_key': 'request-4001'})
        room3 = self.room(agents=['codex'])
        svc.handle('POST', '/api/digital-team/rooms/%s/messages' % room3, 'o', {'body': 'y', 'request_key': 'request-4002'})
        svc.work_once()
        self.assertEqual(len(cx.calls), 1)
        self.assertEqual(self.s.db.execute('select count(*) from usage').fetchone()[0], 1)  # one counter shared by both engines
    def test_employee_cannot_upload(self):
        self.grant(self.a);room=self.room(users=['a']);svc=self.svc()
        with self.assertRaises(Denied):svc.handle('POST','/api/digital-team/rooms/%s/attachments'%room,'e',payload(PNG))
    def test_http_body_limits(self):
        svc=self.svc();room=self.room();server=ThreadingHTTPServer(('127.0.0.1',0),handler(svc,'https://dashboard.swnwclinics.com'))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        def post(path,body):
            req=urllib.request.Request('http://127.0.0.1:%d/api/digital-team%s'%(server.server_port,path),data=json.dumps(body).encode(),
                headers={'Authorization':'Bearer o','Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(req) as r:return r.status,json.load(r)
            except urllib.error.HTTPError as e:return e.code,json.load(e)
        try:
            code,out=post('/rooms/%s/attachments'%room,payload(PNG+b'1'*200000));self.assertEqual(code,200,out)
            code,_=post('/rooms/%s/attachments'%room,{'name':'a.png','data':'A'*(uploads.MAX_REQUEST+10)});self.assertEqual(code,400)
            code,_=post('/rooms',{'title':'x'*30000,'agents':[]});self.assertEqual(code,400)   # other routes keep the 24 KB cap
        finally:server.shutdown();server.server_close()


class LongMessageTest(StoreTest):
    def test_long_message_ok_and_cap(self):
        import store
        room=self.room();long='س'*150000
        self.send(room,body=long)
        self.assertEqual(len(self.s.history(self.owner,room)['messages'][0]['body']),150000)
        job=self.s.claim();hist,_=self.s.context(job);self.assertEqual(len(hist[-1]['body']),150000)
        with self.assertRaises(Invalid) as e:self.send(room,key='request-4001',body='x'*(store.MAX_BODY+1))
        self.assertIn('200000',str(e.exception))
    def test_http_long_message(self):
        eng=FakeEngine();svc=Service(self.s,FakeAuth({'o':self.owner}),eng,False,eng);room=self.room()
        server=ThreadingHTTPServer(('127.0.0.1',0),handler(svc,'https://dashboard.swnwclinics.com'))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        def post(body):
            req=urllib.request.Request('http://127.0.0.1:%d/api/digital-team/rooms/%s/messages'%(server.server_port,room),data=json.dumps(body,ensure_ascii=False).encode(),
                headers={'Authorization':'Bearer o','Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(req) as r:return r.status
            except urllib.error.HTTPError as e:return e.code
        try:
            self.assertEqual(post({'body':'س'*190000,'request_key':'request-5000'}),200)
            self.assertEqual(post({'body':'س'*200001,'request_key':'request-5001'}),400)
        finally:server.shutdown();server.server_close()


FAKE_CODEX='''#!PYTHON
import json,sys
for line in sys.stdin:
 v=json.loads(line);m=v['method']
 if 'id' not in v:continue
 p=v.get('params',{});r={}
 if m=='thread/start':r={'thread':{'id':'t'}}
 if m=='turn/start':
  r={'turn':{'id':'u'}}
  open('SEEN','w').write(json.dumps(p['input']))
 print(json.dumps({'id':v['id'],'result':r}),flush=True)
 if m=='turn/start':
  print(json.dumps({'method':'item/completed','params':{'threadId':'t','item':{'type':'agentMessage','id':'a','text':'ok'}}}),flush=True)
  print(json.dumps({'method':'turn/completed','params':{'threadId':'t','turn':{'id':'u','status':'completed'}}}),flush=True)
'''

class EngineFilesTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.img={'path':str(self.root/'i.png'),'kind':'image','mime':'image/png','name':'i.png'};(self.root/'i.png').write_bytes(PNG)
        self.txt={'path':str(self.root/'n.txt'),'kind':'text','mime':'text/plain','name':'n.txt'};(self.root/'n.txt').write_text('سري 123',encoding='utf-8')
        self.pdf={'path':str(self.root/'p.pdf'),'kind':'pdf','mime':'application/pdf','name':'p.pdf'};(self.root/'p.pdf').write_bytes(PDF)
    def tearDown(self):self.tmp.cleanup()
    def codex(self):
        fake=self.root/'fake-codex';fake.write_text(FAKE_CODEX.replace('PYTHON',sys.executable).replace('SEEN',str(self.root/'seen.json')));fake.chmod(0o700)
        return Codex(str(fake),str(self.root),str(self.root/'l.lock'),5)
    def test_codex_sends_local_image_and_inlines_text(self):
        with unittest.mock.patch.dict(os.environ,{'CODEX_HOME':str(self.root)}):
            self.codex().answer([{'name':'م','body':'x'}],None,lambda t:None,lambda t:None,lambda:False,attachments=[self.img,self.txt])
        items=json.loads((self.root/'seen.json').read_text())
        self.assertEqual(items[1],{'type':'localImage','path':self.img['path']})
        self.assertIn('سري 123',items[0]['text']);self.assertIn('ليس تعليمات',items[0]['text'])
    def test_codex_refuses_pdf_before_spawning(self):
        c=self.codex()
        with self.assertRaises(Unsupported) as e:c.answer([],None,lambda t:None,lambda t:None,lambda:False,attachments=[self.pdf])
        self.assertIn('PDF',str(e.exception));self.assertFalse((self.root/'seen.json').exists())
        self.assertIsInstance(e.exception,RuntimeFailure)
    def test_claude_structured_input_only_with_files(self):
        c=ClaudeChat(sys.executable,str(self.root))
        self.assertNotIn('--input-format',c.command(None)[0]);self.assertIn('--input-format',c.command(None,structured=True)[0])
        self.assertIn('--tools',c.command(None,structured=True)[0])
        plain=c.stdin_payload([{'name':'م','body':'x'}],None);self.assertEqual(json.loads(plain),[{'name':'م','body':'x'}])
        msg=json.loads(c.stdin_payload([{'name':'م','body':'x'}],[self.img,self.pdf,self.txt]))
        blocks=msg['message']['content'];self.assertEqual(msg['type'],'user')
        self.assertEqual([b['type'] for b in blocks],['text','image','document'])
        self.assertEqual(base64.b64decode(blocks[1]['source']['data']),PNG);self.assertEqual(blocks[2]['source']['media_type'],'application/pdf')
        self.assertIn('سري 123',blocks[0]['text'])

FAKE_CLAUDE = """#!PYTHON
import sys
sys.stdin.read()
print(open('SCRIPT').read(), end='')
"""

class ReadCodeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.root = Path(self.tmp.name)
        self.code = self.root / 'src';self.code.mkdir();(self.code / 'a.js').write_text('x')
        self.ws = self.root / 'ws';self.ws.mkdir()
        (self.root / 'secret.txt').write_text('s');(self.code / 'link').symlink_to(self.root / 'secret.txt')
    def tearDown(self):self.tmp.cleanup()
    def engine(self, lines=None):
        fake = self.root / 'fake-claude';script = self.root / 'script.txt'
        script.write_text('\n'.join(json.dumps(x) for x in (lines or [])) + '\n')
        fake.write_text(FAKE_CLAUDE.replace('PYTHON', sys.executable).replace('SCRIPT', str(script)));fake.chmod(0o700)
        return ClaudeChat(str(fake), str(self.ws), code_dir=str(self.code))
    def test_gate_decisions(self):
        import read_gate
        d = str(self.code.resolve())
        ok = [('Read', {'file_path': d + '/a.js'}), ('Read', {'file_path': 'a.js'}), ('Grep', {'pattern': 'x'}),
              ('Grep', {'pattern': 'x', 'path': d, 'glob': '!**/secrets/**'}), ('Glob', {'pattern': '**/*.js', 'path': d})]
        bad = [('Read', {'file_path': '/etc/passwd'}), ('Read', {'file_path': d + '/../secret.txt'}), ('Read', {'file_path': d + '/link'}),
               ('Read', {}), ('Grep', {'pattern': 'x', 'path': '/home'}), ('Grep', {'pattern': 'x', 'glob': '/etc/*'}),
               ('Glob', {'pattern': '/etc/*'}), ('Glob', {'pattern': '../*'}), ('Bash', {'command': 'ls'}), ('Write', {'file_path': d + '/a.js'}),
               ('Read', 'text'), (None, {})]
        for n, i in ok:self.assertTrue(read_gate.decide(d, n, i), (n, i))
        for n, i in bad:self.assertFalse(read_gate.decide(d, n, i), (n, i))
    def test_hook_script_fails_closed(self):
        gate = str(Path(__file__).resolve().parents[1] / 'server/digital_team/read_gate.py');d = str(self.code.resolve())
        run = lambda payload, arg=d: subprocess.run([sys.executable, gate, arg], input=payload, text=True, capture_output=True).returncode
        self.assertEqual(run(json.dumps({'tool_name': 'Read', 'tool_input': {'file_path': d + '/a.js'}})), 0)
        self.assertEqual(run(json.dumps({'tool_name': 'Read', 'tool_input': {'file_path': '/etc/passwd'}})), 2)
        self.assertEqual(run('not json'), 2);self.assertEqual(run('{}'), 2)
    def test_flags_only_with_code_dir(self):
        plain = ClaudeChat(sys.executable, str(self.ws)).command(None)[0]
        self.assertEqual(plain[plain.index('--tools') + 1], '');self.assertNotIn('--settings', plain)
        args = self.engine().command(None)[0]
        self.assertEqual(args[args.index('--tools') + 1], 'Read,Grep,Glob')
        hooks = json.loads(args[args.index('--settings') + 1])['hooks']['PreToolUse'][0]
        self.assertEqual(hooks['matcher'], '*');self.assertIn('read_gate.py', hooks['hooks'][0]['command'])
        self.assertIn('Bash', args[args.index('--disallowedTools') + 1:]);self.assertIn('--add-dir', args)
    def test_answer_allows_inside_read_and_stops_on_anything_else(self):
        d = str(self.code.resolve())
        use = lambda name, inp: {'type': 'assistant', 'session_id': 's1', 'message': {'content': [{'type': 'tool_use', 'name': name, 'input': inp}]}}
        done = [{'type': 'assistant', 'session_id': 's1', 'message': {'content': [{'type': 'text', 'text': 'تم'}]}}, {'type': 'result', 'result': 'تم'}]
        call = lambda eng: eng.answer([{'name': 'م', 'body': 'x'}], None, lambda t: None, lambda t: None, lambda: False)
        self.assertEqual(call(self.engine([use('Read', {'file_path': d + '/a.js'})] + done)), 'تم')
        for name, inp in (('Read', {'file_path': '/etc/passwd'}), ('Bash', {'command': 'ls'}), ('Write', {'file_path': d + '/x'}), ('Grep', {'pattern': 'x', 'path': '/'})):
            with self.assertRaises(RuntimeFailure):call(self.engine([use(name, inp)] + done))
        with self.assertRaises(RuntimeFailure):call(self.engine([use('Read', {'file_path': d + '/a.js'})] * 31 + done))
    def test_no_code_dir_keeps_every_tool_forbidden(self):
        eng = self.engine();eng.code_dir = None
        self.assertFalse(eng.tool_allowed({'name': 'Read', 'input': {'file_path': str(self.code / 'a.js')}}))

import unittest.mock
if __name__=='__main__':unittest.main()
