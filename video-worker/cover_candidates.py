"""Branded portrait cover options generated from the clean visual track."""
from pathlib import Path
import subprocess
from brand_identity import logo_asset


def cover_title(title: str, words_per_line: int = 4) -> str:
    words = title.replace("\n", " ").split()
    return r"\N".join(" ".join(words[i:i + words_per_line]) for i in range(0, len(words), words_per_line))


def build(job, output, ffmpeg, duration):
    settings = job.get("cover_settings") or {}
    title = str(settings.get("title") or job.get("title") or "").strip()
    if not title or len(title) > 80:
        raise RuntimeError("Cover title must contain 1–80 characters.")
    asset = logo_asset(job, downloaded=True)
    logo = Path(asset.get("local_path") or "")
    if not logo.is_file():
        raise RuntimeError("Saved brand logo could not be downloaded.")

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
        f"Style: Cover,{font},62,&H00FFFFFF,&H00FFFFFF,&H00132636,&H00132636,0,0,0,0,100,100,0,0,1,2,1,5,112,112,0,1\n"
        "[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"
        f"Dialogue: 0,0:00:00.00,0:10:00.00,Cover,,0,0,0,,{{\\pos(540,1250)}}{title}\n",
        encoding="utf-8",
    )

    result = []
    for index, fraction in enumerate((0.12, 0.30, 0.48, 0.66, 0.84), 1):
        path = output.parent / f"cover-{index}.jpg"
        at = max(0, min(duration - 0.1, duration * fraction))
        if not path.exists():
            graph = (
                "[0:v]thumbnail=12,scale=1080:1920:force_original_aspect_ratio=increase,"
                "crop=1080:1920,"
                "drawbox=x=0:y=0:w=1080:h=1920:color=0x071A33@0.24:t=fill,"
                "drawbox=x=54:y=1050:w=972:h=560:color=0x102A43@0.93:t=fill,"
                "ass=filename='cover-title.ass'[base];"
                "[1:v]scale=190:-1:force_original_aspect_ratio=decrease[logo];"
                "[base][logo]overlay=x=70:y=86:format=auto[out]"
            )
            p = subprocess.run(
                [ffmpeg, "-y", "-ss", f"{at:.3f}", "-i", str(source.resolve()),
                 "-i", str(logo.resolve()), "-filter_complex", graph,
                 "-map", "[out]", "-frames:v", "1", "-q:v", "2", str(path.resolve())],
                cwd=str(output.parent), capture_output=True, text=True,
            )
            if p.returncode or not path.exists():
                raise RuntimeError("Cover generation failed: " + p.stderr[-1000:])
        result.append({"index": index, "timestamp_seconds": round(at, 3), "path": path})
    return result
