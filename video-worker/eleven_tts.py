"""ElevenLabs TTS. Credentials remain in the current Mac user's Keychain."""
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

VOICE_ID = "VXERCtS1keFWRMOi7czu"
MODEL_ID = "eleven_multilingual_v2"
VOICE_SETTINGS = {
    "speed": 1.0, "stability": 0.5, "similarity_boost": 0.75,
    "style": 0.0, "use_speaker_boost": True,
}


class ElevenTTSError(RuntimeError):
    pass


def config():
    key = os.environ.get("SSMPD_ELEVENLABS_API_KEY", "").strip()
    if not key and sys.platform == "darwin":
        result = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-s",
             "SSMPD_ELEVENLABS_API_KEY", "-a", getpass.getuser(), "-w"],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            key = result.stdout.strip()
        elif result.returncode != 44:  # errSecItemNotFound; other failures must not switch voice
            raise ElevenTTSError("تعذر قراءة مفتاح ElevenLabs من Keychain. اسمح بالوصول ثم أعد المحاولة.")
    voice = os.environ.get("SSMPD_ELEVENLABS_VOICE_ID", VOICE_ID).strip()
    if not re.fullmatch(r"[A-Za-z0-9]{20}", voice):
        raise ElevenTTSError("معرّف صوت ElevenLabs غير صالح.")
    return key, voice


def synthesize(script: str, output: Path, key: str, voice: str):
    if not key:
        raise ElevenTTSError("مفتاح ElevenLabs غير محفوظ في Keychain.")
    if not re.fullmatch(r"[A-Za-z0-9]{20}", voice):
        raise ElevenTTSError("معرّف صوت ElevenLabs غير صالح.")
    if not script.strip():
        raise ElevenTTSError("نص التعليق الصوتي فارغ.")
    # One request for the whole script, preserving its wording and punctuation.
    request = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
        data=json.dumps({"text": script, "model_id": MODEL_ID,
                         "voice_settings": VOICE_SETTINGS}, ensure_ascii=False).encode("utf-8"),
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            content_type = response.headers.get("Content-Type", "").split(";")[0].lower()
            audio = response.read()
    except urllib.error.HTTPError as error:
        # Do not expose response bodies or request headers in the dashboard/job log.
        reasons = {401: "راجع المفتاح وصلاحية Text to Speech.",
                   403: "راجع صلاحية المفتاح وإتاحة الصوت في حسابك.",
                   429: "راجع الرصيد وحدود الاستخدام ثم أعد المحاولة لاحقًا."}
        raise ElevenTTSError(f"ElevenLabs HTTP {error.code}. " + reasons.get(error.code, "تعذر توليد الصوت. أعد المحاولة لاحقًا.")) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ElevenTTSError("تعذر الاتصال بـ ElevenLabs. تحقق من الإنترنت ثم أعد المحاولة.") from None
    if content_type not in ("audio/mpeg", "audio/mp3", "application/octet-stream") or not audio:
        raise ElevenTTSError("ElevenLabs لم يرجع ملف صوت صالحًا.")
    # Reject JSON/error pages even if the server labels them as binary.
    if not (audio.startswith(b"ID3") or (len(audio) > 1 and audio[0] == 255 and audio[1] & 224 == 224)):
        raise ElevenTTSError("ElevenLabs لم يرجع ملف MP3 صالحًا.")
    temporary = output.with_suffix(".mp3.part")
    try:
        temporary.write_bytes(audio)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return voice
