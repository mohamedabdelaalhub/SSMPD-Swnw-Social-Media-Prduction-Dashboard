"""Branded portrait cover options generated from the clean visual track."""
from pathlib import Path
import subprocess


def cover_title(title: str, words_per_line: int = 4) -> str:
    words = title.replace("\n", " ").split()
    return r"\N".join(" ".join(words[i:i + words_per_line]) for i in range(0, len(words), words_per_line))


def build(job, output, ffmpeg, duration, template_dir=None):
    settings = job.get("cover_settings") or {}
    title = str(settings.get("title") or job.get("title") or "").strip()
    if not title or len(title) > 80:
        raise RuntimeError("Cover title must contain 1–80 characters.")

    output = Path(output)
    source = output.parent / "background.mp4"
    if not source.exists():
        source = output
    font = str(settings.get("font_family") or "BigVestaArabicBeta").strip()
    title = cover_title(title.replace("\\", " ").replace("{", "").replace("}", " "))
    ass = output.parent / "cover-title.ass"
    ass.write_text(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n"
        "[V4+ Styles]\n"
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n"
        f"Style: Cover,{font},64,&H00005DFF,&H00005DFF,&H00005DFF,&H00000000,0,0,0,0,100,100,0,0,1,1,0,5,112,112,0,1\n"
        "[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"
        f"Dialogue: 0,0:00:00.00,0:10:00.00,Cover,,0,0,0,,{{\\pos(540,1320)}}{title}\n",
        encoding="utf-8",
    )

    folder = Path(template_dir) if template_dir else None
    template_name = "Dina Front Video Cover Template.png" if str(job.get("brand") or "") == "dr_dina" else "Swnw Front Video Cover Template.png"
    template = folder / template_name if folder else None
    use_template = bool(template and template.is_file())

    result = []
    for index, fraction in enumerate((0.12, 0.30, 0.48, 0.66, 0.84), 1):
        path = output.parent / f"cover-{index}.jpg"
        temp = output.parent / f".cover-{index}.png"
        at = max(0, min(duration - 0.1, duration * fraction))
        if not path.exists():
            if use_template:
                graph = (
                    "[0:v]thumbnail=12,scale=1080:1920:force_original_aspect_ratio=increase,"
                    "crop=1080:1920[background];"
                    "[1:v]scale=1080:1920[template];"
                    "[background][template]overlay=0:0:format=auto,"
                    "ass=filename='cover-title.ass'[out]"
                )
                command = [
                    ffmpeg, "-y", "-ss", f"{at:.3f}", "-i", str(source.resolve()),
                    "-i", str(template.resolve()), "-filter_complex", graph,
                    "-map", "[out]", "-frames:v", "1", "-c:v", "png", "-threads", "1", str(temp.resolve()),
                ]
            else:
                graph = (
                    "[0:v]thumbnail=12,scale=1080:1920:force_original_aspect_ratio=increase,"
                    "crop=1080:1920,"
                    "drawbox=x=0:y=0:w=1080:h=1920:color=0x071A33@0.24:t=fill,"
                    "drawbox=x=54:y=1050:w=972:h=560:color=0x102A43@0.93:t=fill,"
                    "ass=filename='cover-title.ass'[out]"
                )
                command = [
                    ffmpeg, "-y", "-ss", f"{at:.3f}", "-i", str(source.resolve()),
                    "-filter_complex", graph,
                    "-map", "[out]", "-frames:v", "1", "-c:v", "png", "-threads", "1", str(temp.resolve()),
                ]
            p = subprocess.run(command, cwd=str(output.parent), capture_output=True, text=True)
            if not p.returncode and temp.exists():
                converted = subprocess.run(
                    ["/usr/bin/sips", "-s", "format", "jpeg", str(temp.resolve()), "--out", str(path.resolve())],
                    cwd=str(output.parent), capture_output=True, text=True,
                )
                temp.unlink(missing_ok=True)
                if converted.returncode:
                    raise RuntimeError("Cover JPEG conversion failed: " + converted.stderr[-1000:])
            if p.returncode or not path.exists():
                raise RuntimeError("Cover generation failed: " + p.stderr[-1000:])
        result.append({"index": index, "timestamp_seconds": round(at, 3), "path": path})
    return result
