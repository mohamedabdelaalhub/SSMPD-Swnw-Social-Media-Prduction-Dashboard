"""Voice generation: one ElevenLabs request per character (all that character's lines), with character-level timing.
Falls back to an estimated timing (dry mode) when no key/quota or when asked."""
import json, os, subprocess, base64, tempfile, math

VOICES = {  # name -> ElevenLabs voice id (see docs/character-library/voices.json)
    "narrator": "VXERCtS1keFWRMOi7czu", "doctor_male": "DWMVT5WflKt0P8OPpIrY", "male_2": "LXrTqFIgiubkrMkwvOUr",
    "woman_1": "L10lEremDiJfPicq5CPh", "woman_2": "L10lEremDiJfPicq5CPh", "elder_man": "Jez3JdhBInQTvlAvDOWR"}
SETTINGS = {"stability": 0.5, "similarity_boost": 0.75, "style": 0, "speed": 1.0, "use_speaker_boost": True}

def quota():
    r = subprocess.run(["curl", "-s", "-m", "30", "https://api.elevenlabs.io/v1/user/subscription"], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout); return d["character_limit"] - d["character_count"]
    except Exception:
        return None

GATEWAY = os.environ.get("SWNW_GATEWAY", "https://api.swnwclinics.com/functions/v1/claude-automation")

def speak_gateway(voice, text, out_mp3):
    """Same result as speak(), through the gateway op=tts (needs ~/.swnw-run-token; used when the environment has no ElevenLabs secret).
    Needs the gateway version that accepts voice + timestamps (supabase/functions/claude-automation)."""
    try:
        tok = open(os.path.expanduser("~/.swnw-run-token")).read().strip()
        body = json.dumps({"text": text, "voice": voice if voice in VOICES else "narrator", "timestamps": True}, ensure_ascii=False)
        r = subprocess.run(["curl", "-s", "-m", "180", "-A", "claude-task", "-X", "POST", GATEWAY + "?op=tts", "-H", "X-Run-Token: " + tok,
                            "-H", "Content-Type: application/json", "--data-binary", body], capture_output=True, text=True)
        d = json.loads(r.stdout)
        if not d.get("ok") or not d.get("alignment"): return None
        open(out_mp3, "wb").write(base64.b64decode(d["audio_base64"]))
        a = d["alignment"]; st, en = a["start"], a["end"]
        if len(st) != len(text) and len(st) > 1:  # the gateway applied its pronunciation list: map back onto the original text by position
            import numpy as _np
            xs = _np.linspace(0, len(st) - 1, len(text))
            st = list(_np.interp(xs, range(len(st)), st)); en = list(_np.interp(xs, range(len(en)), en))
        return dict(chars=list(text), start=st, end=en)
    except Exception:
        return None

def speak(voice, text, out_mp3):
    """returns dict(chars=[...], start=[...], end=[...]) or None on failure (then caller must use estimates).
    Direct ElevenLabs first (secret injected by the proxy); if that fails, the gateway."""
    r = speak_direct(voice, text, out_mp3)
    return r if r else speak_gateway(voice, text, out_mp3)

def speak_direct(voice, text, out_mp3):
    vid = VOICES.get(voice, voice)
    body = json.dumps({"text": text, "model_id": "eleven_multilingual_v2", "voice_settings": SETTINGS}, ensure_ascii=False)
    r = subprocess.run(["curl", "-s", "-m", "180", "-X", "POST", f"https://api.elevenlabs.io/v1/text-to-speech/{vid}/with-timestamps?output_format=mp3_44100_128",
                        "-H", "Content-Type: application/json", "--data-binary", body], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
        open(out_mp3, "wb").write(base64.b64decode(d["audio_base64"]))
        a = d.get("alignment") or d.get("normalized_alignment")
        return dict(chars=a["characters"], start=a["character_start_times_seconds"], end=a["character_end_times_seconds"])
    except Exception as e:
        return None

def estimate(text):
    """dry timing: ~0.068 s per char + pause per punctuation, same structure as speak()"""
    t = 0.2; st, en = [], []
    for ch in text:
        dur = 0.068 if ch not in " \n" else 0.03
        if ch in ".،,؟?!": dur = 0.28
        if ch == "\n": dur = 0.12
        st.append(t); t += dur; en.append(t)
    return dict(chars=list(text), start=st, end=en)
