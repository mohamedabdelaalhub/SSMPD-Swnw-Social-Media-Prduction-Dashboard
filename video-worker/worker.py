#!/usr/bin/env python3
# SSMPD Mac Video Worker — stdlib-only worker for Supabase + FFmpeg.
# Secrets are read from macOS Keychain; nothing secret is stored in this repo.

from __future__ import annotations

import argparse
import eleven_tts
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
HEARTBEAT_SECONDS = 60
CLEANUP_INTERVAL_SECONDS = 6 * 60 * 60
SUCCESSFUL_JOB_RETENTION_DAYS = 7
FAILED_JOB_RETENTION_DAYS = 14

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".wav", ".aif", ".aiff"}

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


def brand_template_dir(job: dict[str, Any]) -> Path:
    brand_folder = "Dina" if str(job.get("brand") or "") == "dr_dina" else "Swnw"
    return media_root() / "Brand Templates" / brand_folder


def brand_template_asset(job: dict[str, Any], file_name: str) -> Path | None:
    path = brand_template_dir(job) / file_name
    return path if path.is_file() else None


def brand_contact_slide(job: dict[str, Any]) -> Path | None:
    file_name = "شريحة التواصل Dina.jpg" if str(job.get("brand") or "") == "dr_dina" else "شريحة التواصل Swnw.jpg"
    return brand_template_asset(job, file_name)


def brand_outro(job: dict[str, Any]) -> Path | None:
    file_name = "Dina Outro.mp4" if str(job.get("brand") or "") == "dr_dina" else "Swnw Outro.mp4"
    return brand_template_asset(job, file_name)


def music_mood(job: dict[str, Any]) -> str:
    """Normalize the optional dashboard choice for the brand music mood."""
    settings = job.get("cover_settings") or {}
    value = str(job.get("music_mood") or settings.get("music_mood") or "").strip().lower()
    if value in ("calm", "هادئ", "هادي", "هادئه", "quiet", "soft"):
        return "calm"
    if value in ("upbeat", "energetic", "حماسي", "حماسى", "حماس"):
        return "upbeat"
    if value in ("serious", "formal", "جاد", "رسمى"):
        return "serious"
    return "calm"


def branded_music_assets(job: dict[str, Any]) -> list[Path]:
    """Read the three approved tracks placed beside each brand's templates."""
    root = brand_template_dir(job)
    folders = (
        "Music Tracks",
        "Dina Music Tracks",
        "Swnw Music Tracks",
    )
    found: list[Path] = []
    seen: set[Path] = set()
    for folder in folders:
        path = root / folder
        if not path.is_dir():
            continue
        for item in sorted(path.rglob("*"), key=lambda p: str(p).lower()):
            if item.is_file() and item.suffix.lower() in AUDIO_EXTENSIONS and item not in seen:
                found.append(item)
                seen.add(item)
    return found


def default_music_asset(job: dict[str, Any]) -> Path | None:
    assets = branded_music_assets(job)
    mood = music_mood(job)
    terms = {
        "calm": ("calm", "هادئ", "هادي", "soft", "quiet"),
        "upbeat": ("upbeat", "energetic", "حماسي", "حماسى", "حماس"),
        "serious": ("serious", "formal", "جاد", "documentary"),
    }[mood]
    for asset in assets:
        name = asset.name.lower()
        if any(term in name for term in terms):
            return asset

    # If a filename was not labelled, keep rendering with the first approved track.
    if assets:
        return assets[0]

    root = media_root() / "Brand Templates"
    for file_name in ("Background Music.mp3", "Background Music.m4a", "Background Music.wav"):
        path = root / file_name
        if path.is_file():
            return path
    return None


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
    # A clear stage bar in the dashboard. Percentages reflect completed steps,
    # never a fake estimate of remaining FFmpeg time.
    status = patch.get("status")
    if status and "progress_percent" not in patch:
        progress = {
            "pending": (0, "في الانتظار"),
            "preparing": (15, "تجهيز الملفات"),
            "rendering": (55, "إنتاج الفيديو والصوت"),
            "uploading": (85, "حفظ الفيديو والأغلفة"),
            "ready": (100, "اكتمل"),
            "failed": (0, "تحتاج مراجعة"),
            "cancelled": (0, "أُلغيت"),
        }.get(str(status))
        if progress:
            patch = dict(patch)
            patch["progress_percent"] = progress[0]
            patch["progress_stage"] = progress[1]

    encoded = urllib.parse.quote(job_id, safe="")
    request_json(
        "PATCH",
        base_url + "/rest/v1/video_jobs?id=eq." + encoded,
        key,
        patch,
        {"Prefer": "return=minimal"},
    )


def heartbeat(base_url: str, key: str, status: str, job_id: str | None = None) -> None:
    """Record that the local worker is alive without exposing device paths or secrets."""
    try:
        request_json(
            "POST",
            base_url + "/rest/v1/rpc/video_worker_heartbeat",
            key,
            {
                "p_worker_id": WORKER_ID,
                "p_status": status,
                "p_current_job_id": job_id,
            },
        )
    except Exception:
        # A status widget must never stop video production.
        pass


def safe_error_message(error: Exception | str, limit: int = 1800) -> str:
    """Keep dashboard errors useful while hiding local user and job paths."""
    text = str(error).replace("\\", "/")
    text = re.sub(r"/Users/[^/\s]+", "~", text)
    text = re.sub(r"/home/[^/\s]+", "~", text)
    text = re.sub(r"~/(?:SSMPDVideoWorker|Downloads|Desktop|Documents)(?:/[^\s]*)?", "~", text)
    return text[:limit]


def cleanup_old_job_dirs(base_url: str, key: str) -> int:
    """Remove only completed local job folders after their retention window."""
    now = time.time()
    cutoffs = {
        "ready": now - SUCCESSFUL_JOB_RETENTION_DAYS * 86400,
        "cancelled": now - SUCCESSFUL_JOB_RETENTION_DAYS * 86400,
        "failed": now - FAILED_JOB_RETENTION_DAYS * 86400,
    }
    removed = 0
    for status, cutoff in cutoffs.items():
        cutoff_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(cutoff))
        try:
            rows = request_json(
                "GET",
                base_url + "/rest/v1/video_jobs?select=id,status,updated_at"
                + "&status=eq." + status
                + "&updated_at=lt." + urllib.parse.quote(cutoff_iso, safe=":"),
                key,
            ) or []
        except Exception:
            continue
        for row in rows:
            job_id = str(row.get("id") or "")
            if not re.fullmatch(r"[0-9a-fA-F-]{36}", job_id):
                continue
            job_dir = WORK_ROOT / job_id
            if job_dir.parent != WORK_ROOT or not job_dir.is_dir():
                continue
            shutil.rmtree(job_dir, ignore_errors=True)
            removed += 1
    return removed


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
        # Auto mode ignores content uploads, but still needs the saved brand logo.
        if job.get("media_mode") == "auto" and asset.get("asset_type") != "brand_logo":
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


def spoken_script(script: str) -> str:
    """Keep published copy intact while guiding Egyptian Arabic pronunciation."""
    return (
        script
        .replace("د. دينا حسني", "الدكتورة دينا حُسْني")
        .replace("د.دينا حسني", "الدكتورة دينا حُسْني")
        .replace("دينا حسني", "دينا حُسْني")
        .replace("ابعتلنا", "ابعَت لنا")
    )


def synthesize(script: str, job_dir: Path, job: dict[str, Any]) -> tuple[Path, str]:
    uploaded_voice = uploaded_asset_paths(job, "voiceover")
    if uploaded_voice:
        return uploaded_voice[0], "Uploaded voiceover"

    spoken = spoken_script(script)
    eleven_key, eleven_voice = eleven_tts.config()
    if eleven_key:
        out_mp3 = job_dir / "voice.mp3"
        voice = eleven_tts.synthesize(spoken, out_mp3, eleven_key, eleven_voice)
        return out_mp3, "ElevenLabs " + voice

    azure_key, azure_region, azure_voice = azure_tts_config()
    if azure_key and azure_region:
        out_mp3 = job_dir / "voice.mp3"
        voice = azure_synthesize(spoken, out_mp3, azure_key, azure_region, azure_voice)
        return out_mp3, "Azure " + voice

    out_aiff = job_dir / "voice.aiff"
    voice = macos_synthesize(spoken, out_aiff)
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


def short_caption_chunks(text: str, words_per_caption: int = 5) -> list[str]:
    """Keep Arabic captions short, readable, and free of trailing punctuation."""
    out: list[str] = []

    def clean(word: str) -> str:
        return re.sub(r"[،,.!؟؛:]+", "", word).strip()

    for sentence in split_script(text):
        words = sentence.split()
        units: list[tuple[str, int]] = []
        index = 0
        while index < len(words):
            word = words[index]
            if word in ("د.", "د", "دكتور") and index + 2 < len(words):
                name = " ".join(clean(part) for part in words[index + 1:index + 3] if clean(part))
                if name:
                    units.append(("دكتور " + name, 3))
                    index += 3
                    continue

            value = clean(word)
            if value:
                units.append((value, 1))
            index += 1

        current: list[str] = []
        word_count = 0
        for value, count in units:
            if current and word_count + count > words_per_caption:
                out.append(" ".join(current))
                current = []
                word_count = 0
            current.append(value)
            word_count += count
        if current:
            out.append(" ".join(current))
    return out


def brand_font(job: dict[str, Any]) -> str:
    settings = job.get("cover_settings") or {}
    configured = str(settings.get("font_family") or "").strip()
    if configured:
        return configured
    return "BigVestaArabicBeta"


def has_static_brand_ending(job: dict[str, Any]) -> bool:
    return bool(brand_contact_slide(job) and brand_outro(job))


def closing_card(job: dict[str, Any]) -> str:
    """Fallback ending used only until the supplied brand files are installed."""
    if has_static_brand_ending(job):
        return ""

    settings = job.get("cover_settings") or {}
    phone = str(settings.get("phone") or job.get("phone") or "").strip()
    whatsapp = str(settings.get("whatsapp") or job.get("whatsapp") or "").strip()
    if job.get("brand") == "dr_dina":
        phone = phone or "0236230005"
        whatsapp = whatsapp or "+201010686264"
    if phone and whatsapp:
        return "للتواصل والحجز\nاتصل بنا: " + phone + "\nواتساب: " + whatsapp

    return str(job.get("cta_text") or "").strip()


def write_ass(job: dict[str, Any], target_duration: float, spoken_duration: float, path: Path) -> None:
    parts = short_caption_chunks(str(job.get("script_text") or ""))
    cta = closing_card(job)
    font = brand_font(job)

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1080",
        "PlayResY: 1920",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        f"Style: Body,{font},46,&H00FFFFFF,&H000000FF,&H00132636,&H500E1F3A,1,0,0,0,100,100,0,0,3,18,0,2,110,110,340,1",
        f"Style: CTA,{font},42,&H00FFFFFF,&H000000FF,&H00132636,&H500E1F3A,1,0,0,0,100,100,0,0,3,18,0,2,100,100,300,1",
        "",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]

    if parts:
        total_words = max(1, sum(len(part.split()) for part in parts))
        cursor = 0.25
        cta_reserve = 2.8 if cta else 0.0
        end_limit = max(cursor + 0.5, min(spoken_duration, target_duration - cta_reserve))
        available = max(0.5, end_limit - cursor)
        for idx, part in enumerate(parts):
            weight = max(1, len(part.split())) / total_words
            seg = max(0.85, available * weight)
            end = end_limit if idx == len(parts) - 1 else min(end_limit, cursor + seg)
            lines.append(
                f"Dialogue: 0,{ass_time(cursor)},{ass_time(end)},Body,,0,0,0,,{ass_escape(part)}"
            )
            cursor = end

    if cta:
        start = max(0.0, target_duration - 2.7)
        lines.append(
            f"Dialogue: 1,{ass_time(start)},{ass_time(target_duration)},CTA,,0,0,0,,{ass_escape(cta)}"
        )

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


def append_brand_ending(ffmpeg: str, job: dict[str, Any], main_video: Path) -> Path:
    """Append the approved contact slide and animated outro without changing the spoken copy."""
    slide = brand_contact_slide(job)
    outro = brand_outro(job)
    if not slide or not outro:
        return main_video

    contact = main_video.parent / "brand-contact.mp4"
    contact_seconds = 3.2
    if not contact.exists():
        p = run([
            ffmpeg, "-y", "-loop", "1", "-t", f"{contact_seconds:.3f}", "-i", str(slide),
            "-f", "lavfi", "-t", f"{contact_seconds:.3f}",
            "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p",
            "-map", "0:v:0", "-map", "1:a:0", "-shortest",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(contact),
        ], check=False)
        if p.returncode != 0 or not contact.exists():
            raise WorkerError("Contact-slide render failed: " + p.stderr[-1200:])

    ended = main_video.parent / "output-with-brand-ending.mp4"
    p = run([
        ffmpeg, "-y", "-i", str(main_video), "-i", str(contact), "-i", str(outro),
        "-filter_complex",
        "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(ended),
    ], check=False)
    if p.returncode != 0 or not ended.exists():
        raise WorkerError("Brand ending render failed: " + p.stderr[-1500:])
    return ended


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
    fallback_cta_seconds = 0.0 if has_static_brand_ending(job) else 2.7
    target = max(float(min_s), min(float(max_s), audio_dur + fallback_cta_seconds))
    voice_target = max(1.0, target - fallback_cta_seconds)
    speed = audio_dur / voice_target if audio_dur > voice_target else 1.0
    spoken_duration = audio_dur / speed

    ass = job_dir / "captions.ass"
    write_ass(job, target, spoken_duration, ass)
    logo = Path(str(logo_asset(job, downloaded=True).get("local_path") or ""))
    if not logo.is_file():
        raise WorkerError("Saved brand logo could not be downloaded.")

    music_assets = uploaded_asset_paths(job, "music")
    music = music_assets[0] if music_assets else default_music_asset(job)
    out = job_dir / "output.mp4"
    captioned = job_dir / "output-captioned.mp4"
    visual_out = job_dir / "output-visual.mp4"
    ass_filter = "ass=filename='" + filter_path(ass) + "'"
    visual_background = render_visual_background(ffmpeg, job, job_dir, target)

    if visual_background:
        cmd = [ffmpeg, "-y", "-i", str(visual_background), "-i", str(voice_path)]
    else:
        cmd = [
            ffmpeg, "-y", "-f", "lavfi",
            "-i", f"color=c=0x102A43:s=1080x1920:r=30:d={target:.3f}",
            "-i", str(voice_path),
        ]

    if speed > 1.0001:
        cmd += ["-filter_complex", f"[1:a]{atempo_chain(speed)}[a]", "-map", "0:v:0", "-map", "[a]"]
    else:
        cmd += ["-map", "0:v:0", "-map", "1:a:0"]
    cmd += [
        "-vf", ass_filter, "-c:v", "libx264", "-preset", "medium", "-crf", "21",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        "-t", f"{target:.3f}", "-movflags", "+faststart", str(captioned),
    ]
    p = run(cmd, check=False)
    if p.returncode != 0 or not captioned.exists():
        raise WorkerError("FFmpeg caption render failed: " + p.stderr[-1500:])

    logo_graph = (
        "[1:v]scale=150:-1:force_original_aspect_ratio=decrease[logo];"
        "[0:v][logo]overlay=x=48:y=54:format=auto:eof_action=repeat[v]"
    )
    p = run([
        ffmpeg, "-y", "-i", str(captioned), "-i", str(logo),
        "-filter_complex", logo_graph, "-map", "[v]", "-map", "0:a:0",
        "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", str(visual_out),
    ], check=False)
    if p.returncode != 0 or not visual_out.exists():
        raise WorkerError("FFmpeg logo render failed: " + p.stderr[-1500:])

    main_duration = probe_duration(ffprobe, visual_out)
    video_with_ending = append_brand_ending(ffmpeg, job, visual_out)
    final_duration = probe_duration(ffprobe, video_with_ending)

    if music:
        music_fade_start = max(0.0, main_duration - 0.7)
        mix_cmd = [
            ffmpeg, "-y", "-i", str(video_with_ending), "-stream_loop", "-1", "-i", str(music),
            "-filter_complex",
            f"[1:a]volume=0.08,atrim=0:{main_duration:.3f},afade=t=out:st={music_fade_start:.3f}:d=0.7[m];"
            "[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]",
            "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-t", f"{final_duration:.3f}", "-movflags", "+faststart", str(out),
        ]
        mp = run(mix_cmd, check=False)
        if mp.returncode != 0 or not out.exists():
            raise WorkerError("Music mix failed: " + mp.stderr[-1500:])
    else:
        shutil.move(str(video_with_ending), str(out))

    return out, voice


def process_job(base_url: str, key: str, job: dict[str, Any]) -> None:
    job_id = str(job["id"])
    job_dir = WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")

    heartbeat(base_url, key, "working", job_id)
    try:
        logo_asset(job)
        job["_downloaded_assets"] = download_job_assets(base_url, key, job, job_dir)
        update_job(base_url, key, job_id, {"status": "rendering"})
        output, voice = render(job, job_dir)
        archive_rendered_job(base_url, key, job, output)
        heartbeat(base_url, key, "idle")
        print(f"READY {job_id} | voice={voice} | Google Drive", flush=True)
    except Exception as e:
        msg = safe_error_message(e)
        heartbeat(base_url, key, "error", job_id)
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
        from cover_candidates import build as build_covers
        candidates = build_covers(
            job, output, ffmpeg, probe_duration(ffprobe, output),
            template_dir=brand_template_dir(job),
        )
        # Build the local branded covers before the archive bridge is contacted.
        # This preserves previewable cover files even if Google Drive is unavailable.
        video = archive_upload(job, output, "video")
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
        message = safe_error_message(e, 1000)
        update_job(base_url, key, job_id, {
            "status": "failed", "archive_status": "failed", "archive_error": message,
            "error_message": "Render retained locally. Retry archive without rendering: " + message,
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


def rerender_preview(base_url: str, key: str, job_id: str) -> None:
    """Render an existing job locally without contacting the archive bridge."""
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", job_id):
        raise WorkerError("Invalid job ID.")
    rows = request_json("GET", base_url + "/rest/v1/video_jobs?id=eq." + job_id + "&select=*", key)
    if not rows:
        raise WorkerError("Video job was not found.")
    job = rows[0]
    job_dir = WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    job["_downloaded_assets"] = download_job_assets(base_url, key, job, job_dir)
    output, voice = render(job, job_dir)
    ffmpeg, ffprobe = ffmpeg_paths()
    from cover_candidates import build as build_covers
    candidates = build_covers(
        job, output, ffmpeg, probe_duration(ffprobe, output),
        template_dir=brand_template_dir(job),
    )
    print(
        f"RENDERED {job_id} | voice={voice} | local={output} | covers={len(candidates)}",
        flush=True,
    )


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
        eleven_key, eleven_voice = eleven_tts.config()
        if eleven_key:
            print("ElevenLabs TTS: configured (credentials present; API not tested)")
            print("Active TTS: ElevenLabs")
            print("ElevenLabs voice:", eleven_voice)
            print("ElevenLabs model:", eleven_tts.MODEL_ID)
        else:
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
                    print("No configured TTS or Arabic macOS voice found")
    except Exception as e:
        ok = False
        print("TTS: FAIL -", e)

    root = media_root()
    print("Media library:", root)
    print("Visual assets found:", len(media_files(root)))
    print("Brand endings:", "ready" if (root / "Brand Templates" / "Swnw").is_dir() and (root / "Brand Templates" / "Dina").is_dir() else "not installed")
    print("Default background music:", "configured" if default_music_asset({"brand": "swnw"}) else "not configured")
    print("Brand music tracks:", "Swnw=" + str(len(branded_music_assets({"brand": "swnw"}))) + ", Dina=" + str(len(branded_music_assets({"brand": "dr_dina"}))))

    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--test-voice", action="store_true", help="Test ElevenLabs without claiming a video job")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--retry-archive", metavar="JOB_ID")
    parser.add_argument("--rerender", metavar="JOB_ID", help="Render an existing job locally without archive upload")
    args = parser.parse_args()

    if args.check:
        return check_environment()

    if args.test_voice:
        import tempfile
        try:
            eleven_key, eleven_voice = eleven_tts.config()
            with tempfile.TemporaryDirectory(prefix="ssmpd-voice-") as folder:
                audio = Path(folder) / "preview.mp3"
                eleven_tts.synthesize("إحنا هنا عشان نسمعك ونفهم إيه اللي تاعبك، ونشرح لك كل خطوة بكلام مفهوم.", audio, eleven_key, eleven_voice)
                _, ffprobe = ffmpeg_paths()
                if probe_duration(ffprobe, audio) <= 0:
                    raise WorkerError("تعذر قراءة مدة الصوت.")
                print("تم توليد الصوت من ElevenLabs. جاري التشغيل.", flush=True)
                subprocess.run(["/usr/bin/afplay", str(audio)], check=True)
            print("اختبار الصوت اكتمل. لم يتم تشغيل أي مهمة فيديو.")
            return 0
        except Exception as error:
            print("اختبار الصوت لم يكتمل:", error)
            return 1

    base_url, key = config()
    if args.rerender:
        rerender_preview(base_url, key, args.rerender)
        return 0
    if args.retry_archive:
        retry_archive(base_url, key, args.retry_archive)
        return 0
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    print("SSMPD Video Worker started:", WORKER_ID, flush=True)
    last_heartbeat = 0.0
    last_cleanup = 0.0

    while True:
        now = time.time()
        if now - last_heartbeat >= HEARTBEAT_SECONDS:
            heartbeat(base_url, key, "idle")
            last_heartbeat = now
        if now - last_cleanup >= CLEANUP_INTERVAL_SECONDS:
            removed = cleanup_old_job_dirs(base_url, key)
            if removed:
                print("CLEANUP", removed, "old local job folders", flush=True)
            last_cleanup = now

        job = claim_job(base_url, key)
        if job:
            print("CLAIMED", job.get("id"), job.get("title", ""), flush=True)
            try:
                process_job(base_url, key, job)
            except Exception as e:
                print("FAILED", job.get("id"), safe_error_message(e), file=sys.stderr, flush=True)
            if args.once:
                return 0
        elif args.once:
            print("No pending video jobs.")
            return 0

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
