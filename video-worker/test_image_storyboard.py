import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
import image_storyboard as story

class StoryboardTests(unittest.TestCase):
    def setUp(self):
        scenes = [{'text': text, 'asset_id': str(i), 'motion': motion} for i, (text, motion) in enumerate([
            ('المشهد الأول هنا', 'pan_left'), ('المشهد الثاني هنا', 'pan_right'), ('المشهد الثالث هنا', 'zoom_in')])]
        self.job = {'script_text': ' '.join(s['text'] for s in scenes), 'duration_min_seconds': 3,
                    'storyboard': {'version': 1, 'transition': 'fade', 'scenes': scenes},
                    'input_assets': [{'id': str(i), 'asset_type': 'image'} for i in range(3)]}
        self.job['storyboard']['source_script'] = self.job['script_text']

    def test_snapshot_validation_and_timing(self):
        plan, overlap = story.timeline(self.job, 9, 6)
        self.assertEqual([s['asset_id'] for s in plan], ['0', '1', '2'])
        self.assertEqual(sum(s['clip_frames'] for s in plan)-overlap*2, 270)
        self.assertEqual(plan[-1]['content_frames'], 150)  # hold last image through the silent tail
        for mutate in [lambda j: j['storyboard']['scenes'][1].update(asset_id='0'),
                       lambda j: j['storyboard']['scenes'][0].update(asset_id=None),
                       lambda j: j.update(script_text='changed'),
                       lambda j: j['storyboard']['scenes'].reverse()]:
            job = copy.deepcopy(self.job); mutate(job)
            with self.assertRaises(RuntimeError): story.validate(job)

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
    def test_real_ffmpeg_transitions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = []
            for i in range(3):
                # A gradient/grid reveals panning and zooming in decoded pixels.
                image = root / f'{i}.ppm'
                pixels = bytearray()
                for y in range(120):
                    for x in range(90): pixels.extend(((x*3+i*60)%256, y*2, (x+y+i*80)%256))
                image.write_bytes(b'P6\n90 120\n255\n'+pixels)
                assets.append({'id': str(i), 'asset_type': 'image', 'local_path': str(image)})
            self.job['_downloaded_assets'] = assets
            def run(cmd, **kwargs): return subprocess.run(cmd, text=True, capture_output=True, **kwargs)
            for transition in ('fade', 'slide', 'none'):
                self.job['storyboard']['transition'] = transition
                output = story.render('ffmpeg', self.job, root, 3.6, 3.6, run, width=270, height=480)
                probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(output)]))
                self.assertEqual((probe['streams'][0]['width'],probe['streams'][0]['height']), (270,480))
                self.assertAlmostEqual(float(probe['format']['duration']), 3.6, delta=.1)
            for motion in ('pan_left','pan_right','zoom_in','zoom_out'):
                self.job['storyboard']['scenes'][0]['motion'] = motion
                story.render('ffmpeg', self.job, root, 3.6, 3.6, run, width=270, height=480)
                segment = root/'storyboard-00.mp4'
                def frame(at): return subprocess.check_output(['ffmpeg','-v','error','-ss',str(at),'-i',str(segment),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])
                self.assertNotEqual(frame(.1),frame(.9), motion+' must move the image')

if __name__ == '__main__': unittest.main()
