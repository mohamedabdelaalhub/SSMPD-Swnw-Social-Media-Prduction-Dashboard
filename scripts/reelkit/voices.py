"""Voice generation: one ElevenLabs request per character (all that character's lines), with character-level timing.
Falls back to an estimated timing (dry mode) when no key/quota or when asked."""
import json, os, subprocess, base64, tempfile, math

VOICES = {  # name -> ElevenLabs voice id (see docs/character-library/voices.json)
    "narrator": "VXERCtS1keFWRMOi7czu", "doctor_male": "DWMVT5WflKt0P8OPpIrY", "male_2": "LXrTqFIgiubkrMkwvOUr",
    "woman_1": "I3u6waC588j43py1kDN2", "woman_2": "xPcC3nehhziQaOrIeAwv", "elder_man": "Jez3JdhBInQTvlAvDOWR",
    "elder_woman": "mS4cERRqrNy5Kmlx8Udf"}
SETTINGS = {"stability": 0.5, "similarity_boost": 0.75, "style": 0, "speed": 1.0, "use_speaker_boost": True}

def quota():
    r = subprocess.run(["curl", "-s", "-m", "30", "https://api.elevenlabs.io/v1/user/subscription"], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout); return d["character_limit"] - d["character_count"]
    except Exception:
        return None

def speak(voice, text, out_mp3):
    """returns dict(chars=[...], start=[...], end=[...]) or None on failure (then caller must use estimates)."""
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
