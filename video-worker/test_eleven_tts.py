import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import urllib.error
import eleven_tts
import worker


class ElevenTests(unittest.TestCase):
    def test_keychain_account_matches_setup_and_never_prints_key(self):
        with patch.dict('os.environ', {}, clear=True), patch('eleven_tts.sys.platform', 'darwin'), patch('eleven_tts.getpass.getuser', return_value='mac-user'), patch('eleven_tts.subprocess.run', return_value=subprocess.CompletedProcess([], 0, 'secret\n', '')) as call:
            self.assertEqual(eleven_tts.config(), ('secret', eleven_tts.VOICE_ID))
            self.assertIn('mac-user', call.call_args.args[0])
            self.assertIn('SSMPD_ELEVENLABS_API_KEY', call.call_args.args[0])

    def test_keychain_denial_fails_closed_but_absent_key_allows_legacy(self):
        with patch.dict('os.environ', {}, clear=True), patch('eleven_tts.sys.platform', 'darwin'), patch('eleven_tts.subprocess.run') as call:
            call.return_value = subprocess.CompletedProcess([], 44, '', '')
            self.assertEqual(eleven_tts.config()[0], '')
            call.return_value = subprocess.CompletedProcess([], 36, '', '')
            with self.assertRaises(eleven_tts.ElevenTTSError):
                eleven_tts.config()

    def test_full_script_and_approved_settings_in_one_request(self):
        response = MagicMock()
        response.headers = {'Content-Type': 'audio/mpeg'}
        response.read.return_value = b'ID3sample-audio'
        response.__enter__.return_value = response
        script = 'إزيك؟ عامل إيه؟\nإحنا معاك.'
        with tempfile.TemporaryDirectory() as folder, patch('urllib.request.urlopen', return_value=response) as call:
            output = Path(folder) / 'voice.mp3'
            eleven_tts.synthesize(script, output, 'secret', eleven_tts.VOICE_ID)
            call.assert_called_once()
            request = call.call_args.args[0]
            payload = json.loads(request.data)
            self.assertEqual(payload['text'], script)
            self.assertEqual(payload['model_id'], 'eleven_multilingual_v2')
            self.assertEqual(payload['voice_settings'], {'speed': 1.0, 'stability': .5, 'similarity_boost': .75, 'style': 0., 'use_speaker_boost': True})
            self.assertNotIn('language_code', payload)
            self.assertEqual(request.get_header('Xi-api-key'), 'secret')
            self.assertEqual(output.read_bytes(), b'ID3sample-audio')

    def test_errors_do_not_overwrite_audio_or_expose_response(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'voice.mp3'
            output.write_bytes(b'previous')
            for status in (401, 403, 429, 500):
                error = urllib.error.HTTPError('https://api.elevenlabs.io', status, 'error', {}, io.BytesIO(b'secret'))
                with patch('urllib.request.urlopen', side_effect=error) as call:
                    with self.assertRaises(eleven_tts.ElevenTTSError) as raised:
                        eleven_tts.synthesize('text', output, 'secret', eleven_tts.VOICE_ID)
                    self.assertNotIn('secret', str(raised.exception))
                    call.assert_called_once()
                    self.assertEqual(output.read_bytes(), b'previous')

    def test_invalid_audio_rejected(self):
        response = MagicMock()
        response.headers = {'Content-Type': 'audio/mpeg'}
        response.__enter__.return_value = response
        for data in (b'', b'{"error": "failure"}'):
            response.read.return_value = data
            with tempfile.TemporaryDirectory() as folder, patch('urllib.request.urlopen', return_value=response):
                output = Path(folder) / 'voice.mp3'
                with self.assertRaises(eleven_tts.ElevenTTSError):
                    eleven_tts.synthesize('text', output, 'secret', eleven_tts.VOICE_ID)
                self.assertFalse(output.exists())

    def test_uploaded_voice_has_priority(self):
        with patch('worker.uploaded_asset_paths', return_value=[Path('uploaded.mp3')]), patch('eleven_tts.config') as config:
            self.assertEqual(worker.synthesize('text', Path('.'), {})[0], Path('uploaded.mp3'))
            config.assert_not_called()

    def test_eleven_failure_never_switches_to_azure(self):
        with patch('worker.uploaded_asset_paths', return_value=[]), patch('eleven_tts.config', return_value=('secret', eleven_tts.VOICE_ID)), patch('eleven_tts.synthesize', side_effect=eleven_tts.ElevenTTSError('failure')), patch('worker.azure_tts_config') as azure:
            with self.assertRaises(eleven_tts.ElevenTTSError):
                worker.synthesize('text', Path('.'), {})
            azure.assert_not_called()

    def test_existing_azure_without_eleven_key(self):
        with patch('worker.uploaded_asset_paths', return_value=[]), patch('eleven_tts.config', return_value=('', eleven_tts.VOICE_ID)), patch('worker.azure_tts_config', return_value=('key', 'eastus', 'salma')), patch('worker.azure_synthesize', return_value='salma'):
            self.assertEqual(worker.synthesize('text', Path('.'), {})[1], 'Azure salma')

    def test_voice_test_does_not_touch_supabase_even_when_failing(self):
        with patch('sys.argv', ['worker', '--test-voice']), patch('eleven_tts.config', return_value=('', eleven_tts.VOICE_ID)), patch('worker.config') as config, patch('worker.claim_job') as claim:
            self.assertEqual(worker.main(), 1)
            config.assert_not_called()
            claim.assert_not_called()

if __name__ == '__main__':
    unittest.main()
