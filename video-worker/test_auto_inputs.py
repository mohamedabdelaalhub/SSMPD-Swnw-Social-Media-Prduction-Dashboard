import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import worker


class AutoInputsTests(unittest.TestCase):
    def job(self, mode):
        return {
            'brand': 'sono', 'input_schema_version': 2, 'media_mode': mode,
            'cover_settings': {'logo_source': 'brand_library', 'logo_brand': 'sono',
                               'logo_asset_id': 'logo'},
            'input_assets': [
                {'id': kind, 'asset_type': kind, 'storage_path': 'uploads/' + kind,
                 'file_name': kind + '.mp4'}
                for kind in ('image', 'video', 'voiceover', 'music')
            ] + [{'id': 'logo', 'asset_type': 'brand_logo', 'brand': 'sono',
                  'storage_bucket': 'brand-logos', 'storage_path': 'sono/logo.png',
                  'file_name': 'logo.png'}],
        }

    def test_auto_never_requests_unused_uploads(self):
        def fetch(req, **kwargs):
            self.assertNotIn('/video-inputs/', req.full_url)
            self.assertIn('/brand-logos/sono/logo.png', req.full_url)
            return io.BytesIO(b'logo')

        with tempfile.TemporaryDirectory() as root, patch.object(worker.urllib.request, 'urlopen', side_effect=fetch) as network:
            result = worker.download_job_assets('https://example.invalid', 'test-key', self.job('auto'), Path(root))
            self.assertEqual([a['id'] for a in result], ['logo'])
            self.assertEqual(Path(result[0]['local_path']).read_bytes(), b'logo')
            self.assertEqual(network.call_count, 1)

    def test_upload_modes_keep_all_inputs(self):
        for mode in ('uploaded_only', 'uploaded_plus_auto'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as root, patch.object(worker.urllib.request, 'urlopen', side_effect=lambda *a, **k: io.BytesIO(b'asset')) as network:
                result = worker.download_job_assets('https://example.invalid', 'test-key', self.job(mode), Path(root))
                self.assertEqual(len(result), 5)
                self.assertEqual(network.call_count, 5)


if __name__ == '__main__':
    unittest.main()
