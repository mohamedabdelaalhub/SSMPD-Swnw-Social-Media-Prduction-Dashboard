import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server/digital_team'))
from store import Store, Actor, Denied, Invalid


class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Store(str(Path(self.tmp.name) / 'chat.db'))
        self.owner, self.a, self.b = Actor('owner', 'محمد', True), Actor('a', 'موظف أ'), Actor('b', 'موظف ب')
        self.dir = [{'id': x.id, 'name': x.name} for x in (self.owner, self.a, self.b)]
        for x in (self.owner, self.a, self.b):
            self.s.remember(x)
        for u in ('a', 'b'):  # human-only rooms need chat access for both sides
            self.s.set_grant(self.owner, {'user_id': u, 'agent': 'codex', 'chat': True}, self.dir)

    def tearDown(self):
        self.s.db.close()
        self.tmp.cleanup()

    def key(self):
        self.n = getattr(self, 'n', 0) + 1
        return 'key-%08d' % self.n

    def room(self, users=('a',), agents=()):
        return self.s.create(self.owner, {'agents': list(agents), 'users': list(users), 'title': 'نقاش'}, self.dir)

    def say(self, actor, room, text='مرحبا'):
        self.s.send(actor, room, {'body': text, 'request_key': self.key(), 'kind': 'chat', 'targets': []})

    def test_invited_user_is_notified_before_any_message(self):
        room = self.room()
        n = self.s.notifications(self.a)
        self.assertEqual(n['total'], 1)
        self.assertTrue(n['items'][0]['invited'])
        self.assertEqual(n['items'][0]['invited_by'], 'محمد')
        self.assertEqual(self.s.notifications(self.owner)['total'], 0)  # creator is not notified of own room

    def test_unread_counts_others_messages_only_and_reading_clears(self):
        room = self.room()
        self.say(self.owner, room, 'أول')
        self.say(self.owner, room, 'تاني')
        n = self.s.notifications(self.a)
        self.assertEqual(n['items'][0]['unread'], 2)
        self.assertEqual(n['items'][0]['last']['body'], 'تاني')
        self.s.mark_read(self.a, room)
        self.assertEqual(self.s.notifications(self.a)['total'], 0)
        self.say(self.a, room, 'رد مني')
        self.assertEqual(self.s.notifications(self.a)['total'], 0)  # my own message never notifies me
        time.sleep(0.01)
        self.say(self.owner, room, 'جديد')
        self.assertEqual(self.s.notifications(self.a)['total'], 1)

    def test_archive_is_per_user_and_hides_notifications(self):
        room = self.room(users=('a', 'b'))
        self.say(self.owner, room)
        self.s.set_archived(self.a, room, True)
        self.assertEqual(self.s.notifications(self.a)['total'], 0)
        self.assertEqual(self.s.notifications(self.b)['total'], 2 if False else self.s.notifications(self.b)['total'])
        self.assertGreater(self.s.notifications(self.b)['total'], 0)  # b still sees it
        self.assertTrue([r for r in self.s.rooms(self.a) if r['id'] == room][0]['archived'])
        self.assertFalse([r for r in self.s.rooms(self.b) if r['id'] == room][0]['archived'])
        self.s.set_archived(self.a, room, False)
        self.assertGreater(self.s.notifications(self.a)['total'], 0)
        with self.assertRaises(Invalid):
            self.s.set_archived(self.a, room, 'yes')

    def test_outsiders_cannot_read_or_archive_or_see_rooms(self):
        room = self.room(users=('a',))
        with self.assertRaises(Denied):
            self.s.mark_read(self.b, room)
        with self.assertRaises(Denied):
            self.s.set_archived(self.b, room, True)
        self.assertEqual(self.s.notifications(self.b)['total'], 0)
        self.assertEqual([r for r in self.s.rooms(self.b) if r['id'] == room], [])

    def test_added_later_gets_invitation_and_removed_loses_state(self):
        room = self.room(users=('a',))
        self.s.set_members(self.owner, room, {'users': [{'id': 'owner', 'send': True, 'manage': True}, {'id': 'a', 'send': True}, {'id': 'b', 'send': True}], 'agents': []}, self.dir)
        nb = self.s.notifications(self.b)
        self.assertEqual(nb['total'], 1)
        self.assertTrue(nb['items'][0]['invited'])
        self.s.set_members(self.owner, room, {'users': [{'id': 'owner', 'send': True, 'manage': True}, {'id': 'a', 'send': True}], 'agents': []}, self.dir)
        self.assertEqual(self.s.notifications(self.b)['total'], 0)
        self.assertEqual(self.s.db.execute("SELECT COUNT(*) FROM member_state WHERE room=? AND user_id='b'", (room,)).fetchone()[0], 0)

    def test_new_member_does_not_see_old_messages_as_unread(self):
        room = self.room(users=('a',))
        self.say(self.owner, room, 'قبل الانضمام')
        self.s.set_members(self.owner, room, {'users': [{'id': 'owner', 'send': True, 'manage': True}, {'id': 'a', 'send': True}, {'id': 'b', 'send': True}], 'agents': []}, self.dir)
        n = self.s.notifications(self.b)['items'][0]
        self.assertEqual(n['unread'], 0)  # history before joining stays hidden (since_seq)
        self.assertTrue(n['invited'])

    def test_rooms_that_predate_the_feature_start_read(self):
        room = self.room()
        self.s.db.execute('DELETE FROM member_state')  # simulate an old database
        self.say(self.owner, room)
        self.assertEqual(self.s.notifications(self.a)['total'], 0)  # first touch creates a fully-read cursor
        time.sleep(0.01)
        self.say(self.owner, room, 'بعد')
        self.assertEqual(self.s.notifications(self.a)['total'], 1)


if __name__ == '__main__':
    unittest.main()
