"""Full worker lifecycle with fakes (no Supabase, no Drive, no credentials): fenced path, cancel, network failure, zombie, old-worker path, outputs."""
import hashlib, os, shutil, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import worker

JOB = '11111111-1111-1111-1111-111111111111'


class FakeSupabase:
    """Server side of the DRAFT SQL: token + status semantics; records every request."""
    def __init__(self, token='TOK1', status='preparing', attempt=1):
        self.token, self.status, self.attempt = token, status, attempt
        self.requests, self.patches, self.rpc_updates, self.fail_updates_with = [], [], [], None
        self.on_update = None          # hook(server, patch) to simulate events while the worker runs
    def request_json(self, method, url, key, payload=None, headers=None):
        self.requests.append((method, url))
        if url.endswith('/rpc/video_job_update_fenced'):
            if self.on_update: self.on_update(self, payload['p_patch'])
            if self.fail_updates_with: raise self.fail_updates_with
            if payload['p_claim_token'] != self.token or self.status not in ('preparing', 'rendering', 'uploading'):
                raise worker.WorkerError('HTTP 400: stale claim: the job was reclaimed, finished or the token is wrong')
            self.rpc_updates.append(payload['p_patch'])
            if 'status' in payload['p_patch']: self.status = payload['p_patch']['status']
            return {'id': JOB, 'status': self.status}
        if '/rest/v1/video_jobs' in url and method == 'PATCH':
            self.patches.append(payload); return None
        return None


class FakeDrive:
    """Mimics apps-script handleVideoArchive_: one file per job+kind, same sha256 reused, different sha256 = conflict."""
    def __init__(self): self.files = {}
    def upload(self, job, path, kind):
        sha = hashlib.sha256(Path(path).read_bytes()).hexdigest()
        key = (job['id'], kind)
        if key in self.files and self.files[key] != sha:
            raise RuntimeError('Archive checksum conflict; create a new Video Job')
        self.files[key] = sha
        return {'fileUrl': 'https://drive.google.com/f/' + kind, 'fileId': kind, 'folderUrl': 'https://drive.google.com/drive/folders/x', 'archiveVersion': 1, 'ok': True}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, self.tmp, True)
        self.sb, self.drive = FakeSupabase(), FakeDrive()
        self.job = {'id': JOB, 'content_id': '22222222-2222-2222-2222-222222222222', 'created_at': '2026-09-08T00:00:00Z',
                    'brand': 'sono', 'title': 'T', 'attempt_count': 1, 'claim_token': 'TOK1', 'media_mode': 'standard'}
        self.render_hook = None
        def fake_render(job, job_dir):
            if self.render_hook: self.render_hook()
            out = job_dir / 'output.mp4'; out.write_bytes(self.video_bytes); (job_dir / 'cover.jpg').write_bytes(b'cover')
            return out, 'fake-voice'
        self.video_bytes = b'video-A'
        self.staged = []
        for target, value in [('worker.WORK_ROOT', self.tmp), ('worker.request_json', self.sb.request_json), ('worker.heartbeat', lambda *a, **k: None),
                              ('worker.logo_asset', lambda job: None), ('worker.download_job_assets', lambda *a, **k: []), ('worker.render', fake_render),
                              ('worker.archive_upload', self.drive.upload), ('worker.ffmpeg_paths', lambda: ('ffmpeg', 'ffprobe')),
                              ('worker.probe_duration', lambda *a, **k: 10), ('cover_candidates.build', lambda *a, **k: []),
                              ('worker.upload_mp4', lambda b, k, j, p, attempt=None: self.staged.append((j, attempt)) or 'https://x/' + str(attempt))]:
            p = patch(target, value); p.start(); self.addCleanup(p.stop)
        p = patch.dict(os.environ, {'SSMPD_VIDEO_STAGE_OUTPUT': '1'}); p.start(); self.addCleanup(p.stop)
        self.addCleanup(worker._GUARDS.clear)

    def drive_videos(self): return {k: v for k, v in self.drive.files.items() if k[1] == 'video'}


class FencedLifecycle(Base):
    def test_L1_normal_run_uses_only_fenced_rpc_and_per_attempt_output(self):
        worker.process_job('u', 'k', self.job)
        self.assertEqual(self.sb.status, 'ready'); self.assertEqual(self.sb.patches, [])          # no plain PATCH on video_jobs
        self.assertTrue(all('/rpc/' in u for m, u in self.sb.requests))
        self.assertEqual(self.staged, [(JOB, 1)]); self.assertEqual(len(self.drive_videos()), 1)

    def test_L2_dashboard_cancel_mid_render_aborts_without_writes_or_uploads(self):
        def cancel(): self.sb.status = 'cancelled'
        self.render_hook = cancel
        worker.process_job('u', 'k', self.job)                       # returns normally: LeaseLost is handled, not raised
        self.assertEqual(self.sb.status, 'cancelled'); self.assertEqual(self.drive.files, {}); self.assertEqual(self.staged, [])
        self.assertFalse((self.tmp / JOB).exists()); self.assertNotIn('ready', [p.get('status') for p in self.sb.rpc_updates])

    def test_L3_zombie_after_reclaim_never_uploads_and_never_reports(self):
        def reclaim(): self.sb.token = 'TOK2'                          # another worker took the job
        self.render_hook = reclaim
        worker.process_job('u', 'k', self.job)
        self.assertEqual(self.drive.files, {}); self.assertEqual(self.staged, []); self.assertEqual(self.sb.patches, [])
        self.assertNotIn('uploading', [p.get('status') for p in self.sb.rpc_updates])    # detected by the pre-archive lease touch, before any status write
        self.assertNotIn('ready', [p.get('status') for p in self.sb.rpc_updates]); self.assertNotIn('failed', [p.get('status') for p in self.sb.rpc_updates])

    def test_L4_network_failure_is_not_a_lease_loss_and_publishes_nothing(self):
        def boom(server, patch_): 
            if patch_.get('status') == 'rendering': server.fail_updates_with = OSError('network down')
        self.sb.on_update = boom
        with self.assertRaises(OSError): worker.process_job('u', 'k', self.job)
        self.assertEqual(self.drive.files, {}); self.assertEqual(self.sb.patches, [])           # job stays held; stale recovery handles it later

    def test_L5_retry_after_reclaim_same_bytes_is_idempotent_one_drive_file(self):
        worker.process_job('u', 'k', self.job)
        self.sb.status, self.sb.token = 'preparing', 'TOK2'; self.job.update(claim_token='TOK2', attempt_count=2)   # attempt 2 re-renders the SAME bytes
        worker.process_job('u', 'k', self.job)
        self.assertEqual(len(self.drive_videos()), 1); self.assertEqual(self.staged, [(JOB, 1), (JOB, 2)])    # staging paths differ per attempt

    def test_L6_retry_with_different_bytes_hits_the_bridge_conflict(self):
        worker.process_job('u', 'k', self.job)
        self.sb.status, self.sb.token = 'preparing', 'TOK2'; self.job.update(claim_token='TOK2', attempt_count=2); self.video_bytes = b'video-B'
        with self.assertRaises(RuntimeError): worker.process_job('u', 'k', self.job)
        self.assertEqual(len(self.drive_videos()), 1)               # DOCUMENTED LIMIT: the existing bridge is first-writer-wins; needs a bridge/design decision


class OldWorkerPath(Base):
    def test_L7_job_without_token_uses_legacy_patch_and_legacy_output_name(self):
        legacy = dict(self.job); legacy.pop('claim_token')
        worker.process_job('u', 'k', legacy)
        self.assertGreater(len(self.sb.patches), 0); self.assertEqual(self.sb.rpc_updates, [])
        self.assertEqual(self.staged, [(JOB, None)])                  # upload_mp4 keeps job_id.mp4 when attempt is None
        self.assertEqual(worker._GUARDS, {})

    def test_L8_fenced_claims_are_opt_in(self):
        calls = []
        with patch('worker.request_json', lambda m, u, k, p=None, h=None: calls.append(u) or None):
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop('SSMPD_FENCED_CLAIMS', None); worker.claim_job('u', 'k')
            self.assertTrue(calls[-1].endswith('/rpc/claim_next_video_job'))
            with patch.dict(os.environ, {'SSMPD_FENCED_CLAIMS': '1'}): worker.claim_job('u', 'k')
            self.assertTrue(calls[-1].endswith('/rpc/claim_next_video_job_fenced'))


if __name__ == '__main__':
    unittest.main()
