import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import worker

class MediaIsolationTests(unittest.TestCase):
    def test_only_curated_brand_specialty_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            names=['Brand Templates/Dina/Dina Outro.mp4','Brand Templates/Swnw/Swnw Cover.png','random.mp4','B-roll/dr_dina/obgyn/doctor.mp4','B-roll/sono/neuro/doctor.mp4','B-roll/sono/obgyn/scene.mp4','B-roll/shared/obgyn/consultation.mp4','B-roll/sono/obgyn/cover.mp4','B-roll/sono/obgyn/photo.png']
            for name in names:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.touch()
            with patch.object(worker,'media_root',return_value=root):
                result=worker.discover_media_assets({'brand':'sono','specialty':'obgyn','media_mode':'auto'})
                self.assertEqual({p.name for p in result},{'scene.mp4','consultation.mp4'})
                self.assertEqual(worker.discover_media_assets({'brand':'sono','specialty':'../Dina','media_mode':'auto'}),[])

    def test_no_footage_stops_before_voice(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker,'ffmpeg_paths',return_value=('ffmpeg','ffprobe')), patch.object(worker,'discover_media_assets',return_value=[]), patch.object(worker,'synthesize') as voice:
            with self.assertRaises(worker.WorkerError):
                worker.render({'script_text':'test','duration_min_seconds':25,'duration_max_seconds':30},Path(tmp))
            voice.assert_not_called()

if __name__=='__main__':unittest.main()
