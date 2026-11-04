import shutil, tempfile, threading, time, unittest
from pathlib import Path
import lease_fencing as lf


class FakeServer:
    """Mimics the DRAFT SQL semantics: one current token; stale/finished/cancelled jobs reject writes."""
    def __init__(self, token="T1", status="rendering"):
        self.token, self.status, self.calls, self.fail_network = token, status, [], False
    def rpc(self, name, payload):
        self.calls.append((name, payload))
        if self.fail_network:
            raise OSError("network down")
        if payload["p_claim_token"] != self.token or self.status not in ("preparing", "rendering", "uploading"):
            raise RuntimeError("stale claim: the job was reclaimed, finished or the token is wrong")
        if "status" in payload["p_patch"]:
            self.status = payload["p_patch"]["status"]
        return {"id": payload["p_job_id"], "status": self.status}


class FakeStorage:
    def __init__(self): self.objects = {}
    def put(self, path, data): self.objects[path] = data; return "fake://" + path


class T9PerAttemptOutputs(unittest.TestCase):
    def test_paths_differ_per_attempt(self):
        a = lf.attempt_object_path("job-1", 1, "video.mp4"); b = lf.attempt_object_path("job-1", 2, "video.mp4")
        self.assertNotEqual(a, b); self.assertEqual(a, "job-1/attempt-01/video.mp4")
    def test_unsafe_components_rejected(self):
        for bad in ("../x", "a/b", "", "x y"):
            with self.assertRaises(ValueError): lf.attempt_object_path("job-1", 1, bad)
        with self.assertRaises(ValueError): lf.attempt_object_path("../j", 1, "v.mp4")
        with self.assertRaises(ValueError): lf.attempt_object_path("job-1", 0, "v.mp4")
    def test_zombie_cannot_overwrite_newer_attempt(self):
        st, srv = FakeStorage(), FakeServer(token="T2")          # attempt 2 holds the lease
        d = Path(tempfile.mkdtemp()); (d / "o.mp4").write_bytes(b"NEW")
        winner = lf.LeaseGuard(srv.rpc, "job-1", "T2"); lf.stage_output(st.put, winner, "job-1", 2, d / "o.mp4", "video.mp4")
        (d / "o.mp4").write_bytes(b"ZOMBIE")
        zombie = lf.LeaseGuard(srv.rpc, "job-1", "T1")           # attempt 1 token is dead
        with self.assertRaises(lf.LeaseLost): zombie.touch()
        with self.assertRaises(lf.LeaseLost): lf.stage_output(st.put, zombie, "job-1", 1, d / "o.mp4", "video.mp4")
        self.assertEqual(st.objects, {"job-1/attempt-02/video.mp4": b"NEW"})   # nothing from the zombie was stored
        shutil.rmtree(d)
    def test_legacy_single_path_would_collide(self):
        st = FakeStorage()                                         # documents the CURRENT upload_mp4 behaviour (job_id.mp4, x-upsert)
        st.put("job-1.mp4", b"attempt1"); st.put("job-1.mp4", b"attempt2")
        self.assertEqual(st.objects["job-1.mp4"], b"attempt2")     # last writer wins: the problem T9 removes


class T13AbortOnLeaseLoss(unittest.TestCase):
    def test_touch_detects_loss_and_marks_guard(self):
        srv = FakeServer(token="OTHER"); g = lf.LeaseGuard(srv.rpc, "j", "T1")
        with self.assertRaises(lf.LeaseLost): g.touch()
        with self.assertRaises(lf.LeaseLost): g.check()
        n = len(srv.calls)
        with self.assertRaises(lf.LeaseLost): g.update({"status": "ready"})
        self.assertEqual(len(srv.calls), n)                         # after loss no further server write is even attempted
    def test_network_error_is_not_lease_loss(self):
        srv = FakeServer(); srv.fail_network = True; g = lf.LeaseGuard(srv.rpc, "j", "T1")
        with self.assertRaises(OSError): g.touch()
        g.check()                                                   # still considered held
    def test_background_pulse_aborts_render_and_cleans_job_dir(self):
        srv = FakeServer(); d = Path(tempfile.mkdtemp()) / "job"; d.mkdir(); (d / "voice.mp3").write_bytes(b"x")
        steps_done, committed = [], []
        def render_steps(g):
            for i in range(200):
                g.check(); time.sleep(0.01); steps_done.append(i)
                if i == 5: srv.token = "RECLAIMED"                  # another worker reclaimed the job
        g = lf.LeaseGuard(srv.rpc, "j", "T1", interval=0.02)
        with self.assertRaises(lf.LeaseLost):
            with g, lf.guarded_attempt(d, g):
                render_steps(g); committed.append(g.update({"status": "ready"}))
        self.assertLess(len(steps_done), 100)                      # aborted early, not after all 200 steps
        self.assertFalse(d.exists())                               # local job dir removed
        self.assertEqual(committed, [])                            # never reported ready/failed
        self.assertNotIn("ready", [c[1]["p_patch"].get("status") for c in srv.calls])
    def test_cancel_from_dashboard_aborts_worker(self):
        srv = FakeServer(); g = lf.LeaseGuard(srv.rpc, "j", "T1"); g.touch()
        srv.status = "cancelled"                                    # user cancelled: SQL then rejects the worker's fenced call
        with self.assertRaises(lf.LeaseLost): g.update({"progress_percent": 60})
    def test_normal_attempt_commits(self):
        srv = FakeServer(); st = FakeStorage(); d = Path(tempfile.mkdtemp()); (d / "o.mp4").write_bytes(b"V")
        g = lf.LeaseGuard(srv.rpc, "j", "T1", interval=10)
        with g, lf.guarded_attempt(d, g):
            url = lf.stage_output(st.put, g, "j", 1, d / "o.mp4", "video.mp4"); g.update({"status": "ready", "output_video_url": url})
        self.assertEqual(srv.status, "ready"); self.assertTrue(d.exists()); shutil.rmtree(d)


if __name__ == "__main__":
    unittest.main()
