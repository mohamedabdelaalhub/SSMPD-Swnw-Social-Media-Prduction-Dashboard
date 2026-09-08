import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import drive_archive
import worker


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / 'output.mp4'
        self.output.write_bytes(b'rendered-video')
        self.output.with_name('cover.jpg').write_bytes(b'cover')
        self.job = {'id': '11111111-1111-1111-1111-111111111111',
                    'content_id': '22222222-2222-2222-2222-222222222222',
                    'created_at': '2026-09-08T00:00:00Z', 'brand': 'sono'}
        self.result = {'fileUrl': 'https://drive.google.com/file/d/test/view',
                       'fileId': 'test', 'folderUrl': 'https://drive.google.com/drive/folders/test'}

    @patch.object(worker, 'probe_duration', return_value=10)
    @patch.object(worker, 'ffmpeg_paths', return_value=('ffmpeg', 'ffprobe'))
    def test_ready_requires_video_and_cover_without_staging(self, *_):
        with patch.object(worker, 'archive_upload', return_value=self.result) as upload, \
             patch.object(worker, 'update_job') as update, \
             patch.object(worker, 'upload_mp4') as stage, patch.dict(os.environ, {}, clear=True):
            worker.archive_rendered_job('url', 'key', self.job, self.output)
        self.assertEqual([call.args[2] for call in upload.call_args_list], ['video', 'cover'])
        stage.assert_not_called()
        final = update.call_args.args[3]
        self.assertEqual(final['archive_status'], 'archived')
        self.assertEqual(final['drive_video_url'], self.result['fileUrl'])
        self.assertIsNone(final['output_video_url'])

    @patch.object(worker, 'probe_duration', return_value=10)
    @patch.object(worker, 'ffmpeg_paths', return_value=('ffmpeg', 'ffprobe'))
    def test_cover_failure_never_marks_ready_and_retains_output(self, *_):
        with patch.object(worker, 'archive_upload', side_effect=[self.result, RuntimeError('timeout')]), \
             patch.object(worker, 'update_job') as update:
            with self.assertRaises(RuntimeError):
                worker.archive_rendered_job('url', 'key', self.job, self.output)
        self.assertEqual(update.call_args.args[3]['archive_status'], 'failed')
        self.assertFalse(any(c.args[3].get('status') == 'ready' for c in update.call_args_list))
        self.assertEqual(self.output.read_bytes(), b'rendered-video')

    def test_retry_uses_existing_output_without_render(self):
        with patch.object(worker, 'request_json', return_value=[dict(self.job, status='failed')]), \
             patch.object(worker, 'archive_rendered_job') as archive, patch.object(worker, 'render') as render:
            worker.retry_archive('url', 'key', self.job['id'])
        render.assert_not_called()
        self.assertEqual(archive.call_args.args[3].name, 'output.mp4')

    def test_rejects_old_bridge_response(self):
        from io import BytesIO
        with patch.object(drive_archive, 'bridge_url', return_value='https://script.google.com/macros/s/test/exec'), \
             patch.object(drive_archive.urllib.request, 'urlopen', return_value=BytesIO(json.dumps(dict(self.result, ok=True)).encode())):
            with self.assertRaisesRegex(RuntimeError, 'Deploy the updated'):
                drive_archive.upload(self.job, self.output, 'video')


if __name__ == '__main__':
    unittest.main()
