"""Render immutable script/image scenes with whole-image motion and transitions."""
from __future__ import annotations
import json
import math
from pathlib import Path

MOTIONS = {'pan_left', 'pan_right', 'zoom_in', 'zoom_out'}


def normalize(text):
    return ' '.join(str(text or '').split())


def validate(job, downloaded=False):
    board = job.get('storyboard') or {}
    scenes = board.get('scenes')
    if board.get('version') != 1 or not isinstance(scenes, list):
        raise RuntimeError('قسّم السكريبت وارفع صورة لكل مشهد ثم حدّث المهمة.')
    if not max(3, math.ceil(float(job.get('duration_min_seconds') or 0) / 8)) <= len(scenes) <= 20:
        raise RuntimeError('عدد مشاهد الصور لا يناسب مدة الفيديو.')
    if normalize(board.get('source_script')) != normalize(job.get('script_text')) or normalize(' '.join(s.get('text', '') for s in scenes)) != normalize(job.get('script_text')):
        raise RuntimeError('نصوص المشاهد لا تطابق السكريبت. أعد إنشاء المهمة.')
    if board.get('transition') not in {'fade', 'slide', 'none'}:
        raise RuntimeError('نوع الانتقال غير صالح.')
    assets = {str(a.get('id')): a for a in job.get('_downloaded_assets' if downloaded else 'input_assets', []) if isinstance(a, dict)}
    seen = set()
    for scene in scenes:
        asset_id = str(scene.get('asset_id') or '')
        asset = assets.get(asset_id)
        if not asset or asset.get('asset_type') != 'image' or asset_id in seen:
            raise RuntimeError('كل مشهد يحتاج صورة مختلفة محفوظة في المهمة.')
        if not normalize(scene.get('text')) or len(normalize(scene['text']).split()) > 35 or scene.get('motion') not in MOTIONS:
            raise RuntimeError('نص المشهد أو حركته غير صالح.')
        if downloaded and not Path(asset.get('local_path') or '').is_file():
            raise RuntimeError('لم يتم تحميل صورة المشهد.')
        seen.add(asset_id)
    return scenes


def timeline(job, target, spoken, fps=30):
    scenes = validate(job)
    total = round(target * fps)
    speech = min(total, max(len(scenes), round(spoken * fps)))
    weights = [len(normalize(s['text']).split()) for s in scenes]
    cumulative, previous = 0, 0
    lengths = []
    for i, weight in enumerate(weights):
        cumulative += weight
        end = speech if i == len(weights)-1 else round(speech * cumulative / sum(weights))
        lengths.append(end-previous)
        previous = end
    lengths[-1] += total-speech
    if min(lengths) < 2:
        raise RuntimeError('مدة أحد المشاهد قصيرة جدًا. راجع السكريبت والمدة.')
    overlap = 0 if job['storyboard']['transition'] == 'none' else min(round(.45*fps), min(lengths)//3)
    cursor, result = 0, []
    for i, (scene, length) in enumerate(zip(scenes, lengths)):
        result.append(dict(scene, start_frame=cursor, content_frames=length, clip_frames=length+(overlap if i < len(scenes)-1 else 0)))
        cursor += length
    return result, overlap


def motion_filter(motion, frames, width=1080, height=1920, fps=30):
    progress = f'min(on/{max(1, frames-1)},1)'
    z, x, y = '1.10', '(iw-iw/zoom)/2', '(ih-ih/zoom)/2'
    if motion == 'pan_left': x = f'(iw-iw/zoom)*{progress}'
    elif motion == 'pan_right': x = f'(iw-iw/zoom)*(1-{progress})'
    elif motion == 'zoom_in': z = f'1+0.10*{progress}'
    elif motion == 'zoom_out': z = f'1.10-0.10*{progress}'
    else: raise RuntimeError('Unsupported image motion')
    return (f'scale={width*2}:{height*2}:force_original_aspect_ratio=increase,crop={width*2}:{height*2},'
            f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s={width}x{height}:fps={fps},"
            f'fps={fps},setsar=1,settb=AVTB,format=yuv420p')


def render(ffmpeg, job, directory, target, spoken, run, width=1080, height=1920, fps=30):
    validate(job, downloaded=True)
    plan, overlap = timeline(job, target, spoken, fps)
    assets = {str(a.get('id')): a for a in job['_downloaded_assets']}
    paths = []
    for i, scene in enumerate(plan):
        output = directory / f'storyboard-{i:02d}.mp4'
        source = Path(assets[str(scene['asset_id'])]['local_path'])
        command = [ffmpeg, '-y', '-filter_threads', '1', '-loop', '1', '-framerate', str(fps), '-i', str(source),
                   '-vf', motion_filter(scene['motion'], scene['clip_frames'], width, height, fps),
                   '-frames:v', str(scene['clip_frames']), '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast',
                   '-crf', '22', '-pix_fmt', 'yuv420p', str(output)]
        process = run(command, check=False)
        if process.returncode or not output.is_file(): raise RuntimeError('تعذر تحريك صورة المشهد ' + str(i+1) + ': ' + process.stderr[-1000:])
        paths.append(output)
    command = [ffmpeg, '-y', '-filter_complex_threads', '1']
    for path in paths: command += ['-i', str(path)]
    filters = [f'[{i}:v]settb=AVTB,setpts=PTS-STARTPTS[v{i}]' for i in range(len(paths))]
    if not overlap:
        filters.append(''.join(f'[v{i}]' for i in range(len(paths))) + f'concat=n={len(paths)}:v=1:a=0[out]')
        previous = 'out'
    else:
        previous = 'v0'
        for i in range(1, len(paths)):
            transition = 'fade' if job['storyboard']['transition'] == 'fade' else ('smoothleft' if i % 2 else 'smoothright')
            label = f'blend{i}'
            filters.append(f'[{previous}][v{i}]xfade=transition={transition}:duration={overlap/fps:.6f}:offset={plan[i]["start_frame"]/fps:.6f}[{label}]')
            previous = label
    output = directory / 'background.mp4'
    command += ['-filter_complex', ';'.join(filters), '-map', f'[{previous}]', '-an', '-t', f'{target:.6f}',
                '-r', str(fps), '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', str(output)]
    process = run(command, check=False)
    if process.returncode or not output.is_file(): raise RuntimeError('تعذر تركيب انتقالات المشاهد: ' + process.stderr[-1500:])
    (directory / 'storyboard-timeline.json').write_text(json.dumps({'fps': fps, 'overlap_frames': overlap, 'scenes': plan}, ensure_ascii=False, indent=2))
    return output
