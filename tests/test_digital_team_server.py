import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server/digital_team'))
from store import Store, Actor, Denied, Invalid
from app import Service, handler, ThreadingHTTPServer
from auth import Auth

class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=str(Path(self.tmp.name)/'chat.db');self.s=Store(self.path)
        self.owner=Actor('owner','محمد',True);self.a=Actor('a','موظف أ');self.b=Actor('b','موظف ب')
        self.directory=[{'id':a.id,'name':a.name} for a in (self.owner,self.a,self.b)]
        for a in (self.owner,self.a,self.b):self.s.remember(a)
    def tearDown(self):self.s.db.close();self.tmp.cleanup()
    def grant(self,user,agent='codex',chat=True,task=False):
        self.s.set_grant(self.owner,{'user_id':user.id,'agent':agent,'chat':chat,'task':task},self.directory)
    def room(self,agents=None,users=None,actor=None):
        return self.s.create(actor or self.owner,{'agents':['codex'] if agents is None else agents,'users':users or [],'title':'شات'},self.directory)
    def send(self,room,actor=None,key='request-0001',**extra):
        return self.s.send(actor or self.owner,room,{'body':'رسالة','request_key':key,**extra})
    def test_no_automatic_access(self):
        room=self.room();self.assertEqual(self.s.rooms(self.a),[])
        with self.assertRaises(Denied):self.s.history(self.a,room)
        with self.assertRaises(Denied):self.s.create(self.a,{'agents':['codex']},self.directory)
    def test_owner_cannot_read_private_employee_room(self):
        self.grant(self.a);room=self.room(actor=self.a)
        with self.assertRaises(Denied):self.s.history(self.owner,room)
        self.assertEqual(self.s.rooms(self.owner),[])
    def test_grant_and_revoke(self):
        self.grant(self.a);room=self.room(users=['a']);self.send(room,self.a)
        self.grant(self.a,chat=False)
        with self.assertRaises(Denied):self.s.history(self.a,room)
        with self.assertRaises(Denied):self.send(room,self.a,key='another-0001')
    def test_expired(self):
        self.grant(self.a);self.s.db.execute('UPDATE grants SET expires=?',(time.time()-1,))
        self.assertFalse(self.s.allowed('a','codex'))
    def test_cannot_self_grant(self):
        with self.assertRaises(Denied):self.s.set_grant(self.a,{'user_id':'a','agent':'codex','chat':True},self.directory)
    def test_participant_requires_every_agent_grant(self):
        self.grant(self.a)
        with self.assertRaises(Denied):self.room(['codex','sia'],['a'])
    def test_human_conversation(self):
        self.grant(self.a);room=self.room([],['a']);self.send(room,self.a)
        self.assertEqual(len(self.s.history(self.a,room)['messages']),1)
        self.assertIsNone(self.s.claim())
    def test_idempotency(self):
        room=self.room();first=self.send(room);second=self.send(room)
        self.assertEqual(first['message_id'],second['message_id']);self.assertTrue(second['duplicate'])
        self.assertEqual(len(self.s.history(self.owner,room)['jobs']),1)
        with self.assertRaises(Invalid):self.send(room,body='نص آخر')
    def test_unknown_target_denied(self):
        with self.assertRaises(Denied):self.send(self.room(),targets=['sia'])
    def test_task_permission(self):
        self.grant(self.a);room=self.room(users=['a'])
        with self.assertRaises(Denied):self.send(room,self.a,kind='task')
        self.grant(self.a,task=True);self.send(room,self.a,kind='task')
        self.assertEqual(self.s.history(self.a,room)['jobs'][0]['state'],'awaiting_owner')
        self.assertIsNone(self.s.claim())
    def test_group_without_mention_no_agent_call(self):
        room=self.room(['codex','sia']);self.send(room)
        self.assertIsNone(self.s.claim())
        self.send(room,key='mention-0001',targets=['codex'])
        self.assertEqual(self.s.claim()['agent'],'codex')
    def test_unconnected_is_honest(self):
        room=self.room(['hapi']);self.send(room)
        self.assertEqual(self.s.history(self.owner,room)['jobs'][0]['state'],'unconnected')
        self.assertIsNone(self.s.claim())
    def test_history_boundary_rotates_runtime(self):
        room=self.room();self.send(room,body='سري قديم');job=self.s.claim();self.s.session(job,'old-thread');self.s.finish(job,'رد خاص')
        self.grant(self.a)
        self.s.set_members(self.owner,room,{'users':[{'id':'owner','send':True,'manage':True},{'id':'a','send':True}],
                                             'agents':['codex'],'share_history':False},self.directory)
        self.assertEqual(self.s.history(self.a,room)['messages'],[])
        self.send(room,key='new-message',body='رسالة مشتركة');next_job=self.s.claim();context,session=self.s.context(next_job)
        self.assertIsNone(session);self.assertEqual([r['body'] for r in context],['رسالة مشتركة'])
        self.assertEqual(len(self.s.history(self.owner,room)['messages']),3)
    def test_removed_user_loses_read_send_and_active_job_cancelled(self):
        self.grant(self.a);room=self.room(users=['a']);self.send(room,self.a);job=self.s.claim()
        self.s.set_members(self.owner,room,{'users':[{'id':'owner','send':True,'manage':True}],'agents':['codex']},self.directory)
        with self.assertRaises(Denied):self.s.history(self.a,room)
        self.s.finish(job,'لا ينبغي نشره');self.assertEqual(len(self.s.history(self.owner,room)['messages']),1)
    def test_view_only(self):
        self.grant(self.a);room=self.room()
        self.s.set_members(self.owner,room,{'users':[{'id':'owner','send':True,'manage':True},{'id':'a','send':False}],'agents':['codex'],'share_history':True},self.directory)
        self.send(room);self.s.history(self.a,room)
        with self.assertRaises(Denied):self.send(room,self.a,key='reader-0001')
    def test_manager_cannot_escalate(self):
        self.grant(self.a);room=self.room()
        self.s.set_members(self.owner,room,{'users':[{'id':'owner','send':True,'manage':True},{'id':'a','send':True,'manage':True}],'agents':['codex']},self.directory)
        with self.assertRaises(Denied):self.s.set_members(self.a,room,{'users':[{'id':'owner','send':True,'manage':True},{'id':'a','send':True,'manage':True},{'id':'b','send':True,'manage':True}],'agents':['codex']},self.directory)
    def test_restart_persists_and_does_not_replay_inflight(self):
        room=self.room();self.send(room);self.s.claim();self.s.db.close();self.s=Store(self.path)
        self.assertEqual(len(self.s.history(self.owner,room)['messages']),1)
        self.assertEqual(self.s.history(self.owner,room)['jobs'][0]['state'],'interrupted');self.assertIsNone(self.s.claim())
    def test_context_is_bounded(self):
        room=self.room();self.send(room,body='x'*4000);job=self.s.claim();context,_=self.s.context(job)
        self.assertLessEqual(sum(len(r['body']) for r in context),24000)
    def test_cancel_other_users_job_denied(self):
        self.grant(self.a);room=self.room(users=['a']);self.send(room);j=self.s.claim()
        with self.assertRaises(Denied):self.s.cancel(self.a,room,j['id'])
    def test_invalid_create_rolls_back(self):
        with self.assertRaises(Denied):self.room(users=['unknown'])
        self.assertEqual(self.s.rooms(self.owner),[])

    def test_human_chat_requires_a_chat_grant(self):
        with self.assertRaises(Denied):self.room([],['a'])
        self.grant(self.a);room=self.room([],['a']);self.grant(self.a,chat=False)
        with self.assertRaises(Denied):self.s.history(self.a,room)
    def test_persistent_daily_model_limit(self):
        room=self.room()
        for i in range(4):
            self.send(room,key='quota-000'+str(i));job=self.s.claim();self.s.finish(job,error='failed')
        self.send(room,key='quota-next');self.assertIsNone(self.s.claim())
        self.assertEqual(self.s.history(self.owner,room)['jobs'][0]['state'],'limited')
    def test_concurrent_retry_creates_one_job(self):
        room=self.room();results=[]
        threads=[threading.Thread(target=lambda:results.append(self.send(room))) for _ in range(2)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(len({r['message_id'] for r in results}),1)
        self.assertEqual(len(self.s.history(self.owner,room)['jobs']),1)

class FakeAuth:
    def actor(self,t):
        if t!='owner-session-token-12345':raise Denied('غير مصرح')
        return Actor('owner','محمد',True)
    def directory(self,t,a):return [{'id':'owner','name':'محمد'}]

class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=Store(str(Path(self.tmp.name)/'db'));self.s=Service(self.store,FakeAuth())
    def tearDown(self):self.store.db.close();self.tmp.cleanup()
    def test_browser_cannot_choose_owner_or_command(self):
        with self.assertRaises(Denied):self.s.handle('GET','/api/digital-team/bootstrap','forged',{'owner':True})
    def test_runtime_off_no_fake_response(self):
        room=self.s.handle('POST','/api/digital-team/rooms','owner-session-token-12345',{'agents':['codex']})['id']
        with self.assertRaises(Invalid):self.s.handle('POST',f'/api/digital-team/rooms/{room}/messages','owner-session-token-12345',{'body':'hi','request_key':'key-12345'})
        self.assertEqual(self.store.history(Actor('owner','محمد',True),room)['messages'],[])
    def test_http_no_cors_no_auth_no_token_leak(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),handler(self.s,'https://dashboard.swnwclinics.com'))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            url=f'http://127.0.0.1:{server.server_port}/api/digital-team/bootstrap'
            for headers in ({},{'Origin':'https://evil.invalid','Authorization':'Bearer owner-session-token-12345'}):
                with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(urllib.request.Request(url,headers=headers))
                self.assertEqual(e.exception.code,403)
            with urllib.request.urlopen(urllib.request.Request(url,headers={'Authorization':'Bearer owner-session-token-12345'})) as r:
                self.assertEqual(r.headers['Cache-Control'],'no-store');self.assertEqual(json.load(r)['me']['id'],'owner')
        finally:server.shutdown();server.server_close()
    def test_auth_uses_verified_user_and_active_row(self):
        auth=Auth('https://uuijfbpgvtdxgaosqpxo.supabase.co','anon');calls=[]
        def upstream(token,path,body=None):
            calls.append(path)
            if path=='/auth/v1/user':return {'id':'actual','user_metadata':{'role':'super_admin'}}
            if path.startswith('/rest/v1/admins'):return [{'id':'staff','user_id':'actual','active':True,'is_system_identity':False}]
            return None
        auth.request=upstream
        self.assertFalse(auth.actor('long-enough-session-token').owner)
        auth.actor('long-enough-session-token');self.assertEqual(len(calls),3)

if __name__=='__main__':unittest.main()


class ExportTest(StoreTest):
    def _fixture(self):
        self.grant(self.a)
        room=self.room(users=['a'])
        self.send(room,key='request-0001')
        now=time.time()
        self.s.db.execute('UPDATE messages SET created=?',(1793970000.0,))  # 2026-11-06 ~13:00 UTC = 15:00 Cairo (UTC+2)
        return room
    def test_owner_only(self):
        room=self._fixture()
        with self.assertRaises(Denied):self.s.export(self.a,'2026-11-06T00:00','2026-11-07T00:00')
    def test_range_cairo_and_columns(self):
        room=self._fixture()
        r=self.s.export(self.owner,'2026-11-06T15:00','2026-11-06T16:00')['rows']
        self.assertEqual(len(r),1);self.assertEqual(r[0]['time'][:16],'2026-11-06 15:00'.replace('15:00','15:00'))
        self.assertEqual(set(r[0]),{'time','room','sender','agent','text','attachments'})
        self.assertEqual(self.s.export(self.owner,'2026-11-06T16:00','2026-11-06T17:00')['rows'],[])
        self.assertEqual(self.s.export(self.owner,'2026-11-06T14:00','2026-11-06T15:00')['rows'],[])
    def test_history_fence_and_membership(self):
        room=self._fixture()
        other=self.room(users=[]);self.send(other,key='request-0002')
        self.s.db.execute('UPDATE messages SET created=?',(1793970000.0,))
        self.assertEqual(len(self.s.export(self.owner,'2026-11-06T00:00','2026-11-07T00:00')['rows']),2)
        self.assertEqual(len(self.s.export(self.owner,'2026-11-06T00:00','2026-11-07T00:00',room)['rows']),1)
        with self.assertRaises(Denied):self.s.export(self.owner,'2026-11-06T00:00','2026-11-07T00:00','missing')
        # owner removed from a room can no longer export it
        self.s.db.execute('DELETE FROM members WHERE room=? AND user_id=?',(other,'owner'))
        self.assertEqual(len(self.s.export(self.owner,'2026-11-06T00:00','2026-11-07T00:00')['rows']),1)
        with self.assertRaises(Denied):self.s.export(self.owner,'2026-11-06T00:00','2026-11-07T00:00',other)
        # since_seq fence
        self.s.db.execute('UPDATE members SET since_seq=? WHERE room=? AND user_id=?',(10**6,room,'owner'))
        self.assertEqual(self.s.export(self.owner,'2026-11-06T00:00','2026-11-07T00:00')['rows'],[])
    def test_bad_input(self):
        for a,b in (('x','y'),('2026-11-07T00:00','2026-11-06T00:00'),('2020-01-01T00:00','2026-01-01T00:00')):
            with self.assertRaises(Invalid):self.s.export(self.owner,a,b)


class ExportRouteTest(StoreTest):
    class FakeAuth:
        def __init__(self,actors):self.actors=actors
        def actor(self,token):return self.actors[token]
        def directory(self,token,a):return []
    def test_route_owner_ok_and_employee_403(self):
        self.grant(self.a);room=self.room(users=['a']);self.send(room)
        self.s.db.execute('UPDATE messages SET created=?',(1793970000.0,))
        svc=Service(self.s,self.FakeAuth({'o':self.owner,'e':self.a}))
        out=svc.handle('GET','/api/digital-team/export?from=2026-11-06T00:00&to=2026-11-07T00:00','o')
        self.assertEqual(len(out['rows']),1)
        with self.assertRaises(Denied):svc.handle('GET','/api/digital-team/export?from=2026-11-06T00:00&to=2026-11-07T00:00','e')


class LimitTest(StoreTest):
    def test_default_owner_only_bounds_and_effect(self):
        self.assertEqual(self.s.limit_info(self.owner)['limit'],4)
        with self.assertRaises(Denied):self.s.limit_info(self.a)
        with self.assertRaises(Denied):self.s.set_limit(self.a,10)
        for bad in (0,201,'5',True,None,2.5):
            with self.assertRaises(Invalid):self.s.set_limit(self.owner,bad)
        self.assertEqual(self.s.set_limit(self.owner,2)['limit'],2)
        self.assertEqual(self.s.daily_limit(),2)
        room=self.room()
        for i in range(3):
            self.send(room,key='request-%04d'%(i+10))
        got=[self.s.claim() for _ in range(3)]
        self.assertEqual(len([g for g in got if g]),2)
        self.assertEqual(self.s.limit_info(self.owner)['used'],2)
        self.s.set_limit(self.owner,200);self.assertEqual(self.s.daily_limit(),200)
