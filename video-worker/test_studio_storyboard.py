import copy,json,shutil,subprocess,tempfile,unittest
from pathlib import Path
import studio_storyboard as story

class StudioTests(unittest.TestCase):
 def setUp(self):
  texts=['المشهد الأول','المشهد الثاني','المشهد الثالث'];scenes=[{'text':text,'asset_id':str(i),'motion':'zoom_in','clip_start':0} for i,text in enumerate(texts)]
  self.job={'script_text':' '.join(texts),'duration_min_seconds':3,'storyboard':{'version':2,'source_script':' '.join(texts),'transition':'fade','scenes':scenes},'input_assets':[{'id':str(i),'asset_type':'video' if i==1 else 'image'} for i in range(3)]}
 def test_validation_and_exact_frame_budget(self):
  plan,overlap=story.timeline(self.job,3.6,3.1)
  self.assertEqual([s['asset_id'] for s in plan],['0','1','2']);self.assertEqual(sum(s['clip_frames'] for s in plan)-overlap*2,108)
  bad=copy.deepcopy(self.job);bad['storyboard']['scenes'][0]['clip_start']=-1
  with self.assertRaisesRegex(RuntimeError,'بداية'):story.validate(bad)
 @unittest.skipUnless(shutil.which('ffmpeg'),'FFmpeg required')
 def test_real_mixed_render_discards_source_audio_and_trims(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)
   for i in [0,2]:
    (root/f'{i}.ppm').write_bytes(b'P6\n90 120\n255\n'+bytes([0,200,100])*90*120)
   clip=root/'clip.mp4'
   subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=s=270x480:r=30:d=2','-f','lavfi','-i','sine=frequency=700:duration=2','-c:v','libx264','-c:a','aac',str(clip)],check=True)
   self.job['_downloaded_assets']=[{'id':str(i),'asset_type':'video' if i==1 else 'image','local_path':str(clip if i==1 else root/f'{i}.ppm')} for i in range(3)]
   self.job['storyboard']['scenes'][1]['clip_start']=.8
   def run(cmd,**kwargs):return subprocess.run(cmd,capture_output=True,text=True,**kwargs)
   for transition in ['fade','slide','none']:
    self.job['storyboard']['transition']=transition
    output=story.render('ffmpeg',self.job,root,3.6,3.6,run,width=270,height=480)
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(output)]))
    self.assertEqual(len(probe['streams']),1);self.assertEqual(probe['streams'][0]['codec_type'],'video');self.assertEqual((probe['streams'][0]['width'],probe['streams'][0]['height']),(270,480));self.assertAlmostEqual(float(probe['format']['duration']),3.6,delta=.1)

if __name__=='__main__':unittest.main()
