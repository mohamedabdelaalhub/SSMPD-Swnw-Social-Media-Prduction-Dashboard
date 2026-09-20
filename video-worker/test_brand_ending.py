import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import worker

@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
class BrandEndingTests(unittest.TestCase):
    def test_concat_normalizes_pixel_aspect_ratio_and_audio(self):
        ffmpeg=shutil.which('ffmpeg')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            clips=[root/'main.mp4',root/'brand-contact.mp4',root/'outro.mp4']
            for i,clip in enumerate(clips):
                subprocess.run([ffmpeg,'-v','error','-y','-f','lavfi','-i',
                    'color=c=blue:s=1080x1920:r=30:d=0.2','-f','lavfi','-i',
                    'anullsrc=r=48000:cl=stereo','-vf',
                    'setsar='+('14080/14079:max=100000' if i==1 else '1'),
                    '-t','0.2','-c:v','libx264','-preset','ultrafast','-c:a','aac',str(clip)],check=True)
            # Reproduce the reported failure before using the normalized concat.
            baseline=subprocess.run([ffmpeg,'-v','error','-i',str(clips[0]),'-i',str(clips[1]),'-i',str(clips[2]),
                '-filter_complex','[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]',
                '-map','[v]','-map','[a]','-f','null','-'],capture_output=True,text=True)
            self.assertNotEqual(baseline.returncode,0)
            self.assertIn('SAR',baseline.stderr)
            with patch.object(worker,'brand_contact_slide',return_value=root/'unused.png'),patch.object(worker,'brand_outro',return_value=clips[2]):
                result=worker.append_brand_ending(ffmpeg,{},clips[0])
            data=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(result)]))
            video=next(s for s in data['streams'] if s['codec_type']=='video')
            audio=next(s for s in data['streams'] if s['codec_type']=='audio')
            self.assertEqual((video['width'],video['height']),(1080,1920))
            self.assertEqual(video['sample_aspect_ratio'],'1:1')
            self.assertEqual(audio['sample_rate'],'48000')
            self.assertEqual(audio['channels'],2)

if __name__=='__main__': unittest.main()
