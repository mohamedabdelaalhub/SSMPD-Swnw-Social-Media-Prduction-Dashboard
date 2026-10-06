"""Opt-in AI scenes. API credentials stay on the worker; paid requests are checkpointed."""
from __future__ import annotations
import base64
import copy
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = 'https://api.openai.com/v1'


def config():
    key = os.environ.get('SSMPD_SCENE_API_KEY', '').strip()
    if not key and sys.platform == 'darwin':
        result = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', 'SSMPD_SCENE_API_KEY', '-a', getpass.getuser(), '-w'], capture_output=True, text=True)
        if result.returncode == 0:
            key = result.stdout.strip()
        elif result.returncode != 44:
            raise RuntimeError('تعذر قراءة مفتاح توليد المشاهد من Keychain.')
    return key


def call(path, key, payload=None, binary=False):
    request = urllib.request.Request(API + path, data=None if payload is None else json.dumps(payload).encode(),
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}, method='GET' if payload is None else 'POST')
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            data = response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError('خدمة توليد المشاهد HTTP ' + str(error.code) + '. راجع المفتاح أو الرصيد أو إتاحة النموذج.') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RuntimeError('تعذر الاتصال بخدمة توليد المشاهد. المحاولة محفوظة ولن ينشأ طلب فيديو مكرر.') from None
    return data if binary else json.loads(data)


def valid_prompt(scene):
    prompt = str(scene.get('prompt') or '').strip()
    if not 10 <= len(prompt) <= 3000:
        raise RuntimeError('اكتب وصفًا للمشهد من 10 إلى 3000 حرف.')
    return prompt + '\nVertical clinical editorial B-roll. No text, logos, subtitles, watermarks or dialogue. Keep the subject centered for vertical cropping. Do not depict identifiable patients. All voiceover and branding are added separately.'


def prepare(job, directory, checkpoint, upload, download, sleep=time.sleep):
    """Return a runtime-only resolved snapshot. Never rewrite the creator's saved storyboard."""
    board = copy.deepcopy(job.get('storyboard') or {})
    scenes = board.get('scenes') or []
    generated = [(i, s) for i, s in enumerate(scenes) if s.get('source') in ('ai_image', 'ai_video')]
    if not generated:
        return
    key = config()
    if not key and any(not (job.get('generation_state') or {}).get(str(i), {}).get('storage_path') and not (directory / (f'scene-{i:02d}.' + ('png' if scene['source']=='ai_image' else 'mp4'))).exists() for i, scene in generated):
        raise RuntimeError('فعّل مفتاح توليد المشاهد على جهاز العامل أولًا. لم يُرسل طلب توليد.')
    state = copy.deepcopy(job.get('generation_state') or {})
    def save():
        checkpoint(copy.deepcopy(state))
        job['generation_state'] = copy.deepcopy(state)
    for index, scene in generated:
        kind = 'image' if scene['source'] == 'ai_image' else 'video'
        name = f'scene-{index:02d}.' + ('png' if kind == 'image' else 'mp4')
        output = directory / name
        entry = state.setdefault(str(index), {})
        remote = entry.get('storage_path')
        if remote and not output.exists():
            download(remote, output)
        if not output.exists():
            prompt = valid_prompt(scene)
            if kind == 'image':
                if entry.get('status') == 'requesting':
                    raise RuntimeError('طلب صورة سابق لم يرجع نتيجة محفوظة. راجع سجل الخدمة قبل إنشاء محاولة جديدة؛ لم نكرر الطلب.')
                entry['status'] = 'requesting'; save()
                result = call('/images/generations', key, {'model': os.environ.get('SSMPD_SCENE_IMAGE_MODEL', 'gpt-image-1'), 'prompt': prompt, 'n': 1, 'size': '1024x1536', 'quality': 'medium'})
                try:
                    image = base64.b64decode(result['data'][0]['b64_json'], validate=True)
                except (KeyError, IndexError, ValueError, TypeError):
                    raise RuntimeError('لم ترجع خدمة الصور ملفًا صالحًا.') from None
                if not image.startswith(b'\x89PNG\r\n\x1a\n'):
                    raise RuntimeError('ملف الصورة المولدة غير صالح.')
                temporary=output.with_suffix(output.suffix+'.part');temporary.write_bytes(image);temporary.replace(output)
            else:
                video_id = entry.get('provider_id')
                if not video_id:
                    if entry.get('status') == 'requesting':
                        raise RuntimeError('طلب فيديو سابق لم يرجع معرّفًا محفوظًا. راجع سجل الخدمة قبل إنشاء محاولة جديدة.')
                    entry['status'] = 'requesting'; save()
                    seconds = str(scene.get('generation_seconds', 4))
                    if seconds not in ('4', '8', '12'):
                        raise RuntimeError('مدة المشهد المولد يجب أن تكون 4 أو 8 أو 12 ثانية.')
                    result = call('/videos', key, {'model': os.environ.get('SSMPD_SCENE_VIDEO_MODEL', 'sora-2'), 'prompt': prompt, 'seconds': seconds, 'size': '720x1280'})
                    video_id = result.get('id')
                    if not isinstance(video_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', video_id):
                        raise RuntimeError('لم يرجع معرّف صالح للفيديو المولد.')
                    entry.update(provider_id=video_id, status='generating'); save()
                for attempt in range(120):
                    result = call('/videos/' + video_id, key)
                    if result.get('status') == 'failed':
                        entry['status'] = 'failed'; save()
                        raise RuntimeError('رفضت خدمة التوليد هذا المشهد أو فشل إنتاجه. عدّل وصفه قبل محاولة جديدة.')
                    if result.get('status') == 'completed':
                        clip = call('/videos/' + video_id + '/content', key, binary=True)
                        if len(clip) < 12 or clip[4:8] != b'ftyp':
                            raise RuntimeError('المقطع المولد ليس ملف MP4 صالحًا.')
                        temporary=output.with_suffix(output.suffix+'.part');temporary.write_bytes(clip);temporary.replace(output); break
                    sleep(15)
                else:
                    raise RuntimeError('التوليد ما زال جاريًا. الطلب محفوظ ويمكن متابعة نفس الطلب لاحقًا.')
            entry['status'] = 'generated'; save()
        if not remote:
            remote = f'{job["created_by"]}/{job["content_id"]}/generated/{job["id"]}/{name}'
            asset_id = upload(remote, output, 'image/png' if kind == 'image' else 'video/mp4')
            entry.update(storage_path=remote, asset_id=asset_id, status='ready'); save()
        asset_id = entry.get('asset_id') or f'generated-{index}'
        asset = {'id': asset_id, 'asset_type': kind, 'storage_path': remote, 'file_name': name, 'local_path': str(output)}
        job.setdefault('_downloaded_assets', []).append(asset)
        job.setdefault('input_assets', []).append({k:v for k,v in asset.items() if k != 'local_path'})
        scene['asset_id'] = asset_id
        scene['source'] = 'upload'
    job['storyboard'] = board
