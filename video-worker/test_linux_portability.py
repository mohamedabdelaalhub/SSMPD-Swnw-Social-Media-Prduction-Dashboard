import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import eleven_tts  # noqa: E402
import secret_source  # noqa: E402
import studio_generation  # noqa: E402
import worker  # noqa: E402

FAKE = "unit-test-fake-value-not-a-secret"


class SecretSourceTests(unittest.TestCase):
    def test_env_wins_over_file(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "s"; f.write_text("from-file\n")
            with mock.patch.dict(os.environ, {"X_TEST": "from-env", "X_TEST_FILE": str(f)}):
                self.assertEqual(secret_source.env_or_file("X_TEST"), "from-env")

    def test_file_is_used_and_trimmed(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "s"; f.write_text("  " + FAKE + " \n")
            with mock.patch.dict(os.environ, {"X_TEST_FILE": str(f)}, clear=False):
                os.environ.pop("X_TEST", None)
                self.assertEqual(secret_source.env_or_file("X_TEST"), FAKE)

    def test_missing_file_or_name_gives_empty(self):
        with mock.patch.dict(os.environ, {"X_TEST_FILE": "/nonexistent/secret"}, clear=False):
            os.environ.pop("X_TEST", None)
            self.assertEqual(secret_source.env_or_file("X_TEST"), "")
        os.environ.pop("X_TEST_FILE", None)
        self.assertEqual(secret_source.env_or_file("X_TEST"), "")


class LinuxBehaviourTests(unittest.TestCase):
    def test_keychain_get_never_runs_security_off_macos(self):
        with mock.patch.object(sys, "platform", "linux"), mock.patch("subprocess.run", side_effect=AssertionError("security must not run")):
            self.assertEqual(worker.keychain_get("any"), "")

    def test_keychain_get_survives_missing_security_binary(self):
        with mock.patch.object(sys, "platform", "darwin"), mock.patch("shutil.which", return_value=None), \
             mock.patch("subprocess.run", side_effect=AssertionError("must not run")):
            self.assertEqual(worker.keychain_get("any"), "")

    def test_worker_config_reads_secret_files_without_keychain(self):
        with tempfile.TemporaryDirectory() as d:
            u = Path(d) / "u"; u.write_text("https://example.invalid/\n")
            k = Path(d) / "k"; k.write_text(FAKE + "\n")
            env = {"SSMPD_SUPABASE_URL_FILE": str(u), "SSMPD_SUPABASE_SERVICE_ROLE_KEY_FILE": str(k)}
            with mock.patch.dict(os.environ, env, clear=False), mock.patch.object(sys, "platform", "linux"):
                os.environ.pop("SSMPD_SUPABASE_URL", None); os.environ.pop("SSMPD_SUPABASE_SERVICE_ROLE_KEY", None)
                self.assertEqual(worker.config(), ("https://example.invalid", FAKE))

    def test_worker_config_errors_clearly_without_any_source(self):
        with mock.patch.object(sys, "platform", "linux"), mock.patch.dict(os.environ, {}, clear=False):
            for n in ("SSMPD_SUPABASE_URL", "SSMPD_SUPABASE_SERVICE_ROLE_KEY", "SSMPD_SUPABASE_URL_FILE", "SSMPD_SUPABASE_SERVICE_ROLE_KEY_FILE"):
                os.environ.pop(n, None)
            with self.assertRaises(worker.WorkerError) as cm:
                worker.config()
            self.assertIn("SSMPD_SUPABASE_URL_FILE", str(cm.exception))

    def test_azure_config_from_files_and_default_voice(self):
        with tempfile.TemporaryDirectory() as d:
            k = Path(d) / "k"; k.write_text(FAKE); r = Path(d) / "r"; r.write_text("westeurope")
            env = {"SSMPD_AZURE_SPEECH_KEY_FILE": str(k), "SSMPD_AZURE_SPEECH_REGION_FILE": str(r)}
            with mock.patch.dict(os.environ, env, clear=False), mock.patch.object(sys, "platform", "linux"):
                for n in ("SSMPD_AZURE_SPEECH_KEY", "SSMPD_AZURE_SPEECH_REGION", "SSMPD_AZURE_TTS_VOICE"):
                    os.environ.pop(n, None)
                key, region, voice = worker.azure_tts_config()
                self.assertEqual((key, region, voice), (FAKE, "westeurope", "ar-EG-SalmaNeural"))

    def test_elevenlabs_and_scene_keys_from_files(self):
        with tempfile.TemporaryDirectory() as d:
            e = Path(d) / "e"; e.write_text(FAKE); s = Path(d) / "s"; s.write_text(FAKE + "2")
            env = {"SSMPD_ELEVENLABS_API_KEY_FILE": str(e), "SSMPD_SCENE_API_KEY_FILE": str(s)}
            with mock.patch.dict(os.environ, env, clear=False), mock.patch("subprocess.run", side_effect=AssertionError("no keychain")):
                os.environ.pop("SSMPD_ELEVENLABS_API_KEY", None); os.environ.pop("SSMPD_SCENE_API_KEY", None)
                self.assertEqual(eleven_tts.config()[0], FAKE)
                self.assertEqual(studio_generation.config(), FAKE + "2")

    def test_ffmpeg_paths_fall_back_to_path_lookup(self):
        with tempfile.TemporaryDirectory() as d:
            fake = Path(d) / "ffmpeg"; fake.write_text("x"); probe = Path(d) / "ffprobe"; probe.write_text("x")
            with mock.patch.dict(os.environ, {"SSMPD_FFMPEG": "/nonexistent/ffmpeg", "SSMPD_FFPROBE": "/nonexistent/ffprobe"}), \
                 mock.patch("shutil.which", side_effect=lambda n: str(fake) if n == "ffmpeg" else str(probe)):
                self.assertEqual(worker.ffmpeg_paths(), (str(fake), str(probe)))


if __name__ == "__main__":
    unittest.main()
