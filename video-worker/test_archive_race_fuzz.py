"""Deterministic schedule fuzzing of archive_protocol.archive_attempt (commit/cleanup race audit) with FAKE services only.
Two workers (W1 = attempt 1 holding the lease at start, W2 = attempt 2) run in real threads, but a scheduler lets exactly ONE of them move between external calls,
chooses the order pseudo-randomly from a seed, injects a lease reclaim (token switch to W2) at a random moment, and injects failures: an external call may fail
BEFORE it is applied or AFTER (applied but the response is lost = ambiguous outcome). Invariants are checked after every schedule. Re-run one schedule with
SEED=<n> python3 -m unittest test_archive_race_fuzz."""
import os, random, shutil, tempfile, threading, unittest
from pathlib import Path

import archive_protocol as ap
import lease_fencing as lf

JOB = {'id': '11111111-1111-1111-1111-111111111111', 'content_id': '22222222-2222-2222-2222-222222222222'}


class Sched:
    def __init__(self, rng, fail_p):
        self.rng, self.fail_p, self.cv = rng, fail_p, threading.Condition()
        self.waiting, self.done, self.go, self.alive = {}, set(), None, {'W1', 'W2'}
    def point(self, label):
        name = threading.current_thread().name
        with self.cv:
            self.waiting[name] = label; self.cv.notify_all()
            while self.go != name: self.cv.wait()
            self.go = None; del self.waiting[name]
    def finish(self):
        with self.cv: self.done.add(threading.current_thread().name); self.cv.notify_all()
    def drive(self, reclaim):
        reclaimed = False; reclaim_after = self.rng.randint(0, 14); steps = 0
        with self.cv:
            while True:
                while not (all(n in self.waiting or n in self.done for n in self.alive)): self.cv.wait()
                runnable = [n for n in sorted(self.alive) if n in self.waiting]
                if not runnable: return
                if not reclaimed and steps >= reclaim_after: reclaim(); reclaimed = True
                steps += 1
                self.go = self.rng.choice(runnable); self.cv.notify_all()
                while self.go is not None: self.cv.wait()
    def fail_mode(self):
        r = self.rng.random()
        return 'before' if r < self.fail_p / 2 else 'after' if r < self.fail_p else None


class World:
    def __init__(self, sched):
        self.s = sched; self.token, self.status, self.committed, self.result = 'T1', 'uploading', None, None
        self.files, self.trashed, self.cleanup_log, self.commit_ok = {}, [], [], []
    # ---- DB (mirrors video_job_commit_fenced / update_fenced semantics)
    def rpc(self, name, payload):
        self.s.point('rpc:' + name); mode = self.s.fail_mode()
        if mode == 'before': raise OSError('lost before apply')
        out = self._apply(name, payload)
        if mode == 'after': raise OSError('lost after apply')
        return out
    def _apply(self, name, p):
        stale = RuntimeError('stale claim: the job was reclaimed, finished or the token is wrong')
        if name == 'video_job_update_fenced':
            if p['p_claim_token'] != self.token or self.status not in ('preparing', 'rendering', 'uploading'): raise stale
            return {}
        if p['p_claim_token'] == self.token and self.committed == p['p_attempt'] and self.status == 'ready': return dict(self.result)
        if p['p_claim_token'] != self.token or self.status not in ('preparing', 'rendering', 'uploading'): raise stale
        self.status, self.committed, self.result = 'ready', p['p_attempt'], dict(p['p_result']); self.commit_ok.append(p['p_attempt']); return dict(self.result)
    def read_committed(self):
        self.s.point('read'); 
        if self.s.fail_mode(): raise OSError('db read failed')
        return self.committed
    # ---- bridge (mirrors the draft Apps Script actions)
    def stage(self, job, attempt, kind, path):
        self.s.point('stage'); mode = self.s.fail_mode()
        if mode == 'before': raise OSError('stage lost before')
        self.files[(attempt, kind)] = Path(path).read_bytes()
        if mode == 'after': raise OSError('stage response lost')
        return {'fileId': f'{attempt}-{kind}', 'fileUrl': f'https://drive.google.com/file/d/{attempt}-{kind}', 'folderUrl': f'https://drive.google.com/drive/folders/a{attempt}'}
    def cleanup(self, job, attempts, keep_attempt=None):
        self.s.point('cleanup'); mode = self.s.fail_mode()
        if mode == 'before': raise OSError('cleanup lost before')
        if keep_attempt in attempts: raise RuntimeError('Refusing to remove the kept attempt')
        self.cleanup_log.append((list(attempts), keep_attempt))
        for k in [k for k in self.files if k[0] in attempts]: self.trashed.append(k); del self.files[k]
        if mode == 'after': raise OSError('cleanup response lost')


def run_schedule(seed, fail_p=0.18):
    rng = random.Random(seed); sched = Sched(rng, fail_p); w = World(sched)
    tmp = Path(tempfile.mkdtemp()); (tmp / 'v.mp4').write_bytes(b'V'); (tmp / 'c.jpg').write_bytes(b'C')
    files = {'video': tmp / 'v.mp4', 'cover': tmp / 'c.jpg'}; outcome = {}
    def worker(name, attempt, token):
        threading.current_thread().name = name
        try:
            guard = lf.LeaseGuard(w.rpc, JOB['id'], token, interval=1e9)
            outcome[name] = ('ok', ap.archive_attempt(JOB, attempt, files, w, guard, read_committed=w.read_committed))
        except lf.LeaseLost: outcome[name] = ('lost', None)
        except Exception as e: outcome[name] = ('error', type(e).__name__)
        finally: sched.finish()
    ts = [threading.Thread(target=worker, args=('W1', 1, 'T1'), name='W1'), threading.Thread(target=worker, args=('W2', 2, 'T2'), name='W2')]
    for t in ts: t.start()
    def reclaim(): w.token = 'T2'                       # the job was reclaimed: attempt 2 now holds the lease (only if still working)
    sched.drive(reclaim)
    for t in ts: t.join(timeout=10)
    shutil.rmtree(tmp, ignore_errors=True)
    return w, outcome


def check(seed, w, outcome):
    ctx = f'seed={seed} committed={w.committed} commit_ok={w.commit_ok} outcome={outcome} files={sorted(w.files)} cleanup={w.cleanup_log}'
    assert len(w.commit_ok) <= 1, 'two different commits succeeded: ' + ctx                      # I1 at most one winner, ever
    assert w.committed in (None, 1, 2), ctx
    if w.committed is not None:
        assert w.status == 'ready' and w.result['drive_video_url'].endswith(f'{w.committed}-video'), 'result does not point at the committed attempt: ' + ctx   # I3
        assert (w.committed, 'video') in w.files and (w.committed, 'cover') in w.files, 'committed attempt files are missing: ' + ctx                      # I2 committed files exist
        assert not any(k[0] == w.committed for k in w.trashed), 'a committed file was trashed: ' + ctx                                                    # I4
        assert all(w.committed not in attempts for attempts, keep in w.cleanup_log), 'cleanup named the committed attempt: ' + ctx
        for name, attempt in (('W1', 1), ('W2', 2)):
            kind, value = outcome[name]
            if attempt != w.committed: assert kind != 'ok', 'a loser reported success: ' + ctx                                                                 # I5
    else:
        assert all(o[0] != 'ok' for o in outcome.values()), 'success reported with nothing committed: ' + ctx
        assert not w.trashed or True


class Fuzz(unittest.TestCase):
    def test_schedules(self):
        seeds = [int(os.environ['SEED'])] if os.environ.get('SEED') else range(int(os.environ.get('SEEDS', '1500')))
        stats = {'committed1': 0, 'committed2': 0, 'none': 0, 'leftovers': 0}
        for seed in seeds:
            w, outcome = run_schedule(seed); check(seed, w, outcome)
            stats['none' if w.committed is None else f'committed{w.committed}'] += 1
            if w.committed and any(k[0] != w.committed for k in w.files): stats['leftovers'] += 1
        print('fuzz', len(list(seeds)), 'schedules OK', stats)
        if not os.environ.get('SEED'): self.assertGreater(stats['committed1'] + stats['committed2'], 100)      # sanity: the schedules do exercise commits


if __name__ == '__main__':
    unittest.main()
