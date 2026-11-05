import http.client
import json
import os
import socket
import stat
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server/digital_team'))
from runtime import ClaudeChat, RuntimeFailure
from store import Store, Actor
import app

FAKE = '''#!PYTHON
import json,os,sys
open(OUT,'w').write(json.dumps({'argv':sys.argv[1:],'env_key':'ANTHROPIC_API_KEY' in os.environ,'stdin':sys.stdin.read()}))
mode=MODE
sid=sys.argv[sys.argv.index('--session-id')+1] if '--session-id' in sys.argv else sys.argv[sys.argv.index('--resume')+1]
def out(v):print(json.dumps(v,ensure_ascii=False),flush=True)
out({'type':'system','session_id':sid})
if mode=='tool':
  out({'type':'assistant','session_id':sid,'message':{'content':[{'type':'tool_use','name':'Bash'}]}})
else:
  out({'type':'assistant','session_id':sid,'message':{'content':[{'type':'text','text':'رد من Claude'}]}})
  out({'type':'result','session_id':sid,'is_error':mode=='error','result':'رد من Claude'})
'''


class ClaudeChatTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.out = self.root / 'seen.json'
    def tearDown(self): self.tmp.cleanup()
    def chat(self, mode='ok'):
        fake = self.root / 'fake-claude'
        fake.write_text(FAKE.replace('PYTHON', sys.executable).replace('OUT', repr(str(self.out))).replace('MODE', repr(mode)))
        fake.chmod(0o700)
        return ClaudeChat(str(fake), str(self.root), 5)
    def run_chat(self, chat, thread=None, cancel=lambda: False):
        sessions = []
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'must-not-leak'}):
            text = chat.answer([{'name': 'م', 'body': 'مرحبا'}], thread, sessions.append, lambda t: None, cancel)
        return text, sessions, json.loads(self.out.read_text())

    def test_read_only_flags_and_no_api_key(self):
        text, sessions, seen = self.run_chat(self.chat())
        argv = seen['argv']
        self.assertEqual(text, 'رد من Claude')
        self.assertEqual(argv[argv.index('--tools') + 1], '')
        for flag in ('--strict-mcp-config', '--disable-slash-commands', '-p'):
            self.assertIn(flag, argv)
        self.assertEqual(argv[argv.index('--permission-mode') + 1], 'plan')
        self.assertNotIn('--dangerously-skip-permissions', argv)
        self.assertFalse(seen['env_key'])
        self.assertIn('--session-id', argv); self.assertEqual(len(sessions), 1)

    def test_resume_uses_saved_session(self):
        _, _, seen = self.run_chat(self.chat(), 'thread-123')
        self.assertEqual(seen['argv'][seen['argv'].index('--resume') + 1], 'thread-123')

    def test_tool_use_and_error_fail_closed(self):
        with self.assertRaises(RuntimeFailure): self.run_chat(self.chat('tool'))
        with self.assertRaises(RuntimeFailure): self.run_chat(self.chat('error'))

    def test_cancel(self):
        with self.assertRaises(RuntimeFailure): self.run_chat(self.chat(), cancel=lambda: True)


class FakeAuth:
    def actor(self, token):
        return Actor('owner-1', 'Owner', True) if token == 'o' * 24 else Actor('emp-1', 'Emp', False)
    def directory(self, token, actor): return []


class FakeEngine:
    def answer(self, *a): return 'x'


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.store = Store(str(self.root / 'c.sqlite3'))
    def tearDown(self): self.tmp.cleanup()

    def test_claude_is_owner_only_even_with_shared_codex(self):
        svc = app.Service(self.store, FakeAuth(), FakeEngine(), True, FakeEngine())
        owner, emp = Actor('owner-1', 'O', True), Actor('emp-1', 'E', False)
        self.assertTrue(svc.available('claude', owner))
        self.assertFalse(svc.available('claude', emp))
        self.assertTrue(svc.available('codex', emp))  # shared Codex flag only affects Codex
        self.assertFalse(app.Service(self.store, FakeAuth(), None, True).available('claude', owner))

    def test_unix_socket_end_to_end_and_no_tcp(self):
        sock = str(self.root / 'g.sock')
        svc = app.Service(self.store, FakeAuth(), None, False, FakeEngine())
        server = app.UnixServer(sock, app.handler(svc, 'https://dashboard.example'))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            self.assertEqual(stat.S_IMODE(os.stat(sock).st_mode), 0o660)
            class C(http.client.HTTPConnection):
                def connect(s):
                    s.sock = socket.socket(socket.AF_UNIX); s.sock.connect(sock)
            def get(path, token, origin=None):
                c = C('unix'); h = {'Authorization': 'Bearer ' + token}
                if origin: h['Origin'] = origin
                c.request('GET', path, headers=h); r = c.getresponse(); return r.status, json.loads(r.read())
            st, body = get('/api/digital-team/bootstrap', 'o' * 24, 'https://dashboard.example')
            self.assertEqual(st, 200)
            claude = [a for a in body['agents'] if a['code'] == 'claude'][0]
            self.assertTrue(claude['connected'])
            st, body = get('/api/digital-team/bootstrap', 'e' * 24)
            self.assertFalse([a for a in body['agents'] if a['code'] == 'claude'][0]['connected'])
            self.assertEqual(get('/api/digital-team/bootstrap', 'o' * 24, 'https://evil.example')[0], 403)
            self.assertEqual(get('/other', 'o' * 24)[0], 400)
        finally:
            server.shutdown(); server.server_close()


if __name__ == '__main__':
    unittest.main()
