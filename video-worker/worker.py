#!/usr/bin/env python3
# SSMPD Mac Video Worker — stdlib-only worker for Supabase + FFmpeg.
# Secrets are read from macOS Keychain; nothing secret is stored in this repo.

from __future__ import annotations

import argparse
from drive_archive import upload as archive_upload
from brand_identity import logo_asset
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

KEYCHAIN_SERVICE = "SSMPD Video Worker"
KEYCHAIN_URL_ACCOUNT = "supabase_url"
KEYCHAIN_KEY_ACCOUNT = "service_role_key"
KEYCHAIN_AZURE_TTS_KEY_ACCOUNT = "azure_speech_key"
KEYCHAIN_AZURE_TTS_REGION_ACCOUNT = "azure_speech_region"
KEYCHAIN_AZURE_TTS_VOICE_ACCOUNT = "azure_speech_voice"
KEYCHAIN_MEDIA_ROOT_ACCOUNT = "media_root"

DEFAULT_FFMPEG = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
DEFAULT_FFPROBE = "/opt/homebrew/opt/ffmpeg-full/bin/ffprobe"
POLL_SECONDS = int(os.environ.get("SSMPD_VIDEO_POLL_SECONDS", "10"))
WORK_ROOT = Path(os.environ.get("SSMPD_VIDEO_WORK_ROOT", str(Path.home() / "SSMPDVideoWorker" / "jobs")))
WORKER_ID = os.environ.get("SSMPD_VIDEO_WORKER_ID", socket.gethostname())

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}

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


def azure_tts_config() -> tuple[str, str, str]:
    key = os.environ.get("SSMPD_AZURE_SPEECH_KEY", "").strip() or keychain_get(KEYCHAIN_AZURE_TTS_KEY_ACCOUNT)
    region = os.environ.get("SSMPD_AZURE_SPEECH_REGION", "").strip() or keychain_get(KEYCHAIN_AZURE_TTS_REGION_ACCOUNT)
    voice = (
        os.environ.get("SSMPD_AZURE_TTS_VOICE", "").strip()
        or keychain_get(KEYCHAIN_AZURE_TTS_VOICE_ACCOUNT)
        or "ar-EG-SalmaNeural"
    )
    if bool(key) != bool(region):
        raise WorkerError("Azure Speech key and region must both be configured.")
    return key, region, voice


def media_root() -> Path:
    configured = os.environ.get("SSMPD_MEDIA_ROOT", "").strip() or keychain_get(KEYCHAIN_MEDIA_ROOT_ACCOUNT)
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "SSMPDVideoWorker" / "Media Library"


def media_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    files: list[Path] = []
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS.union(VIDEO_EXTENSIONS):
            files.append(path)
    return sorted(files, key=lambda p: str(p).lower())


def media_keywords(job: dict[str, Any]) -> list[str]:
    specialty = str(job.get("specialty") or "").lower()
    script = str(job.get("script_text") or "").lower()
    joined = specialty + " " + script
    words = ["medical", "doctor", "clinic", "health"]
    if any(x in joined for x in ["مخ", "أعصاب", "اعصاب", "صداع", "brain", "neuro", "headache"]):
        words += ["neurology", "brain", "head", "headache", "neuro", "صداع", "مخ", "اعصاب", "أعصاب"]
    return words


def discover_media_assets(job: dict[str, Any]) -> list[Path]:
    mode = str(job.get("media_mode") or "uploaded_plus_auto")
    uploaded = uploaded_asset_paths(job, "image") + uploaded_asset_paths(job, "video")
    if uploaded:
        return uploaded
    if mode == "uploaded_only":
        return []

    root = media_root()
    files = media_files(root)
    if not files:
        return []

    keywords = media_keywords(job)

    def score(path: Path) -> tuple[int, str]:
        p = str(path).lower()
        hits = sum(1 for kw in keywords if kw.lower() in p)
        return (-hits, p)

    return sorted(files, key=score)


def api_headers(key: str, *, json_content: bool = True) -> dict[str, str]:
    # New Supabase Secret API keys (sb_secret_...) are opaque, not JWTs.
    # Send them in the apikey header only. Legacy service_role JWTs still
    # receive Authorization: Bearer for backward compatibility.
    h = {"apikey": key}
    if key.startswith("eyJ"):
        h["Authorization"] = "Bearer " + key
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


def download_job_assets(base_url: str, key: str, job: dict[str, Any], job_dir: Path) -> list[dict[str, Any]]:
    raw_assets = job.get("input_assets") or []
    if not isinstance(raw_assets, list) or not raw_assets:
        return []

    target_dir = job_dir / "input-assets"
    target_dir.mkdir(parents=True, exist_ok=True)
    downloaded: list[dict[str, Any]] = []

    for idx, asset in enumerate(raw_assets):
        if not isinstance(asset, dict):
            continue
        storage_path = str(asset.get("storage_path") or "").strip()
        file_name = str(asset.get("file_name") or ("asset-" + str(idx))).strip()
        if not storage_path:
            continue

        ext = Path(file_name).suffix
        local_path = target_dir / (f"{idx:02d}-" + re.sub(r"[^A-Za-z0-9._-]+", "-", file_name))
        if ext and local_path.suffix.lower() != ext.lower():
            local_path = local_path.with_suffix(ext)

        bucket = "video-inputs"
        if asset.get("asset_type") == "brand_logo":
            logo_asset(job)
            bucket = "brand-logos"
        url = base_url + "/storage/v1/object/" + bucket + "/" + urllib.parse.quote(storage_path, safe="/")
        req = urllib.request.Request(url, headers=api_headers(key, json_content=False), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                local_path.write_bytes(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            raise WorkerError(f"Input asset download failed HTTP {e.code}: {body[:800]}") from e

        copied = dict(asset)
        copied["local_path"] = str(local_path)
        downloaded.append(copied)

    return downloaded


def uploaded_asset_paths(job: dict[str, Any], asset_type: str) -> list[Path]:
    mode = str(job.get("media_mode") or "uploaded_plus_auto")
    if mode == "auto":
        return []
    assets = job.get("_downloaded_assets") or []
    out: list[Path] = []
    for asset in assets:
        if isinstance(asset, dict) and asset.get("id") == (job.get("cover_settings") or {}).get("logo_asset_id"):
            continue
        if isinstance(asset, dict) and asset.get("asset_type") == asset_type and asset.get("local_path"):
            p = Path(str(asset["local_path"]))
            if p.exists():
                out.append(p)
    return out


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


def azure_synthesize(script: str, out_mp3: Path, key: str, region: str, voice: str) -> str:
    import html

    ssml = (
        '<speak version="1.0" xml:lang="ar-EG">'
        f'<voice name="{html.escape(voice, quote=True)}">'
        '<prosody rate="-4%">'
        f'{html.escape(script)}'
        '</prosody>'
        '</voice>'
        '</speak>'
    ).encode("utf-8")

    endpoint = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    req = urllib.request.Request(
        endpoint,
        data=ssml,
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
            "User-Agent": "SSMPDVideoWorker",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            audio = resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise WorkerError(f"Azure TTS failed HTTP {e.code}: {body[:800]}") from e

    if not audio:
        raise WorkerError("Azure TTS returned empty audio.")
    out_mp3.write_bytes(audio)
    return voice


def macos_synthesize(script: str, out_aiff: Path) -> str:
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


def synthesize(script: str, job_dir: Path, job: dict[str, Any]) -> tuple[Path, str]:
    uploaded_voice = uploaded_asset_paths(job, "voiceover")
    if uploaded_voice:
        return uploaded_voice[0], "Uploaded voiceover"

    azure_key, azure_region, azure_voice = azure_tts_config()
    if azure_key and azure_region:
        out_mp3 = job_dir / "voice.mp3"
        voice = azure_synthesize(script, out_mp3, azure_key, azure_region, azure_voice)
        return out_mp3, "Azure " + voice

    out_aiff = job_dir / "voice.aiff"
    voice = macos_synthesize(script, out_aiff)
    return out_aiff, "macOS " + voice

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


def render_visual_background(ffmpeg: str, job: dict[str, Any], job_dir: Path, target: float) -> Path | None:
    assets = discover_media_assets(job)
    if not assets:
        return None

    scene_count = max(3, min(7, int(round(target / 4.5))))
    overlap = 0.35
    scene_duration = (target + overlap * (scene_count - 1)) / scene_count
    selected = [assets[i % len(assets)] for i in range(scene_count)]
    scene_paths: list[Path] = []

    for idx, asset in enumerate(selected):
        scene = job_dir / f"scene-{idx:02d}.mp4"
        ext = asset.suffix.lower()
        common_vf = (
            "scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,fps=30,format=yuv420p"
        )

        if ext in IMAGE_EXTENSIONS:
            vf = (
                "scale=1080:1920:force_original_aspect_ratio=increase,"
                "crop=1080:1920,"
                "zoompan=z='min(zoom+0.0007,1.06)':d=1:s=1080x1920:fps=30,"
                "format=yuv420p"
            )
            cmd = [
                ffmpeg, "-y", "-loop", "1", "-t", f"{scene_duration:.3f}",
                "-i", str(asset), "-vf", vf, "-an",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-pix_fmt", "yuv420p", str(scene),
            ]
        else:
            cmd = [
                ffmpeg, "-y", "-stream_loop", "-1", "-i", str(asset),
                "-t", f"{scene_duration:.3f}", "-vf", common_vf, "-an",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-pix_fmt", "yuv420p", str(scene),
            ]

        p = run(cmd, check=False)
        if p.returncode != 0 or not scene.exists():
            raise WorkerError("Scene render failed for " + asset.name + ": " + p.stderr[-1200:])
        scene_paths.append(scene)

    if len(scene_paths) == 1:
        return scene_paths[0]

    background = job_dir / "background.mp4"
    cmd: list[str] = [ffmpeg, "-y"]
    for scene in scene_paths:
        cmd += ["-i", str(scene)]

    filters: list[str] = []
    previous = "0:v"
    for idx in range(1, len(scene_paths)):
        out_label = f"vx{idx}"
        offset = idx * (scene_duration - overlap)
        filters.append(
            f"[{previous}][{idx}:v]xfade=transition=fade:duration={overlap:.3f}:offset={offset:.3f}[{out_label}]"
        )
        previous = out_label

    cmd += [
        "-filter_complex", ";".join(filters),
        "-map", f"[{previous}]",
        "-an", "-t", f"{target:.3f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p", str(background),
    ]

    p = run(cmd, check=False)
    if p.returncode != 0 or not background.exists():
        raise WorkerError("Visual background render failed: " + p.stderr[-1500:])
    return background


def render(job: dict[str, Any], job_dir: Path) -> tuple[Path, str]:
    ffmpeg, ffprobe = ffmpeg_paths()
    script = str(job.get("script_text") or "").strip()
    if not script:
        raise WorkerError("Job has no script.")

    min_s = int(job.get("duration_min_seconds") or 0)
    max_s = int(job.get("duration_max_seconds") or 0)
    if min_s <= 0 or max_s < min_s:
        raise WorkerError("Invalid video duration in job.")

    voice_path, voice = synthesize(script, job_dir, job)
    audio_dur = probe_duration(ffprobe, voice_path)

    target = max(float(min_s), min(float(max_s), audio_dur + 2.5))
    voice_target = max(1.0, target - 2.5)
    speed = audio_dur / voice_target if audio_dur > voice_target else 1.0
    spoken_duration = audio_dur / speed

    ass = job_dir / "captions.ass"
    write_ass(job, target, spoken_duration, ass)

    music_assets = uploaded_asset_paths(job, "music")
    out = job_dir / "output.mp4"
    base_out = job_dir / ("output-base.mp4" if music_assets else "output.mp4")
    ass_filter = "ass=filename='" + filter_path(ass) + "'"

    visual_background = render_visual_background(ffmpeg, job, job_dir, target)
    if visual_background:
        cmd = [ffmpeg, "-y", "-i", str(visual_background), "-i", str(voice_path)]
    else:
        cmd = [
            ffmpeg, "-y",
            "-f", "lavfi",
            "-i", f"color=c=0x102A43:s=1080x1920:r=30:d={target:.3f}",
            "-i", str(voice_path),
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
        str(base_out),
    ]

    p = run(cmd, check=False)
    if p.returncode != 0 or not base_out.exists():
        raise WorkerError("FFmpeg render failed: " + p.stderr[-1500:])

    if music_assets:
        music = music_assets[0]
        mix_cmd = [
            ffmpeg, "-y",
            "-i", str(base_out),
            "-stream_loop", "-1", "-i", str(music),
            "-filter_complex",
            f"[1:a]volume=0.10,atrim=0:{target:.3f}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]",
            "-map", "0:v:0", "-map", "[a]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-t", f"{target:.3f}", "-movflags", "+faststart",
            str(out),
        ]
        mp = run(mix_cmd, check=False)
        if mp.returncode != 0 or not out.exists():
            raise WorkerError("Music mix failed: " + mp.stderr[-1500:])

    return out, voice


def process_job(base_url: str, key: str, job: dict[str, Any]) -> None:
    job_id = str(job["id"])
    job_dir = WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        logo_asset(job)
        job["_downloaded_assets"] = download_job_assets(base_url, key, job, job_dir)
        update_job(base_url, key, job_id, {"status": "rendering"})
        output, voice = render(job, job_dir)
        archive_rendered_job(base_url, key, job, output)
        print(f"READY {job_id} | voice={voice} | Google Drive", flush=True)
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


def archive_rendered_job(base_url: str, key: str, job: dict[str, Any], output: Path) -> None:
    job_id = str(job["id"])
    update_job(base_url, key, job_id, {"status": "uploading", "archive_status": "uploading"})
    try:
        ffmpeg, ffprobe = ffmpeg_paths()
        if probe_duration(ffprobe, output) <= 0:
            raise WorkerError("Rendered output is missing or invalid.")
        cover = output.parent / "cover.jpg"
        if not cover.exists():
            run([ffmpeg, "-y", "-ss", "0", "-i", str(output), "-frames:v", "1", "-q:v", "2", str(cover)])
        video = archive_upload(job, output, "video")
        from cover_candidates import build as build_covers
        candidates = build_covers(job, output, ffmpeg, probe_duration(ffprobe, output))
        thumbnail = archive_upload(job, cover, "cover") if not candidates else None
        for candidate in candidates:
            archived = archive_upload(job, candidate["path"], "cover_" + str(candidate["index"]))
            storage_path = upload_cover_preview(base_url, key, job, candidate)
            request_json("POST", base_url + "/rest/v1/video_cover_candidates?on_conflict=job_id,candidate_index", key, {
                "id": str(uuid.uuid5(uuid.UUID(job_id), "cover-" + str(candidate["index"]))),
                "job_id": job_id, "candidate_index": candidate["index"],
                "timestamp_seconds": candidate["timestamp_seconds"], "storage_path": storage_path,
                "drive_url": archived["fileUrl"],
            }, {"Prefer": "resolution=merge-duplicates,return=minimal"})
            if thumbnail is None:
                thumbnail = archived
        # The archive is primary. Direct publishing copies are explicitly opt-in.
        staged = None
        if os.environ.get("SSMPD_VIDEO_STAGE_OUTPUT") == "1":
            staged = upload_mp4(base_url, key, job_id, output)
        update_job(base_url, key, job_id, {
            "status": "ready", "archive_status": "archived", "archive_error": None,
            "drive_video_url": video["fileUrl"], "drive_video_id": video["fileId"],
            "drive_folder_url": video["folderUrl"],
            "cover_url": job.get("cover_url") if job.get("selected_cover_id") else thumbnail["fileUrl"],
            "output_video_url": staged, "error_message": None,
            "archived_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "render_finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })
    except Exception as e:
        update_job(base_url, key, job_id, {
            "status": "failed", "archive_status": "failed", "archive_error": str(e)[:1000],
            "error_message": "Render retained locally. Retry archive without rendering: " + str(e)[:1000],
        })
        raise


def upload_cover_preview(base_url, key, job, candidate):
    storage_path = f'{job["created_by"]}/{job["content_id"]}/covers/{job["id"]}/{candidate["index"]}.jpg'
    headers = api_headers(key, json_content=False)
    headers.update({"Content-Type": "image/jpeg", "x-upsert": "true"})
    req = urllib.request.Request(base_url + "/storage/v1/object/video-inputs/" + storage_path,
                                 data=candidate["path"].read_bytes(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as response:
        response.read()
    return storage_path


def retry_archive(base_url: str, key: str, job_id: str) -> None:
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", job_id):
        raise WorkerError("Invalid job ID.")
    rows = request_json("GET", base_url + "/rest/v1/video_jobs?id=eq." + job_id + "&select=*", key)
    if not rows or rows[0].get("status") not in ("failed", "ready"):
        raise WorkerError("Archive retry requires a failed or ready job.")
    job = rows[0]
    job["_downloaded_assets"] = download_job_assets(base_url, key, job, WORK_ROOT / job_id)
    archive_rendered_job(base_url, key, job, WORK_ROOT / job_id / "output.mp4")
    print("ARCHIVED", job_id)


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

    try:
        azure_key, azure_region, azure_voice = azure_tts_config()
        if azure_key and azure_region:
            print("Azure TTS: configured")
            print("Azure region:", azure_region)
            print("Azure voice:", azure_voice)
        else:
            voices = arabic_voices()
            if voices:
                print("Azure TTS: not configured — macOS fallback:", ", ".join(voices))
            else:
                ok = False
                print("Azure TTS: not configured and no Arabic macOS fallback voice found")
    except Exception as e:
        ok = False
        print("Azure TTS: FAIL -", e)

    root = media_root()
    print("Media library:", root)
    print("Visual assets found:", len(media_files(root)))

    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--retry-archive", metavar="JOB_ID")
    args = parser.parse_args()

    if args.check:
        return check_environment()

    base_url, key = config()
    if args.retry_archive:
        retry_archive(base_url, key, args.retry_archive)
        return 0
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
