"""Durable server-side team conversations. No Supabase chat writes or shell execution."""
import contextlib
import json
import os
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass

AGENTS = {'codex': 'Codex', 'claude': 'Claude Code', 'sia': 'سيا', 'hapi': 'حابي', 'claude_creative': 'Claude Creative',
          'hor': 'حور', 'hotep': 'حتب', 'nefer': 'نفر', 'maat': 'ماعت'}

ENGINES = ('codex', 'claude')  # agents with a real runtime adapter in this gateway
DAILY_LIMIT = int(os.environ.get('SWNW_CHAT_DAILY_LIMIT', '4'))

class Denied(Exception):
    pass

class Invalid(Exception):
    pass

@dataclass(frozen=True)
class Actor:
    id: str
    name: str
    owner: bool = False

class Store:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
        PRAGMA foreign_keys=ON;
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY,calls INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS agents(code TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS grants(user_id TEXT, agent TEXT REFERENCES agents(code),
          chat INTEGER NOT NULL, task INTEGER NOT NULL, expires REAL,
          PRIMARY KEY(user_id,agent));
        CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, creator TEXT NOT NULL, title TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS members(room TEXT REFERENCES rooms(id), user_id TEXT,
          since_seq INTEGER NOT NULL, can_send INTEGER NOT NULL, can_manage INTEGER NOT NULL,
          PRIMARY KEY(room,user_id));
        CREATE TABLE IF NOT EXISTS room_agents(room TEXT REFERENCES rooms(id), agent TEXT REFERENCES agents(code),
          PRIMARY KEY(room,agent));
        CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
          room TEXT REFERENCES rooms(id), author TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
          body TEXT NOT NULL, created REAL NOT NULL, request_key TEXT, targets TEXT NOT NULL DEFAULT '[]', UNIQUE(room,author,request_key));
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, room TEXT REFERENCES rooms(id), message_id TEXT REFERENCES messages(id),
          user_id TEXT NOT NULL, agent TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL,
          text TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', updated REAL NOT NULL,
          UNIQUE(message_id,agent));
        CREATE TABLE IF NOT EXISTS sessions(room TEXT, agent TEXT, revision INTEGER, thread TEXT NOT NULL,
          PRIMARY KEY(room,agent,revision));
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
          target TEXT NOT NULL, created REAL NOT NULL);
        ''')
        self.db.executemany('INSERT OR IGNORE INTO agents VALUES(?,?)', AGENTS.items())
        # A process crash is ambiguous: never replay an in-flight model call automatically.
        self.db.execute("UPDATE jobs SET state='interrupted',error='انقطع التشغيل؛ أعد المحاولة بعد المراجعة',updated=? WHERE state='running'", (time.time(),))

    @contextlib.contextmanager
    def tx(self):
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            try:
                yield
                self.db.execute('COMMIT')
            except BaseException:
                self.db.execute('ROLLBACK')
                raise

    def rows(self, sql, args=()):
        return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def audit(self, actor, action, target):
        self.db.execute('INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)',
                        (actor.id, action, target, time.time()))

    def remember(self, actor):
        with self.lock:
            self.db.execute('INSERT INTO people VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', (actor.id, actor.name))
            if actor.owner:
                self.db.execute("INSERT OR REPLACE INTO meta VALUES('owner',?)",(actor.id,))

    def allowed(self, user, agent, action='chat'):
        if self.db.execute("SELECT 1 FROM meta WHERE key='owner' AND value=?",(user,)).fetchone():
            return True
        col = 'task' if action == 'task' else 'chat'
        return bool(self.db.execute(f'SELECT 1 FROM grants WHERE user_id=? AND agent=? AND chat=1 AND {col}=1 AND (expires IS NULL OR expires>?)',
                                    (user, agent, time.time())).fetchone())

    def has_chat(self, user):
        return bool(self.db.execute("SELECT 1 FROM meta WHERE key='owner' AND value=?",(user,)).fetchone() or self.db.execute('SELECT 1 FROM grants WHERE user_id=? AND chat=1 AND (expires IS NULL OR expires>?)',(user,time.time())).fetchone())

    def permission(self, actor, agent, action='chat'):
        return actor.owner or self.allowed(actor.id, agent, action)

    def room_agents(self, room):
        return [r['agent'] for r in self.rows('SELECT agent FROM room_agents WHERE room=? ORDER BY agent', (room,))]

    def membership(self, actor, room, send=False, manage=False):
        if not self.db.execute('SELECT 1 FROM rooms WHERE id=?', (room,)).fetchone():
            raise Denied('المحادثة غير متاحة')
        member = self.db.execute('SELECT * FROM members WHERE room=? AND user_id=?', (room, actor.id)).fetchone()
        if not member:
            raise Denied('المحادثة غير متاحة')
        if not actor.owner:
            if (send and not member['can_send']) or (manage and not member['can_manage']):
                raise Denied('ليس لديك وصول لهذا الإجراء')
            if not self.has_chat(actor.id) or any(not self.allowed(actor.id, a) for a in self.room_agents(room)):
                raise Denied('سُحبت صلاحية أحد الوكلاء')
        return dict(member)

    def bootstrap(self, actor):
        with self.lock:
            self.remember(actor)
            return {'me': {'id': actor.id, 'name': actor.name, 'owner': actor.owner},
                    'agents': [{'code': a, 'name': n, 'chat': self.permission(actor, a),
                                'task': self.permission(actor, a, 'task'),
                                'runtime': a if a in ENGINES else 'unconnected'} for a, n in AGENTS.items()]}

    def set_grant(self, actor, data, directory):
        if not actor.owner:
            raise Denied('إدارة الوصول للمالك')
        user, agent = data.get('user_id'), data.get('agent')
        target = next((p for p in directory if p['id'] == user), None)
        if not target or agent not in AGENTS:
            raise Invalid('اختر مستخدمًا مفعّلًا ووكيلًا من القائمة')
        chat, task = data.get('chat'), data.get('task', False)
        if not isinstance(chat, bool) or not isinstance(task, bool) or (task and not chat):
            raise Invalid('صلاحيات غير صالحة')
        expires = data.get('expires')
        if expires is not None and (not isinstance(expires, (int, float)) or not time.time() < expires < time.time()+366*86400):
            raise Invalid('تاريخ انتهاء غير صالح')
        with self.tx():
            self.db.execute('INSERT INTO people VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', (user, target['name']))
            self.db.execute('INSERT INTO grants VALUES(?,?,?,?,?) ON CONFLICT(user_id,agent) DO UPDATE SET chat=excluded.chat,task=excluded.task,expires=excluded.expires',
                            (user, agent, int(chat), int(task), expires))
            # Rotate context and stop work even when changing a grant for an existing participant.
            for r in self.rows('SELECT DISTINCT m.room FROM members m JOIN room_agents a ON a.room=m.room WHERE m.user_id=? AND a.agent=?', (user, agent)):
                self.rotate(r['room'])
            self.audit(actor, 'grant', f'{user}/{agent}')

    def rotate(self, room):
        self.db.execute('UPDATE rooms SET revision=revision+1,updated=? WHERE id=?', (time.time(), room))
        self.db.execute("UPDATE jobs SET state='cancelled',updated=? WHERE room=? AND state IN ('queued','running')", (time.time(), room))

    def grants(self, actor):
        if not actor.owner:
            raise Denied('إدارة الوصول للمالك')
        with self.lock:
            return self.rows('SELECT * FROM grants')

    def directory(self, actor, directory):
        if actor.owner:
            with self.lock:
                for p in directory:
                    self.db.execute('INSERT OR REPLACE INTO people VALUES(?,?)',(p['id'],p['name']))
            return directory
        if not self.db.execute('SELECT 1 FROM grants WHERE user_id=? AND chat=1 AND (expires IS NULL OR expires>?)',(actor.id,time.time())).fetchone():
            raise Denied('صلاحية الشات مطلوبة')
        directory=self.rows('SELECT id,name FROM people')
        # Only users with any active chat grant can be invited to human conversations.
        return [p for p in directory if self.allowed(p['id'],'codex') or self.db.execute('SELECT 1 FROM grants WHERE user_id=? AND chat=1 AND (expires IS NULL OR expires>?)', (p['id'], time.time())).fetchone()]

    def create(self, actor, data, directory):
        agents = data.get('agents', [])
        users = data.get('users', [])
        if not isinstance(agents, list) or not isinstance(users, list) or len(agents) > 8 or len(users) > 30:
            raise Invalid('مشاركون غير صالحين')
        if any(not isinstance(a, str) or a not in AGENTS for a in agents) or len(set(agents)) != len(agents):
            raise Invalid('وكيل غير صالح')
        if any(not isinstance(u, str) for u in users):
            raise Invalid('مستخدم غير صالح')
        users = list(dict.fromkeys([actor.id]+users))
        valid = {p['id']: p for p in directory}
        if not agents and len(users) < 2:
            raise Invalid('اختر مستخدمًا أو وكيلًا')
        title = str(data.get('title') or 'محادثة الفريق').strip()
        if not 1 <= len(title) <= 120:
            raise Invalid('اسم المحادثة غير صالح')
        with self.tx():
            if not actor.owner and not self.has_chat(actor.id):
                raise Denied('صلاحية الشات مطلوبة')
            for a in agents:
                if not self.permission(actor, a):
                    raise Denied('لا تملك صلاحية الوكيل')
            for u in users:
                if u != actor.id:
                    if u not in valid:
                        raise Denied('المستخدم غير متاح')
                    if agents and any(not self.allowed(u, a) for a in agents):
                        raise Denied('المستخدم لا يملك صلاحية جميع وكلاء المحادثة')
                    if not agents and not self.has_chat(u):
                        raise Denied('المستخدم لا يملك صلاحية الشات')
            room = str(uuid.uuid4())
            self.db.execute('INSERT INTO rooms(id,creator,title,updated) VALUES(?,?,?,?)', (room, actor.id, title, time.time()))
            self.db.executemany('INSERT INTO room_agents VALUES(?,?)', [(room, a) for a in agents])
            self.db.executemany('INSERT INTO members VALUES(?,?,?,?,?)', [(room,u,0,1,int(u==actor.id)) for u in users])
            for p in directory:
                if p['id'] in users:
                    self.db.execute('INSERT OR REPLACE INTO people VALUES(?,?)', (p['id'],p['name']))
            self.audit(actor, 'create_room', room)
            return room

    def rooms(self, actor):
        with self.lock:
            result = []
            for r in self.rows('SELECT r.* FROM rooms r JOIN members m ON m.room=r.id WHERE m.user_id=? ORDER BY r.updated DESC LIMIT 500',(actor.id,)):
                try:
                    m = self.membership(actor, r['id'])
                except Denied:
                    continue
                result.append({**r, 'agents': self.room_agents(r['id']), 'can_send': bool(m['can_send']),
                               'can_manage': bool(actor.owner or m['can_manage'])})
            return result

    def members(self, actor, room):
        with self.lock:
            self.membership(actor, room)
            return self.rows('SELECT m.user_id,m.since_seq,m.can_send,m.can_manage,p.name FROM members m LEFT JOIN people p ON p.id=m.user_id WHERE m.room=?', (room,))

    def set_members(self, actor, room, data, directory):
        users, agents = data.get('users'), data.get('agents')
        if not isinstance(users,list) or not isinstance(agents,list) or not users or len(users)>30 or len(agents)>8:
            raise Invalid('المشاركون غير صالحين')
        if any(not isinstance(u,dict) or not isinstance(u.get('id'),str) or not isinstance(u.get('send'),bool) or not isinstance(u.get('manage',False),bool) for u in users):
            raise Invalid('صلاحيات المشاركين غير صالحة')
        ids = [u['id'] for u in users]
        if len(set(ids)) != len(ids) or any(a not in AGENTS for a in agents) or len(set(agents)) != len(agents):
            raise Invalid('مشاركون غير صالحين')
        with self.tx():
            self.membership(actor,room,manage=True)
            creator = self.db.execute('SELECT creator FROM rooms WHERE id=?',(room,)).fetchone()[0]
            if creator not in ids or not next(u for u in users if u['id']==creator).get('manage',False):
                raise Invalid('احتفظ بمنشئ المحادثة وصلاحيته في إدارتها')
            valid = {p['id']:p for p in directory}
            old = {m['user_id']:m for m in self.rows('SELECT * FROM members WHERE room=?',(room,))}
            for u in users:
                if u['id'] not in valid and u['id'] != actor.id:
                    raise Denied('مستخدم غير متاح')
                # Non-owner managers can invite/send; only owner can delegate management.
                if not actor.owner and u.get('manage',False) != bool(old.get(u['id'],{}).get('can_manage',False)):
                    raise Denied('تفويض إدارة المحادثة للمالك')
                if not agents and not self.has_chat(u['id']):
                    raise Denied('المشارك لا يملك صلاحية الشات')
                if u['id'] != actor.id and any(not self.allowed(u['id'],a) for a in agents):
                    # The creator may be the global owner, identified only by this verified actor.
                    raise Denied('المشارك لا يملك صلاحية جميع الوكلاء')
                if any(not self.permission(actor,a) for a in agents):
                    raise Denied('الوكيل غير مصرح به')
            since = self.db.execute('SELECT COALESCE(MAX(seq),0)+1 FROM messages').fetchone()[0]
            self.db.execute('DELETE FROM members WHERE room=?',(room,))
            for u in users:
                floor = old[u['id']]['since_seq'] if u['id'] in old else (0 if data.get('share_history') is True else since)
                self.db.execute('INSERT INTO members VALUES(?,?,?,?,?)',(room,u['id'],floor,int(u['send']),int(u.get('manage',False))))
                if u['id'] in valid:
                    self.db.execute('INSERT OR REPLACE INTO people VALUES(?,?)',(u['id'],valid[u['id']]['name']))
            self.db.execute('DELETE FROM room_agents WHERE room=?',(room,))
            self.db.executemany('INSERT INTO room_agents VALUES(?,?)',[(room,a) for a in agents])
            self.rotate(room)
            self.audit(actor,'members_changed',room)

    def history(self, actor, room, before=None):
        with self.lock:
            m = self.membership(actor, room)
            ceiling = int(before) if before else 2**63-1
            rows = self.rows('SELECT * FROM messages WHERE room=? AND seq>=? AND seq<? ORDER BY seq DESC LIMIT 100', (room,m['since_seq'],ceiling))
            ids = [r['id'] for r in rows]
            jobs = self.rows('SELECT id,message_id,agent,state,text,error FROM jobs WHERE room=? ORDER BY updated DESC LIMIT 100',(room,))
            return {'messages':list(reversed(rows)), 'jobs':[j for j in jobs if j['message_id'] in ids],
                    'before': rows[-1]['seq'] if len(rows)==100 else None}

    def export(self, actor, frm, to, room=None):
        """Rows for export. Owner only (first release). from/to are Africa/Cairo wall-clock 'YYYY-MM-DDTHH:MM'; stored times are UTC epoch.
        Honors membership and the since_seq history fence exactly like history()."""
        from zoneinfo import ZoneInfo
        from datetime import datetime, timezone
        if not actor.owner:
            raise Denied('التصدير متاح للمالك فقط')
        cairo = ZoneInfo('Africa/Cairo')
        def parse(v):
            try:
                return datetime.strptime(str(v), '%Y-%m-%dT%H:%M').replace(tzinfo=cairo).timestamp()
            except ValueError:
                raise Invalid('صيغة الوقت غير صحيحة')
        start, end = parse(frm), parse(to)
        if end <= start:
            raise Invalid('نهاية الفترة قبل بدايتها')
        if end - start > 366 * 86400:
            raise Invalid('الفترة أطول من سنة')
        with self.lock:
            if room:
                room_ids = [room]
            else:
                room_ids = [r['room'] for r in self.rows('SELECT room FROM members WHERE user_id=?', (actor.id,))]
            out = []
            for rid in room_ids:
                try:
                    m = self.membership(actor, rid)
                except Denied:
                    if room:
                        raise
                    continue
                title = self.db.execute('SELECT title FROM rooms WHERE id=?', (rid,)).fetchone()['title']
                for r in self.rows('SELECT * FROM messages WHERE room=? AND seq>=? AND created>=? AND created<? ORDER BY created,seq LIMIT 20001',
                                   (rid, m['since_seq'], start, end)):
                    agent = AGENTS.get(r['author'][6:], '') if r['author'].startswith('agent:') else ', '.join(AGENTS.get(a, a) for a in json.loads(r['targets']))
                    out.append({'time': datetime.fromtimestamp(r['created'], timezone.utc).astimezone(cairo).strftime('%Y-%m-%d %H:%M:%S'),
                                'room': title, 'sender': r['name'], 'agent': agent, 'text': r['body'], '_t': r['created']})
            if len(out) > 20000:
                raise Invalid('النتائج أكثر من 20000 رسالة؛ ضيّق الفترة')
            out.sort(key=lambda x: x['_t'])
            for x in out:
                del x['_t']
            self.audit(actor, 'export', room or '*')
            return {'rows': out}

    def send(self, actor, room, data):
        body, key, kind = data.get('body'),data.get('request_key'),data.get('kind','chat')
        targets = data.get('targets',[])
        if not isinstance(body,str) or not 1<=len(body.strip())<=4000 or not isinstance(key,str) or not 8<=len(key)<=80:
            raise Invalid('نص الرسالة أو معرّف الإرسال غير صالح')
        if kind not in ('chat','question','instruction','task') or not isinstance(targets,list) or any(not isinstance(a,str) for a in targets):
            raise Invalid('نوع الرسالة غير صالح')
        with self.tx():
            self.membership(actor,room,send=True)
            available = self.room_agents(room)
            if any(a not in available for a in targets):
                raise Denied('الوكيل ليس في المحادثة')
            targets = list(dict.fromkeys(targets))
            if len(available)==1 and not targets:
                targets = available
            if any(not self.permission(actor,a,'task' if kind=='task' else 'chat') for a in targets):
                raise Denied('التكليف غير مصرح به')
            old = self.db.execute('SELECT * FROM messages WHERE room=? AND author=? AND request_key=?',(room,actor.id,key)).fetchone()
            if old:
                if old['body'] != body.strip() or old['kind'] != kind or json.loads(old['targets']) != sorted(targets):
                    raise Invalid('معرّف الإرسال مستخدم لرسالة مختلفة')
                return {'message_id':old['id'],'duplicate':True}
            if self.db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('queued','running')").fetchone()[0]>=20:
                raise Invalid('قائمة الانتظار ممتلئة؛ حاول بعد انتهاء الطلبات')
            if self.db.execute('SELECT COUNT(*) FROM messages WHERE author=? AND created>?',(actor.id,time.time()-60)).fetchone()[0]>=12:
                raise Invalid('انتظر قليلًا قبل إرسال رسالة أخرى')
            mid = str(uuid.uuid4()); now=time.time()
            self.db.execute('INSERT INTO messages(id,room,author,name,kind,body,created,request_key,targets) VALUES(?,?,?,?,?,?,?,?,?)',
                            (mid,room,actor.id,actor.name,kind,body.strip(),now,key,json.dumps(sorted(targets))))
            rev=self.db.execute('SELECT revision FROM rooms WHERE id=?',(room,)).fetchone()[0]
            for a in targets:
                state = 'awaiting_owner' if kind=='task' else ('queued' if a in ENGINES else 'unconnected')
                self.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)',
                                (str(uuid.uuid4()),room,mid,actor.id,a,rev,state,'','',now))
            self.db.execute('UPDATE rooms SET updated=? WHERE id=?',(now,room))
            self.audit(actor,'message',mid)
            return {'message_id':mid,'duplicate':False}

    def claim(self):
        with self.tx():
            job=self.db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY updated LIMIT 1").fetchone()
            if not job:
                return None
            day=time.strftime('%Y-%m-%d',time.gmtime())
            used=self.db.execute('SELECT calls FROM usage WHERE day=?',(day,)).fetchone()
            if used and used[0]>=DAILY_LIMIT:
                self.db.execute("UPDATE jobs SET state='limited',error='بلغت حصة المحادثات اليومية',updated=? WHERE id=?",(time.time(),job['id']))
                return None
            self.db.execute('INSERT INTO usage VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1',(day,))
            self.db.execute("UPDATE jobs SET state='running',updated=? WHERE id=?",(time.time(),job['id']))
            return dict(job)

    def current(self, job):
        row=self.db.execute('SELECT state,revision FROM jobs WHERE id=?',(job['id'],)).fetchone()
        room=self.db.execute('SELECT revision FROM rooms WHERE id=?',(job['room'],)).fetchone()
        return bool(row and room and row['state']=='running' and row['revision']==room['revision']==job['revision'])

    def context(self, job):
        with self.lock:
            if not self.current(job):
                raise Denied('تغير المشاركون أو أُلغي الطلب')
            floor=self.db.execute('SELECT COALESCE(MAX(since_seq),0) FROM members WHERE room=?',(job['room'],)).fetchone()[0]
            end=self.db.execute('SELECT seq FROM messages WHERE id=?',(job['message_id'],)).fetchone()[0]
            rows=self.rows('SELECT name,body,kind FROM messages WHERE room=? AND seq>=? AND seq<=? ORDER BY seq DESC LIMIT 40',(job['room'],floor,end))
            # No persistent engine thread is reused after membership changes.
            session=self.db.execute('SELECT thread FROM sessions WHERE room=? AND agent=? AND revision=?',(job['room'],job['agent'],job['revision'])).fetchone()
            bounded=[];size=0
            for row in rows:
                size+=len(row['body'])
                if size>24000 and bounded:break
                bounded.append(row)
            return list(reversed(bounded)), session[0] if session else None

    def session(self, job, thread):
        with self.lock:
            if self.current(job):
                self.db.execute('INSERT OR REPLACE INTO sessions VALUES(?,?,?,?)',(job['room'],job['agent'],job['revision'],thread))

    def progress(self, job, text):
        with self.lock:
            if self.current(job):
                self.db.execute('UPDATE jobs SET text=?,updated=? WHERE id=?',(text[-24000:],time.time(),job['id']))

    def finish(self, job, text='', error=''):
        with self.tx():
            if not self.current(job):
                return
            state='failed' if error else 'complete'
            self.db.execute('UPDATE jobs SET state=?,text=?,error=?,updated=? WHERE id=?',(state,text[-24000:],error[:240],time.time(),job['id']))
            if text and not error:
                self.db.execute('INSERT INTO messages(id,room,author,name,kind,body,created) VALUES(?,?,?,?,?,?,?)',
                                (str(uuid.uuid4()),job['room'],'agent:'+job['agent'],AGENTS[job['agent']],'reply',text[-24000:],time.time()))
            self.db.execute('UPDATE rooms SET updated=? WHERE id=?',(time.time(),job['room']))

    def cancel(self, actor, room, jid):
        with self.tx():
            self.membership(actor,room,send=True)
            job=self.db.execute('SELECT * FROM jobs WHERE id=? AND room=?',(jid,room)).fetchone()
            if not job or (not actor.owner and job['user_id']!=actor.id):
                raise Denied('لا يمكن إيقاف هذا الطلب')
            self.db.execute("UPDATE jobs SET state='cancelled',updated=? WHERE id=? AND state IN ('queued','running','awaiting_owner')",(time.time(),jid))
            self.audit(actor,'cancel',jid)
