#!/usr/bin/env python3
# SSMPD Mac Video Worker — stdlib-only worker for Supabase + FFmpeg.
# Secrets are read from macOS Keychain; nothing secret is stored in this repo.

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

KEYCHAIN_SERVICE = "SSMPD Video Worker"
KEYCHAIN_URL_ACCOUNT = "supabase_url"
KEYCHAIN_KEY_ACCOUNT = "service_role_key"

DEFAULT_FFMPEG = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
DEFAULT_FFPROBE = "/opt/homebrew/opt/ffmpeg-full/bin/ffprobe"
POLL_SECONDS = int(os.environ.get("SSMPD_VIDEO_POLL_SECONDS", "10"))
WORK_ROOT = Path(os.environ.get("SSMPD_VIDEO_WORK_ROOT", str(Path.home() / "SSMPDVideoWorker" / "jobs")))
WORKER_ID = os.environ.get("SSMPD_VIDEO_WORKER_ID", socket.gethostname())


class WorkerError(RuntimeError):
    pass


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, text=True, capture_output=True, check=check)


def keychain_get(account: str) -> str:
    p = subprocess.run(
        ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
        text=True,
        capture_output=True,
    )
    return p.stdout.strip() if p.returncode == 0 else ""


def config() -> tuple[str, str]:
    url = os.environ.get("SSMPD_SUPABASE_URL", "").strip() or keychain_get(KEYCHAIN_URL_ACCOUNT)
    key = os.environ.get("SSMPD_SUPABASE_SERVICE_ROLE_KEY", "").strip() or keychain_get(KEYCHAIN_KEY_ACCOUNT)
    if not url:
        raise WorkerError("Supabase URL is not configured in Keychain.")
    if not key:
        raise WorkerError("Supabase service_role key is not configured in Keychain.")
    return url.rstrip("/"), key


def api_headers(key: str, *, json_content: bool = True) -> dict[str, str]:
    h = {
        "apikey": key,
        "Authorization": "Bearer " + key,
    }
    if json_content:
        h["Content-Type"] = "application/json"
    return h


def request_json(method: str, url: str, key: str, payload: Any | None = None, extra_headers: dict[str, str] | None = None) -> Any:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = api_headers(key)
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
            return json.loads(body.decode("utf-8")) if body else None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise WorkerError(f"HTTP {e.code}: {body[:800]}") from e


def claim_job(base_url: str, key: str) -> dict[str, Any] | None:
    return request_json(
        "POST",
        base_url + "/rest/v1/rpc/claim_next_video_job",
        key,
        {"p_worker_id": WORKER_ID},
    )


def update_job(base_url: str, key: str, job_id: str, patch: dict[str, Any]) -> None:
    encoded = urllib.parse.quote(job_id, safe="")
    request_json(
        "PATCH",
        base_url + "/rest/v1/video_jobs?id=eq." + encoded,
        key,
        patch,
        {"Prefer": "return=minimal"},
    )


def upload_mp4(base_url: str, key: str, job_id: str, path: Path) -> str:
    object_path = urllib.parse.quote(job_id + ".mp4", safe="/")
    url = base_url + "/storage/v1/object/video-outputs/" + object_path
    data = path.read_bytes()
    headers = api_headers(key, json_content=False)
    headers["Content-Type"] = "video/mp4"
    headers["x-upsert"] = "true"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise WorkerError(f"Upload failed HTTP {e.code}: {body[:800]}") from e
    return base_url + "/storage/v1/object/public/video-outputs/" + object_path


def ffmpeg_paths() -> tuple[str, str]:
    ffmpeg = os.environ.get("SSMPD_FFMPEG", DEFAULT_FFMPEG)
    ffprobe = os.environ.get("SSMPD_FFPROBE", DEFAULT_FFPROBE)
    if not Path(ffmpeg).is_file():
        ffmpeg = shutil.which("ffmpeg") or ffmpeg
    if not Path(ffprobe).is_file():
        ffprobe = shutil.which("ffprobe") or ffprobe
    if not Path(ffmpeg).is_file():
        raise WorkerError("ffmpeg-full was not found.")
    if not Path(ffprobe).is_file():
        raise WorkerError("ffprobe was not found.")
    return ffmpeg, ffprobe


def arabic_voices() -> list[str]:
    say = shutil.which("say")
    if not say:
        return []
    p = run([say, "-v", "?"], check=False)
    voices: list[str] = []
    for raw in p.stdout.splitlines():
        parts = raw.split()
        lang_index = next((i for i, token in enumerate(parts) if token.startswith("ar_")), None)
        if lang_index is not None and lang_index > 0:
            voices.append(" ".join(parts[:lang_index]))
    return voices


def choose_voice() -> str:
    explicit = os.environ.get("SSMPD_TTS_VOICE", "").strip()
    if explicit:
        return explicit
    voices = arabic_voices()
    if not voices:
        raise WorkerError(
            "No Arabic macOS voice is installed. Install an Arabic System Voice, then rerun the worker."
        )
    return voices[0]


def synthesize(script: str, out_aiff: Path) -> str:
    say = shutil.which("say")
    if not say:
        raise WorkerError("macOS 'say' command was not found.")
    voice = choose_voice()
    script_file = out_aiff.with_suffix(".txt")
    script_file.write_text(script, encoding="utf-8")
    p = run([say, "-v", voice, "-f", str(script_file), "-o", str(out_aiff)], check=False)
    if p.returncode != 0 or not out_aiff.exists():
        raise WorkerError("TTS failed: " + (p.stderr.strip() or "unknown error"))
    return voice


def probe_duration(ffprobe: str, media: Path) -> float:
    p = run([
        ffprobe, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(media)
    ], check=False)
    try:
        return float(p.stdout.strip())
    except ValueError as e:
        raise WorkerError("Could not read audio duration.") from e


def ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


def ass_escape(text: str) -> str:
    return (
        (text or "")
        .replace("\\", r"\\")
        .replace("{", r"\{")
        .replace("}", r"\}")
        .replace("\n", r"\N")
    )


def split_script(text: str) -> list[str]:
    chunks = re.split(r"(?<=[.!؟!])\s+|[\r\n]+", text.strip())
    chunks = [c.strip() for c in chunks if c.strip()]
    if not chunks and text.strip():
        chunks = [text.strip()]
    return chunks


def write_ass(job: dict[str, Any], target_duration: float, spoken_duration: float, path: Path) -> None:
    title = ass_escape(str(job.get("title") or ""))
    cta = ass_escape(str(job.get("cta_text") or ""))
    parts = split_script(str(job.get("script_text") or ""))

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1080",
        "PlayResY: 1920",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        "Style: Title,Arial,64,&H00FFFFFF,&H000000FF,&H00132636,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,8,80,80,170,1",
        "Style: Body,Arial,58,&H00FFFFFF,&H000000FF,&H00132636,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,95,95,180,1",
        "Style: CTA,Arial,58,&H00FFFFFF,&H000000FF,&H00132636,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,95,95,190,1",
        "",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]

    if title:
        lines.append(f"Dialogue: 0,{ass_time(0)},{ass_time(min(3.2, target_duration))},Title,,0,0,0,,{title}")

    if parts:
        total_chars = max(1, sum(max(1, len(p)) for p in parts))
        cursor = 0.25
        end_limit = max(cursor + 0.5, min(spoken_duration, target_duration - 2.5))
        available = max(0.5, end_limit - cursor)
        for idx, part in enumerate(parts):
            weight = max(1, len(part)) / total_chars
            seg = max(1.2, available * weight)
            end = end_limit if idx == len(parts) - 1 else min(end_limit, cursor + seg)
            lines.append(
                f"Dialogue: 0,{ass_time(cursor)},{ass_time(end)},Body,,0,0,0,,{ass_escape(part)}"
            )
            cursor = end

    if cta:
        start = max(0.0, target_duration - 2.5)
        lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(target_duration)},CTA,,0,0,0,,{cta}")

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def atempo_chain(factor: float) -> str:
    factor = max(0.01, factor)
    parts: list[float] = []
    while factor > 2.0:
        parts.append(2.0)
        factor /= 2.0
    while factor < 0.5:
        parts.append(0.5)
        factor /= 0.5
    parts.append(factor)
    return ",".join(f"atempo={x:.6f}" for x in parts)


def filter_path(path: Path) -> str:
    s = str(path)
    return s.replace("\\", r"\\").replace(":", r"\:").replace("'", r"\'")


def render(job: dict[str, Any], job_dir: Path) -> tuple[Path, str]:
    ffmpeg, ffprobe = ffmpeg_paths()
    script = str(job.get("script_text") or "").strip()
    if not script:
        raise WorkerError("Job has no script.")

    min_s = int(job.get("duration_min_seconds") or 0)
    max_s = int(job.get("duration_max_seconds") or 0)
    if min_s <= 0 or max_s < min_s:
        raise WorkerError("Invalid video duration in job.")

    voice_aiff = job_dir / "voice.aiff"
    voice = synthesize(script, voice_aiff)
    audio_dur = probe_duration(ffprobe, voice_aiff)

    target = max(float(min_s), min(float(max_s), audio_dur + 2.5))
    voice_target = max(1.0, target - 2.5)
    speed = audio_dur / voice_target if audio_dur > voice_target else 1.0
    spoken_duration = audio_dur / speed

    ass = job_dir / "captions.ass"
    write_ass(job, target, spoken_duration, ass)

    out = job_dir / "output.mp4"
    ass_filter = "ass=filename='" + filter_path(ass) + "'"

    cmd = [
        ffmpeg, "-y",
        "-f", "lavfi",
        "-i", f"color=c=0x102A43:s=1080x1920:r=30:d={target:.3f}",
        "-i", str(voice_aiff),
    ]

    if speed > 1.0001:
        cmd += [
            "-filter_complex", f"[1:a]{atempo_chain(speed)}[a]",
            "-map", "0:v:0", "-map", "[a]",
        ]
    else:
        cmd += ["-map", "0:v:0", "-map", "1:a:0"]

    cmd += [
        "-vf", ass_filter,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "21",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-t", f"{target:.3f}",
        "-movflags", "+faststart",
        str(out),
    ]

    p = run(cmd, check=False)
    if p.returncode != 0 or not out.exists():
        raise WorkerError("FFmpeg render failed: " + p.stderr[-1500:])
    return out, voice


def process_job(base_url: str, key: str, job: dict[str, Any]) -> None:
    job_id = str(job["id"])
    job_dir = WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        update_job(base_url, key, job_id, {"status": "rendering"})
        output, voice = render(job, job_dir)
        update_job(base_url, key, job_id, {"status": "uploading"})
        public_url = upload_mp4(base_url, key, job_id, output)
        update_job(
            base_url,
            key,
            job_id,
            {
                "status": "ready",
                "output_video_url": public_url,
                "error_message": None,
                "render_finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        )
        print(f"READY {job_id} | voice={voice} | {public_url}", flush=True)
    except Exception as e:
        msg = str(e)[:1800]
        try:
            update_job(
                base_url,
                key,
                job_id,
                {
                    "status": "failed",
                    "error_message": msg,
                    "render_finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            )
        except Exception:
            pass
        raise


def check_environment() -> int:
    print("SSMPD Video Worker check")
    ok = True
    try:
        url, key = config()
        print("Supabase config: OK")
        print("Project:", urllib.parse.urlparse(url).netloc)
        print("service_role key: configured")
        _ = key
    except Exception as e:
        ok = False
        print("Supabase config: FAIL -", e)

    try:
        ffmpeg, ffprobe = ffmpeg_paths()
        print("FFmpeg:", ffmpeg)
        print("FFprobe:", ffprobe)
    except Exception as e:
        ok = False
        print("FFmpeg: FAIL -", e)

    voices = arabic_voices()
    if voices:
        print("Arabic macOS voices:", ", ".join(voices))
    else:
        ok = False
        print("Arabic macOS voices: NONE")

    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if args.check:
        return check_environment()

    base_url, key = config()
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    print("SSMPD Video Worker started:", WORKER_ID, flush=True)

    while True:
        job = claim_job(base_url, key)
        if job:
            print("CLAIMED", job.get("id"), job.get("title", ""), flush=True)
            try:
                process_job(base_url, key, job)
            except Exception as e:
                print("FAILED", job.get("id"), str(e), file=sys.stderr, flush=True)
            if args.once:
                return 0
        elif args.once:
            print("No pending video jobs.")
            return 0

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
