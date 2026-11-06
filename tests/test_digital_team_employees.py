import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server/digital_team'))
sys.path.insert(0, str(ROOT / 'tests'))
from store import Store, Actor, Denied, Invalid
from app import Service
from knowledge import Knowledge, Viewer
import test_digital_team_knowledge as tk

SYNC = ROOT / 'server/digital_team/deploy/sono-pack-sync.sh'


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Store(str(Path(self.tmp.name) / 'chat.db'))
        self.owner, self.a, self.b = Actor('owner', 'محمد', True), Actor('a', 'موظف أ'), Actor('b', 'موظف ب')
        self.directory = [{'id': x.id, 'name': x.name} for x in (self.owner, self.a, self.b)]
        for x in (self.owner, self.a, self.b):
            self.s.remember(x)

    def tearDown(self):
        self.s.db.close()
        self.tmp.cleanup()

    def enable(self, per_user=3, total=30):
        self.s.set_employees(self.owner, {'enabled': True, 'per_user': per_user, 'total': total})

    def room(self, actor, agents=('codex',)):
        return self.s.create(actor, {'agents': list(agents), 'users': [], 'title': 'سونو'}, self.directory)

    n = 0

    def ask(self, actor, room, kind='question'):
        Base.n += 1
        return self.s.send(actor, room, {'body': 'سؤال', 'request_key': 'key-%06d' % Base.n, 'kind': kind, 'targets': ['codex']})


class AccessTests(Base):
    def test_off_by_default_employee_blocked(self):
        self.assertFalse(self.s.employees_enabled())
        self.assertFalse(self.s.has_chat('a'))
        with self.assertRaises(Denied):
            self.room(self.a)

    def test_on_employee_can_chat_with_codex_only(self):
        self.enable()
        r = self.room(self.a)
        self.ask(self.a, r)
        with self.assertRaises(Denied):
            self.room(self.a, agents=('claude',))  # Claude stays owner-only
        with self.assertRaises(Denied):
            self.ask(self.a, r, kind='task')  # no execution requests from employees
        with self.assertRaises(Denied):
            self.room(self.a, agents=('sia',))

    def test_switch_off_again_blocks_new_rooms(self):
        self.enable()
        self.s.set_employees(self.owner, {'enabled': False})
        with self.assertRaises(Denied):
            self.room(self.a)

    def test_only_owner_changes_settings(self):
        with self.assertRaises(Denied):
            self.s.set_employees(self.a, {'enabled': True})
        with self.assertRaises(Denied):
            self.s.employees_info(self.a)

    def test_validation(self):
        for bad in ({}, {'enabled': 'yes'}, {'per_user': 0}, {'per_user': 51}, {'total': 501}, {'total': True}, {'per_user': 2.5}, 'x'):
            with self.assertRaises(Invalid):
                self.s.set_employees(self.owner, bad)

    def test_service_availability(self):
        svc = Service(self.s, None, runtime=object(), claude=object())
        self.assertFalse(svc.available('codex', self.a))
        self.enable()
        self.assertTrue(svc.available('codex', self.a))
        self.assertFalse(svc.available('claude', self.a))
        self.assertTrue(svc.available('claude', self.owner))

    def test_employee_rooms_are_private(self):
        self.enable()
        ra = self.room(self.a)
        self.ask(self.a, ra)
        with self.assertRaises(Denied):
            self.s.history(self.b, ra)
        self.assertEqual(self.s.rooms(self.b), [])
        with self.assertRaises(Denied):
            self.ask(self.b, ra)


class LimitTests(Base):
    def run_jobs(self, actor, room, n):
        out = []
        for _ in range(n):
            self.ask(actor, room)
            out.append(self.s.claim())
        return out

    def test_per_user_limit(self):
        self.enable(per_user=2)
        r = self.room(self.a)
        got = self.run_jobs(self.a, r, 3)
        self.assertTrue(got[0] and got[1])
        self.assertIsNone(got[2])
        j = self.s.history(self.a, r)['jobs']
        self.assertIn('limited', {x['state'] for x in j})
        self.assertIn('حصتك اليومية', ' '.join(x['error'] for x in j))
        # another employee is unaffected
        rb = self.room(self.b)
        self.assertTrue(self.run_jobs(self.b, rb, 1)[0])

    def test_total_limit(self):
        self.enable(per_user=5, total=3)
        ra, rb = self.room(self.a), self.room(self.b)
        self.assertTrue(all(self.run_jobs(self.a, ra, 2)))
        self.assertTrue(self.run_jobs(self.b, rb, 1)[0])
        self.assertIsNone(self.run_jobs(self.b, rb, 1)[0])
        self.assertIn('حصة الموظفين', ' '.join(x['error'] for x in self.s.history(self.b, rb)['jobs']))

    def test_owner_and_employee_quotas_are_separate(self):
        self.enable(per_user=1, total=1)
        self.s.set_limit(self.owner, 1)
        ro, ra = self.room(self.owner), self.room(self.a)
        self.assertTrue(self.run_jobs(self.a, ra, 1)[0])  # employee spends the employee budget only
        self.assertTrue(self.run_jobs(self.owner, ro, 1)[0])  # owner budget untouched
        self.assertIsNone(self.run_jobs(self.owner, ro, 1)[0])  # now the owner's own limit applies
        self.assertIsNone(self.run_jobs(self.a, ra, 1)[0])

    def test_switch_off_stops_queued_employee_work(self):
        self.enable()
        r = self.room(self.a)
        self.ask(self.a, r)
        self.s.set_employees(self.owner, {'enabled': False})
        self.assertIsNone(self.s.claim())
        self.assertIn('متوقفة', ' '.join(x['error'] for x in self.s.rows('SELECT error FROM jobs')))
        with self.assertRaises(Denied):
            self.s.history(self.a, r)  # and the employee loses access to the room itself

    def test_info_lists_usage_by_name_without_owner(self):
        self.enable(per_user=5)
        ra, ro = self.room(self.a), self.room(self.owner)
        self.run_jobs(self.a, ra, 2)
        self.run_jobs(self.owner, ro, 1)
        info = self.s.employees_info(self.owner)
        self.assertEqual(info['used_total'], 2)
        self.assertEqual(info['users'], [{'name': 'موظف أ', 'calls': 2}])

    def test_grant_users_keep_legacy_behaviour_when_switch_off(self):
        self.s.set_grant(self.owner, {'user_id': 'a', 'agent': 'codex', 'chat': True, 'task': False}, self.directory)
        r = self.room(self.a)
        self.ask(self.a, r)
        self.assertTrue(self.s.claim())


class StubAuth:
    def actor(self, token):
        return {'o': Actor('owner', 'م', True), 'a': Actor('a', 'أ')}[token[:1]]


class RouteTests(Base):
    def test_routes_owner_only(self):
        svc = Service(self.s, StubAuth())
        out = svc.handle('POST', '/api/digital-team/employees', 'o' * 30, {'enabled': True, 'per_user': 2})
        self.assertTrue(out['enabled'])
        self.assertEqual(svc.handle('GET', '/api/digital-team/employees', 'o' * 30)['per_user'], 2)
        with self.assertRaises(Denied):
            svc.handle('GET', '/api/digital-team/employees', 'a' * 30)
        with self.assertRaises(Denied):
            svc.handle('POST', '/api/digital-team/employees', 'a' * 30, {'enabled': False})


class HotReloadTests(tk.Base):
    def test_swap_and_broken_pack(self):
        t = Path(self.tmp.name)
        tk.build(self.repo, t / 'p1', sha='a' * 40)
        tk.build(self.repo, t / 'p2', sha='b' * 40)
        link = t / 'knowledge'
        link.symlink_to('p1')
        kb = Knowledge(link, release_id='b' * 40)
        self.assertEqual(kb.status(), 'mismatch')
        tmp_link = t / 'k.new'
        tmp_link.symlink_to('p2')
        os.replace(tmp_link, link)
        self.assertEqual(kb.status(), 'match')  # picked up without restart
        # a tampered new pack is never served: previous verified pack stays, failure recorded
        tk.build(self.repo, t / 'p3', sha='c' * 40)
        p = t / 'p3/employee.json'
        p.write_text(p.read_text(encoding='utf8').replace('ليد', 'لید'), encoding='utf8')
        tmp_link.symlink_to('p3')
        os.replace(tmp_link, link)
        self.assertEqual(kb.status(), 'match')  # still serving the verified b-pack (live = b)
        self.assertEqual(kb.manifest['commit_sha'], 'b' * 40)
        self.assertEqual(kb.reload_error, 'PackError')
        self.assertTrue(kb.select(Viewer(owner=True), 'تسجيل ليد جديد'))


class SyncScriptTests(unittest.TestCase):
    def sh(self, *args, env=None, cwd=None):
        e = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@e.invalid', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@e.invalid', **(env or {}))
        return subprocess.run(args, capture_output=True, text=True, env=e, cwd=cwd)

    def test_build_swap_idempotent_and_guards(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            repo, root = t / 'src', t / 'root'
            repo.mkdir(); root.mkdir()
            tk.make_repo(repo)
            self.sh('git', 'init', '-q', cwd=repo)
            self.sh('git', 'add', '-A', cwd=repo)
            self.sh('git', 'commit', '-qm', 'one', cwd=repo)
            c1 = self.sh('git', 'rev-parse', 'HEAD', cwd=repo).stdout.strip()
            (repo / 'docs/x.md').write_text('x')
            self.sh('git', 'add', '-A', cwd=repo)
            self.sh('git', 'commit', '-qm', 'two', cwd=repo)
            c2 = self.sh('git', 'rev-parse', 'HEAD', cwd=repo).stdout.strip()
            rel = t / 'CURRENT'
            env = {'SONO_RELEASE_FILE': str(rel), 'SONO_PACK_REPO': str(repo), 'SONO_PACK_ROOT': str(root),
                   'SONO_PACK_BUILDER': str(ROOT / 'scripts/build-sono-knowledge.py'), 'SONO_PACK_FETCH': '0'}
            rel.write_text(c1[:12])
            r = self.sh('bash', str(SYNC), env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(os.readlink(root / 'knowledge'), 'knowledge-' + c1[:12])
            self.assertEqual(json.loads((root / 'knowledge/manifest.json').read_text())['commit_sha'], c1)
            self.assertEqual(Knowledge(root / 'knowledge', release_file=rel).status(), 'match')
            self.assertIn('already current', self.sh('bash', str(SYNC), env=env).stdout)
            rel.write_text(c2[:12])
            self.assertEqual(self.sh('bash', str(SYNC), env=env).returncode, 0)
            self.assertEqual(os.readlink(root / 'knowledge'), 'knowledge-' + c2[:12])
            self.assertTrue((root / ('knowledge-' + c1[:12])).is_dir())  # previous kept for rollback
            for bad in ('not-hex', '', 'f' * 12):
                rel.write_text(bad)
                r = self.sh('bash', str(SYNC), env=env)
                self.assertNotEqual(r.returncode, 0, bad)
            self.assertEqual(os.readlink(root / 'knowledge'), 'knowledge-' + c2[:12])  # failures never move the live link
            self.assertEqual([p.name for p in root.iterdir() if p.name.startswith('.pack-tmp')], [])


if __name__ == '__main__':
    unittest.main()
