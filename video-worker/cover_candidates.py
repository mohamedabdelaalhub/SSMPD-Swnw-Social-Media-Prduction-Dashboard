"""Five branded cover options from the rendered visual track; FFmpeg + libass."""
from pathlib import Path
import subprocess


def build(job, output, ffmpeg, duration):
    settings = job.get('cover_settings') or {}
    if not settings.get('enabled'):
        return []
    title = str(settings.get('title') or job.get('title') or '').strip()
    if not title or len(title) > 80:
        raise RuntimeError('Cover title must contain 1–80 characters.')
    logo = next((Path(a['local_path']) for a in job.get('_downloaded_assets', [])
                 if a.get('id') == settings.get('logo_asset_id') and a.get('asset_type') == 'image'), None)
    if logo is None or not logo.is_file():
        raise RuntimeError('Choose and upload the brand logo before generating cover options.')
    output = Path(output)
    # The clean track avoids duplicating burned-in subtitles on the cover.
    source = output.parent / 'background.mp4'
    if not source.exists():
        source = output
    top = settings.get('position') == 'top'
    card_y, text_y, logo_y = (310, 530, 1340) if top else (1190, 1410, 300)
    safe_title = title.replace('\\', ' ').replace('{', '').replace('}', '').replace('\n', ' ')
    ass = output.parent / 'cover-title.ass'
    ass.write_text(
        '[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n'
        '[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n'
        'Style: Cover,Arial,72,&H00FFFFFF,&H00FFFFFF,&H00132636,&H00132636,-1,0,0,0,100,100,0,0,1,1,0,5,120,120,0,1\n'
        '[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n'
        f'Dialogue: 0,0:00:00.00,0:10:00.00,Cover,,0,0,0,,{{\\pos(540,{text_y})}}{safe_title}\n', encoding='utf-8')
    # A relative subtitle filename avoids special characters in the user's home path.
    result = []
    for index, fraction in enumerate((0.12, 0.30, 0.48, 0.66, 0.84), 1):
        path = output.parent / f'cover-{index}.jpg'
        at = max(0, min(duration - 0.1, duration * fraction))
        if not path.exists():
            graph = (
                f'[0:v]thumbnail=12,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,'
                f'drawbox=x=64:y={card_y}:w=952:h=440:color=0x132636@0.94:t=fill,'
                "ass=filename='cover-title.ass'[base];"
                '[1:v]scale=230:150:force_original_aspect_ratio=decrease,'
                'pad=270:190:(ow-iw)/2:(oh-ih)/2:color=white[logo];'
                f'[base][logo]overlay=x=730:y={logo_y}[out]')
            p = subprocess.run([ffmpeg, '-y', '-ss', f'{at:.3f}', '-i', str(source.resolve()),
                                '-i', str(logo.resolve()), '-filter_complex', graph,
                                '-map', '[out]', '-frames:v', '1', '-q:v', '2', str(path.resolve())],
                               cwd=str(output.parent), capture_output=True, text=True)
            if p.returncode or not path.exists():
                raise RuntimeError('Cover generation failed: ' + p.stderr[-1000:])
        result.append({'index': index, 'timestamp_seconds': round(at, 3), 'path': path})
    return result
