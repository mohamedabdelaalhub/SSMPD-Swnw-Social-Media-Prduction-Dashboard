import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server/digital_team'))
from store import Store, Actor, Denied, Invalid


class InsightsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Store(str(Path(self.tmp.name) / 'chat.db'))
        self.owner, self.a, self.b = Actor('owner', 'محمد', True), Actor('a', 'موظف أ'), Actor('b', 'موظف ب')
        self.dir = [{'id': x.id, 'name': x.name} for x in (self.owner, self.a, self.b)]
        for x in (self.owner, self.a, self.b):
            self.s.remember(x)
        for u in ('a', 'b'):
            self.s.set_grant(self.owner, {'user_id': u, 'agent': 'codex', 'chat': True}, self.dir)
        self.n = 0

    def tearDown(self):
        self.s.db.close()
        self.tmp.cleanup()

    def say(self, actor, room, text):
        self.n += 1
        return self.s.send(actor, room, {'body': text, 'request_key': 'k%08d' % self.n, 'kind': 'chat', 'targets': []})

    def reply(self, room, text, job='job1'):
        self.s.db.execute("INSERT INTO messages(id,room,author,name,kind,body,created,job_id) VALUES(?,?,?,?,?,?,?,?)",
                          ('r%d' % self.n, room, 'agent:codex', 'Codex', 'reply', text, time.time(), job))
        self.n += 1
        return 'r%d' % (self.n - 1)

    def test_rating_per_user_and_membership(self):
        room = self.s.create(self.owner, {'agents': [], 'users': ['a'], 'title': 'x'}, self.dir)
        mid = self.reply(room, 'رد')
        self.s.rate(self.a, mid, 1)
        self.s.rate(self.a, mid, -1)  # changes, never duplicates
        h = self.s.history(self.a, room)
        self.assertEqual([m['my_rating'] for m in h['messages'] if m['id'] == mid], [-1])
        self.assertEqual(self.s.history(self.owner, room)['messages'][-1]['my_rating'], 0)
        self.assertEqual(self.s.overview(self.owner)['ratings'], {'up': 0, 'down': 1})
        self.s.rate(self.a, mid, 0)
        self.assertEqual(self.s.overview(self.owner)['ratings'], {'up': 0, 'down': 0})
        with self.assertRaises(Denied):
            self.s.rate(self.b, mid, 1)  # not a member
        with self.assertRaises(Invalid):
            self.s.rate(self.a, mid, 5)
        um = self.say(self.a, room, 'سؤال')['message_id']
        with self.assertRaises(Denied):
            self.s.rate(self.a, um, 1)  # only agent replies are rateable

    def test_sources_follow_the_reply(self):
        room = self.s.create(self.owner, {'agents': [], 'users': ['a'], 'title': 'x'}, self.dir)
        mid = self.reply(room, 'رد', job='jobX')
        self.s.set_sources('jobX', [{'id': 'help:add', 'title': 'إضافة حجز'}, {'id': 'x' * 500, 'title': 'ت' * 500}])
        msg = [m for m in self.s.history(self.a, room)['messages'] if m['id'] == mid][0]
        self.assertEqual(msg['sources'][0], {'id': 'help:add', 'title': 'إضافة حجز'})
        self.assertLessEqual(len(msg['sources'][1]['id']), 120)
        self.assertNotIn('job_id', msg)

    def test_search_only_sees_own_rooms_and_literal_wildcards(self):
        mine = self.s.create(self.owner, {'agents': [], 'users': ['a'], 'title': 'عام'}, self.dir)
        other = self.s.create(self.owner, {'agents': [], 'users': ['b'], 'title': 'خاص'}, self.dir)
        self.say(self.owner, mine, 'موعد الدكتور غدا 100% مؤكد')
        self.say(self.owner, other, 'موعد سري للموظف ب')
        res = self.s.search(self.a, 'موعد')['results']
        self.assertEqual([r['room'] for r in res], [mine])
        self.assertEqual(len(self.s.search(self.a, '100%')['results']), 1)
        self.assertEqual(self.s.search(self.a, 'غد%')['results'], [])  # % is literal, not a wildcard
        with self.assertRaises(Invalid):
            self.s.search(self.a, 'م')

    def test_search_respects_history_cutoff_for_new_members(self):
        room = self.s.create(self.owner, {'agents': [], 'users': ['a'], 'title': 'x'}, self.dir)
        self.say(self.owner, room, 'رسالة قديمة سرية')
        self.s.set_members(self.owner, room, {'users': [{'id': 'owner', 'send': True, 'manage': True}, {'id': 'a', 'send': True, 'manage': False}, {'id': 'b', 'send': True, 'manage': False}], 'agents': [], 'share_history': False}, self.dir)
        self.assertEqual(self.s.search(self.b, 'سرية')['results'], [])
        self.assertEqual(len(self.s.search(self.a, 'سرية')['results']), 1)

    def test_unanswered_owner_only_with_asker_and_question(self):
        room = self.s.create(self.owner, {'agents': [], 'users': ['a'], 'title': 'سونو'}, self.dir)
        self.say(self.a, room, 'ازاي اطبع فاتورة ضريبية؟')
        self.reply(room, 'هذه المعلومة غير موثقة في الدليل.')
        self.say(self.a, room, 'سؤال تاني')
        self.reply(room, 'الخطوات: ١ ٢ ٣')
        items = self.s.unanswered(self.owner)['items']
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]['asker'], items[0]['question']), ('موظف أ', 'ازاي اطبع فاتورة ضريبية؟'))
        self.assertEqual(self.s.overview(self.owner)['unanswered'], 1)
        for fn in (self.s.unanswered, self.s.overview, self.s.usage_report, self.s.audit_log):
            with self.assertRaises(Denied):
                fn(self.a)

    def test_quota_and_usage_report_exclude_owner(self):
        day = time.strftime('%Y-%m-%d', time.gmtime())
        self.s.db.execute('INSERT INTO usage VALUES(?,?)', (day, 5))
        self.s.db.execute('INSERT INTO usage_user VALUES(?,?,?)', (day, 'a', 2))
        self.s.db.execute('INSERT INTO usage_user VALUES(?,?,?)', (day, 'owner', 3))
        self.s.db.execute("INSERT OR REPLACE INTO meta VALUES('owner','owner')")
        q = self.s.my_quota(self.a)
        self.assertEqual((q['owner'], q['used'], q['remaining']), (False, 2, q['limit'] - 2))
        rep = self.s.usage_report(self.owner)
        self.assertEqual([u['name'] for u in rep['users']], ['موظف أ'])
        self.assertEqual(rep['days'][0]['calls'], 5)
        self.assertTrue(self.s.my_quota(self.owner)['owner'])

    def test_audit_log_lists_grant_changes_with_names(self):
        log = self.s.audit_log(self.owner)['items']
        self.assertTrue(any(i['action'] for i in log))
        self.assertTrue(all('actor' in i for i in log))


if __name__ == '__main__':
    unittest.main()
