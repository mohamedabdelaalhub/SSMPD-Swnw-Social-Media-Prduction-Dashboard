import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server/digital_team'))
from runtime import Codex, RuntimeFailure

FAKE='''#!PYTHON
import json,sys
for line in sys.stdin:
 v=json.loads(line);m=v['method']
 if 'id' not in v:continue
 p=v.get('params',{});r={}
 if m=='thread/start':r={'thread':{'id':'server-thread'}}
 if m=='thread/resume':r={'thread':{'id':p['threadId']}}
 if m=='turn/start':r={'turn':{'id':'turn-1'}}
 print(json.dumps({'id':v['id'],'result':r}),flush=True)
 if m=='turn/start':
  assert p['sandboxPolicy']=={'type':'readOnly','networkAccess':False}
  assert p['approvalPolicy']=='never'
  print(json.dumps({'method':'item/agentMessage/delta','params':{'threadId':'server-thread','delta':'رد من Codex'}}),flush=True)
  print(json.dumps({'method':'item/completed','params':{'threadId':'server-thread','item':{'type':'agentMessage','id':'a','text':'رد من Codex'}}}),flush=True)
  print(json.dumps({'method':'turn/completed','params':{'threadId':'server-thread','turn':{'id':'turn-1','status':'STATUS'}}}),flush=True)
'''
class RuntimeTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.fake=self.root/'fake-codex';self.write('completed')
  self.codex=Codex(str(self.fake),str(self.root),str(self.root/'shared.lock'),3)
 def tearDown(self):self.tmp.cleanup()
 def write(self,status):
  self.fake.write_text(FAKE.replace('PYTHON',sys.executable).replace('WORKSPACE',repr(str(self.root))).replace('STATUS',status));self.fake.chmod(0o700)
 def answer(self,thread=None,cancel=lambda:False):
  sessions=[];parts=[]
  with patch.dict(os.environ,{'CODEX_HOME':str(self.root)}):
   text=self.codex.answer([{'name':'محمد','body':'مرحبا'}],thread,sessions.append,parts.append,cancel)
  return text,sessions,parts
 def test_real_stdio_protocol_start(self):
  text,sessions,parts=self.answer();self.assertEqual(text,'رد من Codex');self.assertEqual(sessions,['server-thread']);self.assertTrue(parts)
 def test_resume_persisted_thread(self):self.assertEqual(self.answer('server-thread')[1],['server-thread'])
 def test_failed_completion_not_success(self):
  self.write('failed')
  with self.assertRaises(RuntimeFailure):self.answer()
 def test_cancellation_stops_process(self):
  with self.assertRaises(RuntimeFailure):self.answer(cancel=lambda:True)
 def test_lock_conflicts_with_runner(self):
  import fcntl
  with open(self.root/'shared.lock','a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(RuntimeFailure):self.answer()
 def test_invalid_mcp_name_fails_closed(self):
  (self.root/'config.toml').write_text('[mcp_servers."unsafe.name"]\nenabled=true\n')
  with self.assertRaises(RuntimeFailure):self.answer()
if __name__=='__main__':unittest.main()
