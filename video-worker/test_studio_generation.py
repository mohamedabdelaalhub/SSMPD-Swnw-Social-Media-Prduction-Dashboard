import base64,copy,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import studio_generation as gen

class GenerationTests(unittest.TestCase):
 def setUp(self):
  self.job={'id':'job','content_id':'content','created_by':'owner','input_assets':[],'_downloaded_assets':[], 'storyboard':{'version':2,'scenes':[{'source':'ai_image','prompt':'A quiet medical waiting room','text':'نص','clip_start':0}]}}
  self.states=[]
 def checkpoint(self,state):self.states.append(copy.deepcopy(state))
 @patch.object(gen,'config',return_value='')
 @patch.object(gen,'call')
 def test_missing_key_never_requests(self,call,_):
  with tempfile.TemporaryDirectory() as tmp:
   with self.assertRaisesRegex(RuntimeError,'فعّل'):gen.prepare(self.job,Path(tmp),self.checkpoint,lambda *a:None,lambda *a:None)
  call.assert_not_called()
 @patch.object(gen,'config',return_value='key')
 @patch.object(gen,'call',return_value={'data':[{'b64_json':base64.b64encode(b'\x89PNG\r\n\x1a\nimage').decode()}]})
 def test_image_checkpoint_upload_and_reuse(self,call,_):
  original=copy.deepcopy(self.job['storyboard']);uploaded=[]
  with tempfile.TemporaryDirectory() as tmp:
   gen.prepare(self.job,Path(tmp),self.checkpoint,lambda *a:uploaded.append(a[0]) or 'asset',lambda *a:None)
   self.assertEqual(call.call_count,1);self.assertEqual(self.states[-1]['0']['asset_id'],'asset');self.assertEqual(uploaded,['owner/content/generated/job/scene-00.png'])
   self.assertEqual(self.job['storyboard']['scenes'][0]['source'],'upload')
   resume=copy.deepcopy(self.job);resume['storyboard']=original
   gen.prepare(resume,Path(tmp),self.checkpoint,lambda *a:None,lambda *a:None)
   self.assertEqual(call.call_count,1)
 @patch.object(gen,'config',return_value='key')
 @patch.object(gen,'call')
 def test_ambiguous_request_does_not_duplicate(self,call,_):
  self.job['generation_state']={'0':{'status':'requesting'}}
  with tempfile.TemporaryDirectory() as tmp:
   with self.assertRaisesRegex(RuntimeError,'لم نكرر'):gen.prepare(self.job,Path(tmp),self.checkpoint,lambda *a:None,lambda *a:None)
  call.assert_not_called()
 @patch.object(gen,'config',return_value='key')
 @patch.object(gen,'call')
 def test_existing_video_request_is_polled_not_created(self,call,_):
  self.job['storyboard']['scenes'][0]['source']='ai_video';self.job['generation_state']={'0':{'provider_id':'video_safe','status':'generating'}}
  call.side_effect=[{'status':'completed'},b'\x00\x00\x00\x18ftypmp42mock']
  with tempfile.TemporaryDirectory() as tmp:gen.prepare(self.job,Path(tmp),self.checkpoint,lambda *a:'asset',lambda *a:None,sleep=lambda _:None)
  self.assertEqual([c.args[0] for c in call.call_args_list],['/videos/video_safe','/videos/video_safe/content'])

if __name__=='__main__':unittest.main()
