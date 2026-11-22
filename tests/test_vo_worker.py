"""ops/vo-worker/vo.py database-job flow with mocked SMTP and vo-worker API (no network, temp HOME)."""
import importlib.util, json, os, sys, tempfile, unittest


def load(home):
    os.environ["HOME"] = home
    base = os.path.join(home, "vo-worker"); [os.makedirs(os.path.join(base, d), exist_ok=True) for d in ("queue", "out", "done")]
    open(os.path.join(base, ".gmail-app-password"), "w").write("x")
    open(os.path.join(base, ".vo-worker-secret"), "w").write("s" * 40)
    spec = importlib.util.spec_from_file_location("vo", os.path.join(os.path.dirname(__file__), "..", "ops", "vo-worker", "vo.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m, base


class FakeSMTP:
    sent = []
    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def login(self, *a): pass
    def send_message(self, m): FakeSMTP.sent.append(m)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.vo, self.base = load(tempfile.mkdtemp()); self.calls = []; FakeSMTP.sent = []
        self.vo.smtplib.SMTP_SSL = FakeSMTP
        self.jobs = [{"id": "11111111-1111-4111-8111-111111111111", "script": "سُونُو معاك.", "voice": "auto", "energy": "calm"}]
        def api(action, payload):
            self.calls.append((action, payload))
            if action == "lease": out, self.jobs = self.jobs, []; return {"jobs": out}
            return {"ok": True}
        self.vo.api = api

    def test_db_job_is_sent_and_reported_with_alternating_voice(self):
        open(os.path.join(self.base, ".last_voice"), "w").write("female")
        self.vo.pull_db(); self.vo.send_new()
        self.assertEqual(len(FakeSMTP.sent), 1)
        self.assertEqual(FakeSMTP.sent[0]["Subject"], "VO | voice=male | energy=calm")
        sent = [p for a, p in self.calls if a == "sent"][0]
        self.assertEqual(sent["voice"], "male"); self.assertTrue(sent["message_id"].startswith("<"))
        j = json.load(open(os.path.join(self.base, "queue", "db-11111111-1111-4111-8111-111111111111.json")))
        self.assertTrue(j["db_sent_reported"])
        self.vo.pull_db(); self.vo.send_new(); self.assertEqual(len(FakeSMTP.sent), 1, "no second e-mail")

    def test_db_job_times_out_after_15_minutes(self):
        self.vo.pull_db(); self.vo.send_new()
        p = os.path.join(self.base, "queue", "db-11111111-1111-4111-8111-111111111111.json")
        j = json.load(open(p)); j["taken_at"] -= 31 * 60; self.vo.save(p, j)
        self.vo.report_db()
        self.assertEqual([x for x in self.calls if x[0] == "fail"][0][1]["reason"], "timeout")
        self.assertTrue(os.path.exists(os.path.join(self.base, "done", os.path.basename(p))))

    def test_done_report_retried_until_it_reaches_the_database(self):
        self.vo.pull_db(); self.vo.send_new()
        p = os.path.join(self.base, "queue", "db-11111111-1111-4111-8111-111111111111.json")
        mp3 = os.path.join(self.base, "out", "x.mp3"); open(mp3, "wb").write(b"ID3" + b"\0" * 2000)
        j = json.load(open(p)); j["audio"] = mp3; self.vo.save(p, j)
        real = self.vo.api; self.vo.api = lambda a, pl: None
        self.vo.report_db(); self.assertTrue(os.path.exists(p), "kept while the database is unreachable")
        self.vo.api = real; self.vo.report_db()
        self.assertFalse(os.path.exists(p)); self.assertEqual([x for x in self.calls if x[0] == "done"][0][1]["id"], "11111111-1111-4111-8111-111111111111")

    def test_no_secret_means_folder_jobs_only(self):
        os.remove(os.path.join(self.base, ".vo-worker-secret")); self.vo.pull_db(); self.vo.report_db()
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
