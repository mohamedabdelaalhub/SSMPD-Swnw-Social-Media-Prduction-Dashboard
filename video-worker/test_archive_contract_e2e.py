"""End-to-end contract (worker <-> bridge actions <-> DB commit) with FAKE services only: unknown commit outcome, cleanup, duplicate callbacks, zombie vs
winner, backward compatibility. The fake Apps Script mirrors apps-script/drafts/VideoArchiveAttempt.draft.gs (that file is executed by
tests/video-archive-attempt-gs.cjs); the fake DB mirrors video_job_commit_fenced (executed on real PostgreSQL by tests/video-job-concurrency-pg.sh H1-H7)."""
import hashlib, os, re, shutil, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import archive_protocol as ap
import worker
from test_worker_fenced_lifecycle import FakeSupabase, JOB

GS = (Path(__file__).resolve().parent.parent / 'apps-script/drafts/VideoArchiveAttempt.draft.gs').read_text()


class DB(FakeSupabase):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.committed, self.commit_calls, self.lose_commit_responses, self.candidates, self.plain_candidate_posts = None, 0, 0, [], []
    def request_json(self, method, url, key, payload=None, headers=None):
        if url.endswith('/rpc/video_job_commit_fenced'):
            self.requests.append((method, url)); self.commit_calls += 1
            idem = payload['p_claim_token'] == self.token and self.committed == payload['p_attempt'] and self.status == 'ready'
            if not idem and (payload['p_claim_token'] != self.token or self.status not in ('preparing', 'rendering', 'uploading')):
                raise worker.WorkerError('HTTP 400: stale claim: the job was reclaimed, finished or the token is wrong')
            if not idem:
                self.status, self.committed, self.result = 'ready', payload['p_attempt'], payload['p_result']
            self.candidates = [dict(c) for c in payload['p_result'].get('cover_candidates', [])]      # the real RPC upserts these atomically (restores them on a repeated commit)
            if self.lose_commit_responses > 0:
                self.lose_commit_responses -= 1; raise OSError('response lost')
            return dict(self.result)
        if 'video_cover_candidates' in url:
            self.plain_candidate_posts.append(payload); return None      # legacy path only; attempt mode must never get here
        if method == 'GET' and 'select=committed_attempt' in url:
            return [{'committed_attempt': self.committed}]
        return super().request_json(method, url, key, payload, headers)


class AppsScript:
    def __init__(self): self.files, self.log, self.trashed = {}, [], []
    def post(self, p):
        self.log.append(p)
        if p['action'] == 'video_archive_attempt':
            sha = p['sha256']; key = (p['jobId'], p['attempt'], p['kind'])
            if key in self.files and self.files[key] != sha: raise RuntimeError('Attempt archive checksum conflict')
            self.files[key] = sha
            return {'ok': True, 'archiveVersion': 2, 'attempt': p['attempt'], 'fileId': f"{p['attempt']}-{p['kind']}",
                    'fileUrl': f"https://drive.google.com/file/d/{p['attempt']}-{p['kind']}", 'folderUrl': f"https://drive.google.com/drive/folders/a{p['attempt']}"}
        if p['action'] == 'video_archive_cleanup':
            if p.get('keepAttempt') in p['attempts']: raise RuntimeError('Refusing to remove the kept attempt')
            for k in [k for k in self.files if k[1] in p['attempts']]: del self.files[k]; self.trashed.append(k)
            return {'ok': True, 'archiveVersion': 2, 'removed': 0}
        raise AssertionError('unexpected action ' + p['action'])
    def attempts(self): return sorted({k[1] for k in self.files})


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, self.tmp, True)
        self.db, self.gs = DB(), AppsScript()
        self.job = {'id': JOB, 'content_id': '22222222-2222-2222-2222-222222222222', 'created_at': '2026-09-08T00:00:00Z', 'brand': 'sono',
                    'title': 'T', 'attempt_count': 1, 'claim_token': 'TOK1', 'media_mode': 'standard'}
        self.bytes, self.hook, self.legacy_uploads = b'video-A', None, []
        def fake_render(job, job_dir):
            if self.hook: self.hook()
            out = job_dir / 'output.mp4'; out.write_bytes(self.bytes); (job_dir / 'cover.jpg').write_bytes(b'cover'); (job_dir / 'c1.jpg').write_bytes(b'cand1')
            return out, 'v'
        def fake_build(job, output, ffmpeg, duration, template_dir=None):
            return [{'index': 1, 'path': str(output.parent / 'c1.jpg'), 'timestamp_seconds': 1.0}]
        for t, v in [('worker.WORK_ROOT', self.tmp), ('worker.request_json', self.db.request_json), ('worker.heartbeat', lambda *a, **k: None),
                     ('worker.logo_asset', lambda j: None), ('worker.download_job_assets', lambda *a, **k: []), ('worker.render', fake_render),
                     ('worker.ffmpeg_paths', lambda: ('ffmpeg', 'ffprobe')), ('worker.probe_duration', lambda *a, **k: 10), ('cover_candidates.build', fake_build),
                     ('worker.upload_cover_preview', lambda b, k, job, cand, attempt=None: 'previews/' + str(attempt) + '/' + str(cand['index']) + '.jpg'), ('drive_archive.post', self.gs.post),
                     ('worker.archive_upload', lambda job, path, kind: self.legacy_uploads.append(kind) or {'fileUrl': 'https://drive.google.com/f', 'fileId': 'x', 'folderUrl': 'https://drive.google.com/d'})]:
            p = patch(t, v); p.start(); self.addCleanup(p.stop)
        p = patch.dict(os.environ, {'SSMPD_ATTEMPT_ARCHIVE': '1'}); p.start(); self.addCleanup(p.stop)
        self.addCleanup(worker._GUARDS.clear)


class Contract(unittest.TestCase):
    def keys_read_by(self, fn):
        body = GS[GS.index('function ' + fn):]; body = body[:body.index('\n}\n')]
        return set(re.findall(r'\bp\.(\w+)', body))
    def test_C1_payload_fields_match_what_the_draft_bridge_reads(self):
        sent = []; b = ap.DriveBridge(lambda p: sent.append(p) or {'ok': True, 'archiveVersion': 2, 'attempt': 2, 'fileId': 'f', 'fileUrl': 'https://drive.google.com/f', 'folderUrl': 'https://drive.google.com/d'})
        f = Path(tempfile.mkdtemp()) / 'v.mp4'; f.write_bytes(b'x'); job = {'id': 'j', 'content_id': 'c', 'created_at': '2026-09-08T00:00:00Z'}
        b.stage(job, 2, 'video', f); b.cleanup(job, [1], keep_attempt=2)
        stage_keys, clean_keys = set(sent[0]) - {'action'}, set(sent[1]) - {'action'}
        folder = self.keys_read_by('videoJobFolder_')
        self.assertEqual(stage_keys, self.keys_read_by('handleVideoArchiveAttempt_') | folder)      # exactly the fields the draft bridge reads are sent
        self.assertEqual(clean_keys, self.keys_read_by('handleVideoArchiveCleanup_') | folder)
    def test_C2_action_names_exist_in_the_draft(self):
        self.assertIn('function handleVideoArchiveAttempt_', GS); self.assertIn('function handleVideoArchiveCleanup_', GS)


class E2E(Base):
    def test_E1_full_run_stages_per_attempt_commits_then_writes_candidates(self):
        worker.process_job('u', 'k', self.job)
        self.assertEqual((self.db.status, self.db.committed), ('ready', 1)); self.assertEqual(self.legacy_uploads, []); self.assertEqual(self.db.plain_candidate_posts, [])
        self.assertEqual(self.db.result['drive_video_url'], 'https://drive.google.com/file/d/1-video'); self.assertEqual(self.gs.attempts(), [1])
        self.assertEqual([(c['candidate_index'], c['drive_url'], c['storage_path']) for c in self.db.candidates],
                         [(1, 'https://drive.google.com/file/d/1-cover_1', 'previews/1/1.jpg')])      # written by the commit, attempt-scoped preview path
    def test_E2_unknown_commit_outcome_commit_applied_response_lost(self):
        self.db.lose_commit_responses = 99                          # every response is lost, but the first commit WAS applied
        worker.process_job('u', 'k', self.job)                      # failure write is rejected (job is 'ready' server side) -> handled as lease loss
        self.assertEqual((self.db.status, self.db.committed), ('ready', 1)); self.assertEqual(self.db.commit_calls, 3)
        self.assertEqual(self.gs.attempts(), [1]); self.assertEqual(self.gs.trashed, [])        # no cleanup while the outcome is unknown
        self.assertEqual(len(self.db.candidates), 1)                # GAP CLOSED: candidate rows are part of the commit, nothing to reconcile after a lost response
    def test_E3_duplicate_callbacks_are_harmless(self):
        worker.process_job('u', 'k', self.job)
        b = ap.DriveBridge(self.gs.post); f = self.tmp / 'o.mp4'; f.write_bytes(b'video-A')
        b.stage(self.job, 1, 'video', f); b.stage(self.job, 1, 'video', f); b.cleanup(self.job, [5]); b.cleanup(self.job, [5])
        self.assertEqual(self.gs.attempts(), [1])
        again = self.db.request_json('POST', 'u/rest/v1/rpc/video_job_commit_fenced', 'k', {'p_claim_token': 'TOK1', 'p_attempt': 1, 'p_result': {'drive_video_url': 'CHANGED'}})
        self.assertEqual(again['drive_video_url'], 'https://drive.google.com/file/d/1-video')   # repeated commit cannot change the winner's result
    def test_E4_zombie_then_winner_only_the_winner_is_referenced(self):
        def rotate(): self.db.token = 'TOK2'                         # attempt 1 loses the lease during render
        self.hook = rotate; worker.process_job('u', 'k', self.job)
        self.assertEqual((self.gs.attempts(), self.db.candidates, self.db.committed), ([], [], None))   # previews of the zombie went to ITS attempt path only
        self.hook = None; self.db.status = 'preparing'; self.bytes = b'video-B-different'; self.job.update(claim_token='TOK2', attempt_count=2)
        worker.process_job('u', 'k', self.job)
        self.assertEqual((self.db.committed, self.gs.attempts()), (2, [2])); self.assertEqual(self.db.result['drive_video_url'], 'https://drive.google.com/file/d/2-video')
    def test_E5_loser_after_winner_cannot_reference_anything(self):
        self.db.token = 'TOK2'; self.job.update(attempt_count=2, claim_token='TOK2'); worker.process_job('u', 'k', self.job)
        self.job.update(attempt_count=1, claim_token='TOK1'); self.db.status = 'uploading'         # a late zombie (old token) starts archiving
        worker.process_job('u', 'k', self.job)
        self.assertEqual((self.db.committed, self.gs.attempts(), len(self.db.candidates)), (2, [2], 1)); self.assertEqual(self.db.candidates[0]['storage_path'], 'previews/2/1.jpg')
    def test_E6_backward_compatibility(self):
        legacy = dict(self.job); legacy.pop('claim_token')
        with patch.object(worker, 'upload_cover_preview', lambda *a, **k: 'p'):
            worker.process_job('u', 'k', legacy)
        self.assertEqual(self.legacy_uploads[:1], ['video']); self.assertEqual([c for c in self.gs.log if c['action'].startswith('video_archive_')], []); self.assertEqual(len(self.db.plain_candidate_posts), 1)
        self.legacy_uploads.clear(); self.db.status = 'preparing'
        with patch.dict(os.environ, {'SSMPD_ATTEMPT_ARCHIVE': '0'}): worker.process_job('u', 'k', dict(self.job))
        self.assertEqual(self.legacy_uploads[:1], ['video'])          # fenced job without the opt-in flag still uses the existing archive action


class Ambiguous(Base):
    def test_E7_stale_after_own_commit_never_deletes_the_committed_files(self):
        worker.process_job('u', 'k', self.job)                       # attempt 1 committed
        real = self.db.request_json
        def stale_commit(method, url, key, payload=None, headers=None):
            if url.endswith('/rpc/video_job_commit_fenced'): raise worker.WorkerError('HTTP 400: stale claim: the job was reclaimed, finished or the token is wrong')
            return real(method, url, key, payload, headers)
        self.db.status = 'preparing'                                 # dashboard re-queued/reclaimed AFTER our commit, our retry now sees "stale"
        with patch('worker.request_json', stale_commit):
            worker.process_job('u', 'k', self.job)
        self.assertEqual(self.gs.attempts(), [1]); self.assertEqual(self.gs.trashed, [])       # committed_attempt == 1 -> cleanup skipped
    def test_E8_malformed_bridge_answers_fail_before_commit_and_clean_nothing(self):
        for bad in ({}, {'ok': False}, {'ok': True, 'archiveVersion': 1, 'fileId': 'x'}, {'ok': True, 'archiveVersion': 2, 'attempt': 9, 'fileId': 'x'},
                    {'ok': True, 'archiveVersion': 2, 'attempt': 1, 'fileId': 'x', 'fileUrl': 'https://evil.example/f', 'folderUrl': 'https://drive.google.com/d'}):
            self.db = DB(); self.gs = AppsScript(); calls = []
            def post(p, bad=bad): calls.append(p['action']); return bad
            with patch('worker.request_json', self.db.request_json), patch('drive_archive.post', post):
                with self.assertRaises(RuntimeError): worker.process_job('u', 'k', dict(self.job))
            self.assertEqual((self.db.commit_calls, self.gs.trashed, calls), (0, [], ['video_archive_attempt']))
    def test_E9_stage_timeout_after_success_is_safe_to_retry(self):
        state = {'n': 0}
        def flaky(p):
            r = self.gs.post(p)
            if p['action'] == 'video_archive_attempt' and state['n'] == 0:
                state['n'] += 1; raise OSError('timeout after the bridge already stored the file')
            return r
        with patch('drive_archive.post', flaky):
            with self.assertRaises(OSError): worker.process_job('u', 'k', dict(self.job))        # job marked failed server-side (retry-archive path), files stay
            self.db.status = 'preparing'
            worker.process_job('u', 'k', dict(self.job))                                           # retry: idempotent stage, then commit
        self.assertEqual((self.db.committed, self.gs.attempts()), (1, [1])); self.assertEqual(len([k for k in self.gs.files if k[2] == 'video']), 1)
    def test_E10_cleanup_timeout_is_harmless_and_never_changes_job_state(self):
        calls = {'c': 0}
        def flaky(p):
            r = self.gs.post(p)
            if p['action'] == 'video_archive_cleanup':
                calls['c'] += 1; raise OSError('timeout after the cleanup already ran')
            return r
        self.db.token = 'TOK2'; self.job.update(claim_token='TOK2', attempt_count=2)
        b = ap.DriveBridge(self.gs.post); f = self.tmp / 'old.mp4'; f.write_bytes(b'attempt1'); b.stage(dict(self.job), 1, 'video', f)
        with patch('drive_archive.post', flaky): worker.process_job('u', 'k', dict(self.job))
        self.assertEqual((self.db.status, self.db.committed, calls['c']), ('ready', 2, 1)); self.assertEqual(self.gs.attempts(), [2])
        ap.DriveBridge(self.gs.post).cleanup(self.job, [1], keep_attempt=2)                        # a repeated cleanup is harmless
        self.assertEqual(self.gs.attempts(), [2])


if __name__ == '__main__':
    unittest.main()
