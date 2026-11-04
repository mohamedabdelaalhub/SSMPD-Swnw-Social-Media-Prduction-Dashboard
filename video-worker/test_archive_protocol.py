"""Attempt-scoped archive protocol against a FAKE Apps Script/Drive bridge and a fake DB that mirrors video_job_commit_fenced (real SQL is proven
by tests/video-job-concurrency-pg.sh H1-H7). No network, no Drive, no credentials."""
import hashlib, shutil, tempfile, unittest
from pathlib import Path

import archive_protocol as ap
import lease_fencing as lf

JOB = {'id': '11111111-1111-1111-1111-111111111111', 'content_id': '22222222-2222-2222-2222-222222222222'}


class FakeDB:
    def __init__(self, token='T1'):
        self.token, self.status, self.committed_attempt, self.result, self.calls = token, 'uploading', None, None, []
        self.drop_response_once = False
    def rpc(self, name, payload):
        self.calls.append(name)
        if name == 'video_job_update_fenced':
            if payload['p_claim_token'] != self.token or self.status not in ('preparing', 'rendering', 'uploading'):
                raise RuntimeError('stale claim: the job was reclaimed, finished or the token is wrong')
            return {}
        assert name == 'video_job_commit_fenced'
        if payload['p_claim_token'] == self.token and self.committed_attempt == payload['p_attempt'] and self.status == 'ready':
            return dict(self.result)                                                   # idempotent retry
        if payload['p_claim_token'] != self.token or self.status not in ('preparing', 'rendering', 'uploading'):
            raise RuntimeError('stale claim: the job was reclaimed, finished or the token is wrong')
        self.status, self.committed_attempt, self.result = 'ready', payload['p_attempt'], dict(payload['p_result'])
        if self.drop_response_once:
            self.drop_response_once = False
            raise OSError('response lost after the commit was applied')
        return dict(self.result)


class FakeBridge:
    """Existing action = first-writer-wins per job (apps-script handleVideoArchive_); new actions = per-attempt folders."""
    def __init__(self): self.files, self.legacy, self.on_stage, self.cleanups = {}, {}, None, []
    def legacy_upload(self, job, kind, path):
        sha = hashlib.sha256(Path(path).read_bytes()).hexdigest(); key = (job['id'], kind)
        if key in self.legacy and self.legacy[key] != sha: raise RuntimeError('Archive checksum conflict; create a new Video Job')
        self.legacy[key] = sha
    def stage(self, job, attempt, kind, path):
        if self.on_stage: self.on_stage(attempt, kind)
        sha = hashlib.sha256(Path(path).read_bytes()).hexdigest(); key = (job['id'], attempt, kind)
        if key in self.files and self.files[key] != sha: raise RuntimeError('same-attempt conflict')
        self.files[key] = sha                                                           # same attempt + same sha = idempotent reuse
        return {'fileId': f'{attempt}-{kind}', 'fileUrl': f'https://drive/attempt-{attempt:02d}/{kind}', 'folderUrl': f'https://drive/attempt-{attempt:02d}'}
    def cleanup(self, job, attempts, keep_attempt=None):
        self.cleanups.append(list(attempts))
        for k in [k for k in self.files if k[0] == job['id'] and k[1] in attempts]: del self.files[k]
    def attempts_present(self): return sorted({k[1] for k in self.files})


class Base(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, self.d, True)
        self.db, self.bridge = FakeDB(), FakeBridge()
    def files(self, video=b'V', cover=b'C'):
        (self.d / 'v.mp4').write_bytes(video); (self.d / 'c.jpg').write_bytes(cover)
        return {'video': self.d / 'v.mp4', 'cover': self.d / 'c.jpg'}
    def guard(self, token='T1'): return lf.LeaseGuard(self.db.rpc, JOB['id'], token, interval=60)


class AttemptScoped(Base):
    def test_A1_normal_commit_points_to_the_attempt_folder(self):
        r = ap.archive_attempt(JOB, 1, self.files(), self.bridge, self.guard())
        self.assertEqual((self.db.status, self.db.committed_attempt), ('ready', 1)); self.assertEqual(r['drive_video_url'], 'https://drive/attempt-01/video')
    def test_A2_retry_with_different_bytes_no_conflict_and_old_attempt_cleaned(self):
        self.bridge.stage(JOB, 1, 'video', self.files(b'attempt1-bytes')['video'])           # attempt 1 died after staging, never committed
        self.db.token = 'T2'
        r = ap.archive_attempt(JOB, 2, self.files(b'attempt2-DIFFERENT'), self.bridge, self.guard('T2'))
        self.assertEqual(r['drive_video_url'], 'https://drive/attempt-02/video'); self.assertEqual(self.bridge.attempts_present(), [2])
        # contrast: the existing first-writer-wins action would have failed here
        self.bridge.legacy_upload(JOB, 'video', self.files(b'attempt1-bytes')['video'])
        with self.assertRaises(RuntimeError): self.bridge.legacy_upload(JOB, 'video', self.files(b'attempt2-DIFFERENT')['video'])
    def test_A3_toctou_lease_lost_between_touch_and_upload_is_harmless(self):
        self.bridge.on_stage = lambda attempt, kind: setattr(self.db, 'token', 'T2')           # reclaimed AFTER the touch, DURING the upload
        with self.assertRaises(lf.LeaseLost): ap.archive_attempt(JOB, 1, self.files(b'ZOMBIE'), self.bridge, self.guard('T1'), read_committed=lambda: None)
        self.assertEqual(self.db.status, 'uploading'); self.assertIsNone(self.db.committed_attempt)    # nothing committed
        self.assertEqual(self.bridge.attempts_present(), [])                                   # zombie removed its own folder (DB proved it is not the committed one)

    def test_A3b_loser_cleanup_is_skipped_when_the_outcome_is_ambiguous(self):
        for reader in (lambda: 1, lambda: (_ for _ in ()).throw(OSError('db down')), None):   # own attempt IS committed / DB unreadable / no reader
            self.bridge, self.db = FakeBridge(), FakeDB()
            self.bridge.on_stage = lambda attempt, kind: setattr(self.db, 'token', 'T2')
            with self.assertRaises(lf.LeaseLost): ap.archive_attempt(JOB, 1, self.files(), self.bridge, self.guard('T1'), read_committed=reader)
            self.assertEqual(self.bridge.cleanups, []); self.assertEqual(self.bridge.attempts_present(), [1])   # never delete files that might be the winner's
    def test_A4_zombie_finishing_after_the_winner_cannot_touch_the_winners_archive(self):
        self.db.token = 'T2'
        win = ap.archive_attempt(JOB, 2, self.files(b'WIN'), self.bridge, self.guard('T2'))
        with self.assertRaises(lf.LeaseLost): ap.archive_attempt(JOB, 1, self.files(b'ZOMBIE'), self.bridge, self.guard('T1'))
        self.assertEqual(self.db.result, win); self.assertEqual(self.bridge.attempts_present(), [2])
    def test_A5_lost_commit_response_is_retried_idempotently_and_not_cleaned_up_early(self):
        self.db.drop_response_once = True
        r = ap.archive_attempt(JOB, 1, self.files(), self.bridge, self.guard())
        self.assertEqual(self.db.calls.count('video_job_commit_fenced'), 2); self.assertEqual(r, self.db.result); self.assertEqual(self.bridge.attempts_present(), [1])
    def test_A6_stage_is_idempotent_within_an_attempt(self):
        f = self.files(); self.bridge.stage(JOB, 1, 'video', f['video']); self.bridge.stage(JOB, 1, 'video', f['video'])
        self.assertEqual(len([k for k in self.bridge.files if k[2] == 'video']), 1)
    def test_A7_cleanup_never_removes_the_committed_attempt(self):
        self.db.token = 'T3'; ap.archive_attempt(JOB, 3, self.files(), self.bridge, self.guard('T3'))
        self.assertEqual(self.bridge.cleanups, [[1, 2]]); self.assertIn(3, self.bridge.attempts_present())
    def test_A8_unknown_commit_outcome_keeps_staged_files(self):
        class Down(FakeDB):
            def rpc(self, name, payload):
                if name == 'video_job_commit_fenced': raise OSError('network down')
                return super().rpc(name, payload)
        self.db = Down()
        with self.assertRaises(OSError): ap.archive_attempt(JOB, 1, self.files(), self.bridge, self.guard())
        self.assertEqual(self.bridge.attempts_present(), [1]); self.assertEqual(self.bridge.cleanups, [])


if __name__ == '__main__':
    unittest.main()
