import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server/digital_team'))
from execution import ExecutionRunner, ExecutionRefused, claude_command


class ExecutionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'; self.repo.mkdir()
        for c in (['init', '-q', '-b', 'main'], ['config', 'user.name', 't'], ['config', 'user.email', 't@t']):
            subprocess.run(['git', *c], cwd=self.repo, check=True)
        (self.repo / 'a.txt').write_text('a'); subprocess.run(['git', 'add', '.'], cwd=self.repo, check=True)
        subprocess.run(['git', 'commit', '-qm', 'init'], cwd=self.repo, check=True)
        self.main_sha = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=self.repo, capture_output=True, text=True).stdout.strip()
    def tearDown(self): self.tmp.cleanup()

    def runner(self, write='ok', test='ok'):
        engine = [sys.executable, '-c', 'import sys;open("x.txt","w").write(%r)' % write] if write else [sys.executable, '-c', 'pass']
        tests = [sys.executable, '-c', 'import sys;sys.exit(0 if open("x.txt").read()=="%s" else 1)' % test]
        return ExecutionRunner(self.repo, self.root / 'wt', tests, engine, 20)

    def go(self, runner, **kw):
        args = dict(is_owner=True, approved=True, task_id='T1', prompt='do it'); args.update(kw)
        return runner.run(**args)

    def test_success_commits_on_isolated_branch_without_touching_main(self):
        r = self.go(self.runner())
        self.assertEqual(r['state'], 'ready_for_review'); self.assertEqual(r['branch'], 'claude/task-T1')
        self.assertEqual(subprocess.run(['git', 'rev-parse', 'main'], cwd=self.repo, capture_output=True, text=True).stdout.strip(), self.main_sha)
        self.assertFalse((self.repo / 'x.txt').exists())

    def test_failed_tests_do_not_commit(self):
        r = self.go(self.runner(test='different'))
        self.assertEqual(r['state'], 'tests_failed'); self.assertNotIn('sha', r)

    def test_no_changes(self):
        self.assertEqual(self.go(self.runner(write=None))['state'], 'no_changes')

    def test_refusals(self):
        r = self.runner()
        for kw in ({'is_owner': False}, {'approved': False}, {'approved': 'yes'}, {'task_id': '../x'}, {'task_id': ''}, {'prompt': ''}):
            with self.assertRaises(ExecutionRefused): self.go(r, **kw)

    def test_engine_command_denies_push_and_privileged_tools(self):
        cmd = claude_command('claude')
        denied = cmd[cmd.index('--disallowedTools'):]
        for t in ('Bash(git push:*)', 'Bash(sudo:*)', 'Bash(docker:*)'): self.assertIn(t, denied)
        self.assertNotIn('--dangerously-skip-permissions', cmd)


if __name__ == '__main__':
    unittest.main()
