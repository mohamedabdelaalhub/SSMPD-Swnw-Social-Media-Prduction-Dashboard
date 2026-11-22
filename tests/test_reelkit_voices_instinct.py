"""scripts/reelkit/voices.py: Instinct narrator with ElevenLabs fallback (mocked gateway, no network)."""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts", "reelkit"))
import voices as V


class Clock:
    def __init__(self): self.t = 0.0
    def time(self): return self.t
    def sleep(self, s): self.t += s


def gateway(answers):
    """answers: list of (code, ctype, json) for vo_fetch calls; vo_submit always answers a job id."""
    calls = []
    def http(op, query="", body=None, out_path=None):
        calls.append((op, query, body))
        if op == "vo_submit": return 200, "application/json", {"ok": True, "job_id": "11111111-1111-4111-8111-111111111111"}
        code, ctype, d = answers.pop(0) if answers else (200, "application/json", {"ok": True, "status": "sent"})
        if ctype.startswith("audio/") and out_path:
            with open(out_path, "wb") as f: f.write(b"ID3fake")
            d = {"voice": "female"}
        return code, ctype, d
    return http, calls


class InstinctTests(unittest.TestCase):
    def setUp(self):
        V._instinct_tried.clear(); V.VO.update(engine="instinct", voice="auto", energy="moderate", notes="", timeout=900, interval=20)
        self.el = []
        V.speak_direct = lambda voice, text, out: (self.el.append(("direct", voice)) or None)
        V.speak_gateway = lambda voice, text, out: (self.el.append(("gateway", voice)) or {"chars": list(text), "start": [0] * len(text), "end": [0] * len(text), "source": "el"})
        V.instinct_timing = lambda text, mp3: {"chars": list(text), "start": [0] * len(text), "end": [1] * len(text), "source": "instinct"}
        self.out = os.path.join(os.environ.get("TMPDIR", "/tmp"), "vo_test.mp3")

    def run_speak(self, answers, voice="narrator", text="سُونُو معاك."):
        http, calls = gateway(answers); c = Clock()
        real = V.speak_instinct
        V.speak_instinct = lambda t, o: real(t, o, http=http, sleep=c.sleep, clock=c.time)
        try: return V.speak(voice, text, self.out), calls, c
        finally: V.speak_instinct = real

    def test_done_returns_instinct_take(self):
        r, calls, c = self.run_speak([(200, "application/json", {"ok": True, "status": "queued"}), (200, "audio/mpeg", None)])
        self.assertEqual(r["source"], "instinct"); self.assertEqual(self.el, []); self.assertEqual(V.LAST_VO["voice"], "female")
        self.assertEqual(calls[0][0], "vo_submit"); self.assertEqual(calls[0][2]["voice"], "auto"); self.assertEqual(calls[0][2]["energy"], "moderate")
        self.assertEqual(c.t, 40)  # polled every 20 s

    def test_energy_from_storyboard(self):
        V.VO.update({"energy": "energetic"})
        r, calls, _ = self.run_speak([(200, "audio/mpeg", None)])
        self.assertEqual(calls[0][2]["energy"], "energetic")

    def test_timeout_falls_back_to_elevenlabs(self):
        r, calls, c = self.run_speak([])  # always "sent"
        self.assertEqual(r["source"], "el"); self.assertEqual(self.el, [("direct", "narrator"), ("gateway", "narrator")])
        self.assertGreaterEqual(c.t, 900); self.assertLessEqual(c.t, 920)
        self.assertEqual(len([x for x in calls if x[0] == "vo_fetch"]), 45)

    def test_server_timeout_or_failure_falls_back_at_once(self):
        for st in ("timeout", "failed"):
            V._instinct_tried.clear(); self.el.clear()
            r, _, c = self.run_speak([(200, "application/json", {"ok": True, "status": st})])
            self.assertEqual(r["source"], "el"); self.assertEqual(c.t, 20)

    def test_submit_refused_falls_back(self):
        def http(op, query="", body=None, out_path=None): return 400, "application/json", {"ok": False, "error": "vo: looks like a phone number"}
        real = V.speak_instinct; V.speak_instinct = lambda t, o: real(t, o, http=http, sleep=lambda s: None, clock=lambda: 0)
        try: r = V.speak("narrator", "x", self.out)
        finally: V.speak_instinct = real
        self.assertEqual(r["source"], "el")

    def test_regenerate_same_text_goes_to_elevenlabs(self):
        self.run_speak([(200, "audio/mpeg", None)])
        r, calls, _ = self.run_speak([(200, "audio/mpeg", None)])
        self.assertEqual(calls, []); self.assertEqual(r["source"], "el")

    def test_characters_stay_on_elevenlabs(self):
        r, calls, _ = self.run_speak([], voice="doctor_male")
        self.assertEqual(calls, []); self.assertEqual(self.el[0], ("direct", "doctor_male"))

    def test_engine_switch_off(self):
        V.VO["engine"] = "elevenlabs"
        r, calls, _ = self.run_speak([])
        self.assertEqual(calls, []); self.assertEqual(r["source"], "el")

    def test_align_pins_lines_between_pauses(self):
        text = "سطر أول.\n\nسطر تاني طويل شوية."
        a = V.align_to_audio(text, 6.0, [(0.0, 0.4), (2.0, 2.6), (5.7, 6.0)])
        self.assertEqual(len(a["start"]), len(text))
        b = text.index("\n\n")
        self.assertAlmostEqual(a["start"][0], 0.4, places=3); self.assertAlmostEqual(a["end"][b - 1], 2.0, places=3)
        self.assertAlmostEqual(a["start"][b + 2], 2.6, places=3); self.assertAlmostEqual(a["end"][-1], 5.7, places=3)
        self.assertTrue(all(x <= y for x, y in zip(a["start"], a["start"][1:])))

    def test_align_without_pauses_stretches(self):
        text = "واحد.\n\nاتنين."
        a = V.align_to_audio(text, 4.0, [])
        self.assertAlmostEqual(a["start"][0], 0.0, places=3); self.assertAlmostEqual(a["end"][-1], 4.0, places=3)


if __name__ == "__main__":
    unittest.main()
