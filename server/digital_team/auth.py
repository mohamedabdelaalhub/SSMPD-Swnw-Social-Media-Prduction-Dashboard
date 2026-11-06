"""Validate the existing dashboard session upstream; never accept browser role claims."""
import hashlib
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from store import Actor, Denied

class Auth:
    def __init__(self, url, anon_key):
        if not url.startswith('https://') or urllib.parse.urlsplit(url).hostname != 'uuijfbpgvtdxgaosqpxo.supabase.co':
            raise ValueError('Use the approved Swnw Supabase project')
        self.url, self.key = url.rstrip('/'), anon_key
        self.cache = {}; self.lock=threading.Lock()

    def request(self, token, path, body=None):
        req=urllib.request.Request(self.url+path, data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization':'Bearer '+token,'apikey':self.key,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.load(r)
        except (urllib.error.URLError, ValueError):
            raise Denied('تعذر التحقق من حسابك؛ سجّل الدخول ثم أعد المحاولة') from None

    def actor(self, token):
        if not isinstance(token,str) or not 20 <= len(token) <= 8000:
            raise Denied('سجّل الدخول أولًا')
        key=hashlib.sha256(token.encode()).digest()
        with self.lock:
            old=self.cache.get(key)
            if old and old[0] > time.time():
                return old[1]
        user=self.request(token,'/auth/v1/user')
        uid=user.get('id')
        if not uid or user.get('is_anonymous'):
            raise Denied('حساب موظف مطلوب')
        rows=self.request(token,'/rest/v1/admins?select=id,name,user_id,active,is_system_identity&user_id=eq.'+urllib.parse.quote(uid,safe=''))
        rows=[r for r in rows if r.get('user_id')==uid and r.get('active') and not r.get('is_system_identity')]
        if len(rows)!=1:
            raise Denied('حسابك غير مفعّل للدخول')
        owner=self.request(token,'/rest/v1/rpc/digital_chat_owner',{})
        a=Actor(rows[0]['id'],rows[0].get('name') or 'مستخدم',owner==rows[0]['id'])
        # Bounded cache avoids one upstream request per chat poll. Local ACL revocations are immediate.
        with self.lock:
            self.cache={k:v for k,v in self.cache.items() if v[0]>time.time()}
            if len(self.cache)>1000:
                self.cache.clear()
            self.cache[key]=(time.time()+15,a)
        return a

    def viewer_roles(self, token, admin_id):
        """Roles of the CALLER (primary + extra), read with the caller's own token under RLS. None on any failure
        (the knowledge filter then fails closed)."""
        q=urllib.parse.quote(str(admin_id),safe='')
        try:
            base=self.request(token,'/rest/v1/admins?select=id,role&id=eq.'+q)
            extra=self.request(token,'/rest/v1/admin_extra_roles?select=admin_id,role&admin_id=eq.'+q)
        except Denied:
            return None
        roles={r['role'] for r in base if r.get('id')==admin_id and isinstance(r.get('role'),str)}
        roles|={r['role'] for r in extra if r.get('admin_id')==admin_id and isinstance(r.get('role'),str)}
        return sorted(roles)

    def directory(self, token, actor):
        # Existing admins RLS determines which directory entries this caller may discover.
        rows=self.request(token,'/rest/v1/admins?select=id,name,active,user_id,is_system_identity&active=eq.true&is_system_identity=eq.false&limit=1000')
        return [{'id':r['id'],'name':r.get('name') or 'مستخدم'} for r in rows
                if r.get('active') and r.get('user_id') and not r.get('is_system_identity')]
