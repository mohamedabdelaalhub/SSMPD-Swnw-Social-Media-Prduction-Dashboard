"""Execution mode (separate from chat): isolated worktree edit + tests + local commit.

Owner-approved only. Never pushes, merges or deploys: publishing a branch/PR is a separate,
explicitly credentialed step (`ready_for_review` means a local commit that passed the tests)."""
import os
import re
import subprocess
import time
from pathlib import Path

SENSITIVE = (re.compile(r'^\.github/'), re.compile(r'(^|/)\.env'), re.compile(r'(^|/)deploy/'),
             re.compile(r'^supabase/(migrations|functions)/'))
DENY_TOOLS = ['Bash(git push:*)', 'Bash(sudo:*)', 'Bash(docker:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(ssh:*)']


class ExecutionRefused(Exception):
    pass


def claude_command(binary):
    return [binary, '-p', '--permission-mode', 'acceptEdits',
            '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git diff:*)', 'Bash(git status:*)',
            '--disallowedTools', *DENY_TOOLS, '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', 'user']


class ExecutionRunner:
    def __init__(self, repo_dir, work_root, test_cmd, engine_cmd, timeout=900):
        self.repo, self.root = Path(repo_dir).resolve(strict=True), Path(work_root).resolve()
        self.test_cmd, self.engine_cmd, self.timeout = list(test_cmd), list(engine_cmd), timeout

    def _git(self, *args, cwd=None):
        return subprocess.run(['git', *args], cwd=cwd or self.repo, capture_output=True, text=True, timeout=60)

    def run(self, *, is_owner, approved, task_id, prompt, base_ref='HEAD'):
        if not is_owner:
            raise ExecutionRefused('execution is owner-only')
        if approved is not True:
            raise ExecutionRefused('task needs explicit owner approval')
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,48}', task_id or '') or '..' in task_id:
            raise ExecutionRefused('invalid task id')
        if not isinstance(prompt, str) or not 1 <= len(prompt) <= 8000:
            raise ExecutionRefused('invalid prompt')
        branch, path = 'claude/task-' + task_id, self.root / task_id
        if path.exists():
            raise ExecutionRefused('task already has a worktree')
        self.root.mkdir(parents=True, exist_ok=True)
        add = self._git('worktree', 'add', '-b', branch, str(path), base_ref)
        if add.returncode:
            raise ExecutionRefused('worktree creation failed')
        env = {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR')}
        result = {'task_id': task_id, 'branch': branch, 'worktree': str(path), 'started': time.time()}
        try:
            eng = subprocess.run(self.engine_cmd, input=prompt, cwd=path, env=env, capture_output=True, text=True, timeout=self.timeout)
            result['engine_exit'] = eng.returncode
            changed = self._git('status', '--porcelain', cwd=path).stdout.splitlines()
            files = [line[3:] for line in changed]
            if not files:
                return {**result, 'state': 'no_changes', 'files': []}
            tests = subprocess.run(self.test_cmd, cwd=path, env=env, capture_output=True, text=True, timeout=self.timeout)
            result.update(files=files, tests_exit=tests.returncode, tests_tail=(tests.stdout + tests.stderr)[-2000:],
                          sensitive=[f for f in files if any(p.search(f) for p in SENSITIVE)])
            if tests.returncode:
                return {**result, 'state': 'tests_failed'}
            self._git('add', '-A', cwd=path)
            commit = self._git('-c', 'user.name=Claude (swnw-vps)', '-c', 'user.email=noreply@anthropic.com',
                               'commit', '-q', '-m', 'Claude task ' + task_id + '\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>', cwd=path)
            if commit.returncode:
                return {**result, 'state': 'commit_failed'}
            result['sha'] = self._git('rev-parse', 'HEAD', cwd=path).stdout.strip()
            return {**result, 'state': 'ready_for_review'}
        except subprocess.TimeoutExpired:
            return {**result, 'state': 'timeout'}
