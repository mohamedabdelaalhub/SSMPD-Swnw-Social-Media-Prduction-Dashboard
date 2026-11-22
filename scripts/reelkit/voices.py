"""Voice generation: one ElevenLabs request per character (all that character's lines), with character-level timing.
Falls back to an estimated timing (dry mode) when no key/quota or when asked."""
import json, os, subprocess, base64, tempfile, math

VOICES = {  # name -> ElevenLabs voice id (see docs/character-library/voices.json)
    "narrator": "VXERCtS1keFWRMOi7czu", "doctor_male": "DWMVT5WflKt0P8OPpIrY", "male_2": "LXrTqFIgiubkrMkwvOUr",
    "woman_1": "I3u6waC588j43py1kDN2", "woman_2": "xPcC3nehhziQaOrIeAwv", "elder_man": "Jez3JdhBInQTvlAvDOWR", "elder_woman": "mS4cERRqrNy5Kmlx8Udf"}
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
        body = json.dumps({"text": text, "voice": voice if voice in VOICES else "narrator", "timestamps": True, "stability": SETTINGS["stability"], "style": SETTINGS["style"], "speed": SETTINGS["speed"]}, ensure_ascii=False)
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
    Narrator: Instinct human voice-over first (VO below), once per text; then ElevenLabs as before.
    Others: direct ElevenLabs first (secret injected by the proxy); if that fails, the gateway."""
    if voice == "narrator" and VO["engine"] == "instinct" and text not in _instinct_tried:
        _instinct_tried.add(text)  # a regenerate (speech check) of the same text goes to ElevenLabs: never wait 30 min twice
        r = speak_instinct(text, out_mp3)
        if r: return r
        print("Instinct narrator unavailable -> ElevenLabs op=tts fallback")
    r = speak_direct(voice, text, out_mp3)
    return r if r else speak_gateway(voice, text, out_mp3)

# ---------------------------------------------------------------- Instinct narrator (owner 2026-11-22)
# The gateway queues the script (?op=vo_submit) for the voice-over worker on swnw-vps, which e-mails Instinct and stores
# the MP3 (?op=vo_fetch). voice "auto" alternates male/female reel by reel. Storyboard meta.vo overrides these
# (e.g. {"energy": "energetic"}); RK_NARRATOR=elevenlabs switches Instinct off for a run.
VO = {"engine": os.environ.get("RK_NARRATOR", "instinct"), "voice": "auto", "energy": "moderate", "notes": "",
      "timeout": 30 * 60, "interval": 20}
_instinct_tried = set()
JOBS = {}  # sha1(narrator text) -> Instinct job id (OUT/vo_jobs.json: `build.py --vo-submit` asks early, the build reuses it)
JOBS_FILE = None
def _key(text): return __import__("hashlib").sha1(text.encode()).hexdigest()
def load_jobs(path):
    global JOBS_FILE; JOBS_FILE = path
    try: JOBS.update(json.load(open(path)))
    except Exception: pass
def _save_jobs():
    if JOBS_FILE: json.dump(JOBS, open(JOBS_FILE, "w"), indent=1)

def submit_instinct(text, http=None):
    """-> job id (reused if this exact text was already asked for), or None."""
    http = http or _gw
    if JOBS.get(_key(text)): return JOBS[_key(text)]
    code, _, d = http("vo_submit", "", {"script": text, "voice": VO["voice"], "energy": VO["energy"], "notes": VO["notes"] or None})
    if code != 200 or not d or not d.get("ok"):
        print("Instinct vo_submit refused:", (d or {}).get("error") or code); return None
    JOBS[_key(text)] = d["job_id"]; _save_jobs(); return d["job_id"]

def vo_status(job, http=None):
    """-> {status, voice, clips:[{url, source, kind?, id?}]} — clips = Instinct's suggested shots (optional ideas)."""
    code, _, d = (http or _gw)("vo_status", "&job_id=" + job, {})
    return d if code == 200 and d else {"status": "error", "code": code}

LAST_VO = {}  # what Instinct answered for the last take: {"job_id", "voice", "energy"} (for the run report)

def _gw(op, query="", body=None, out_path=None):
    """gateway call -> (http_status, content_type, parsed JSON or None). With out_path the body is saved there."""
    tok = open(os.path.expanduser("~/.swnw-run-token")).read().strip()
    fd, tmp = tempfile.mkstemp(); os.close(fd); hdr = tmp + ".h"
    try:
        cmd = ["curl", "-s", "-m", "120", "-A", "claude-task", "-X", "POST", GATEWAY + "?op=" + op + query, "-H", "X-Run-Token: " + tok,
               "-H", "Content-Type: application/json", "--data-binary", json.dumps(body or {}, ensure_ascii=False), "-o", tmp, "-D", hdr,
               "-w", "%{http_code} %{content_type}"]
        r = subprocess.run(cmd, capture_output=True, text=True)
        code, _, ctype = (r.stdout or "0 ").partition(" ")
        if out_path and ctype.startswith("audio/"):
            import re as _re
            m = _re.search(r"(?im)^x-vo-voice:\s*(\w+)", open(hdr, errors="ignore").read() if os.path.exists(hdr) else "")
            os.replace(tmp, out_path); return int(code or 0), ctype, {"voice": m.group(1) if m else None}
        try: d = json.load(open(tmp))
        except Exception: d = None
        return int(code or 0), ctype, d
    finally:
        for f in (tmp, hdr):
            if os.path.exists(f): os.remove(f)

def speak_instinct(text, out_mp3, http=None, sleep=None, clock=None):
    """Instinct take for the narrator -> timing dict, or None (timeout 30 min / refused / error) so the caller falls back."""
    http = http or _gw; sleep = sleep or __import__("time").sleep; clock = clock or __import__("time").time
    try:
        job = submit_instinct(text, http)
        if not job: return None
        t0 = clock(); print("Instinct job", job, "voice", VO["voice"], "energy", VO["energy"])
        while clock() - t0 < VO["timeout"]:
            sleep(VO["interval"])
            code, ctype, d = http("vo_fetch", "&job_id=" + job, {}, out_mp3)
            if code == 200 and ctype.startswith("audio/"):
                v = (d or {}).get("voice"); LAST_VO.update(job_id=job, voice=v, energy=VO["energy"])
                print("Instinct take ready:", {"male": "رجالي", "female": "حريمي"}.get(v, v or "?"), VO["energy"], "after", int(clock() - t0), "s")
                return instinct_timing(text, out_mp3)
            st = (d or {}).get("status")
            if st in ("timeout", "failed") or code in (401, 404):
                print("Instinct job", job, st or code, (d or {}).get("error") or "")
                if st == "timeout": JOBS.pop(_key(text), None); _save_jobs()  # a later run asks again
                return None
        print("Instinct job", job, "no voice within", VO["timeout"] // 60, "min"); return None
    except Exception as e:
        print("Instinct error:", type(e).__name__); return None

def _probe(mp3):
    """-> (duration seconds, [(silence_start, silence_end), ...]) of the take."""
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3],
                               capture_output=True, text=True).stdout.strip() or 0)
    err = subprocess.run(["ffmpeg", "-v", "info", "-i", mp3, "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    import re as _re
    ss = [float(x) for x in _re.findall(r"silence_start: ([\d.]+)", err)]; se = [float(x) for x in _re.findall(r"silence_end: ([\d.]+)", err)]
    sil = [(a, se[i] if i < len(se) else dur) for i, a in enumerate(ss)]
    return dur, sil

def instinct_timing(text, mp3):
    dur, sil = _probe(mp3)
    return align_to_audio(text, dur, sil) if dur > 0 else None

def align_to_audio(text, dur, silences):
    """Character timing for a take that came without timestamps: the estimate() shape is fitted to the real audio.
    Lines are joined with a blank line ("\n\n"); when the take has a pause for every line break, each line is pinned
    between its pauses, otherwise the whole text is stretched over the speech."""
    est = estimate(text); n = len(text)
    s0, s1 = 0.0, dur
    sil = sorted(silences)
    if sil and sil[0][0] <= 0.05: s0 = sil[0][1]; sil = sil[1:]
    if sil and sil[-1][1] >= dur - 0.05: s1 = sil[-1][0]; sil = sil[:-1]
    segs, a = [], 0
    while True:
        b = text.find("\n\n", a)
        if b < 0: segs.append((a, n)); break
        segs.append((a, b)); a = b + 2
    gaps = sorted(sorted([x for x in sil if x[1] - x[0] >= 0.25], key=lambda x: x[0] - x[1])[:len(segs) - 1])
    if len(segs) > 1 and len(gaps) == len(segs) - 1:
        spans = [(s0 if k == 0 else gaps[k - 1][1], s1 if k == len(segs) - 1 else gaps[k][0]) for k in range(len(segs))]
    else:
        segs, spans = [(0, n)], [(s0, s1)]
    st, en = [None] * n, [None] * n
    for (a, b), (ta, tb) in zip(segs, spans):
        if b <= a: continue
        ea, eb = est["start"][a], est["end"][b - 1]; k = (tb - ta) / max(eb - ea, 1e-6)
        for i in range(a, b): st[i] = ta + (est["start"][i] - ea) * k; en[i] = ta + (est["end"][i] - ea) * k
    last = s0
    for i in range(n):  # the blank-line characters sit inside the pause between two lines
        if st[i] is None:
            nxt = next((st[j] for j in range(i + 1, n) if st[j] is not None), last)
            st[i] = last; en[i] = nxt
        last = en[i]
    return dict(chars=list(text), start=st, end=en, source="instinct")

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
