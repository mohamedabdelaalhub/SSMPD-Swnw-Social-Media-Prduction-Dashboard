#!/usr/bin/env python3
"""storyboard.json -> reel.mp4.   python3 build.py story.json OUTDIR [--kit KITDIR] [--repo REPO] [--dry] [--no-end] [--max-sec S] [--fps 24]
KITDIR needs: sono_logo_web.png, sono_music_<mood>.mp3, sono_contact_video.jpg, sono_outro.mp4 (fetch with the gateway op=kit_get).
REPO = checkout of the dashboard repo (fonts in assets/fonts).  --dry = no ElevenLabs, estimated timing (no cost)."""
import sys, os, json, math, subprocess, re, shutil, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import numpy as np

ap = argparse.ArgumentParser(); ap.add_argument("story"); ap.add_argument("out")
ap.add_argument("--kit", default=os.environ.get("KIT", ".")); ap.add_argument("--repo", default=os.environ.get("SSMPD_REPO", os.path.abspath(os.path.join(HERE, "..", ".."))))
ap.add_argument("--dry", action="store_true"); ap.add_argument("--no-end", action="store_true"); ap.add_argument("--max-sec", type=float, default=0)
ap.add_argument("--fps", type=int, default=24); ap.add_argument("--workers", type=int, default=4); ap.add_argument("--frames-only", action="store_true")
args = ap.parse_args()
os.environ["KIT"] = args.kit; os.environ["SSMPD_REPO"] = args.repo
import base as B, engine as E, voices as V, sfxlib as S

args.out = os.path.abspath(args.out); sb = json.load(open(args.story)); os.makedirs(args.out, exist_ok=True); FPS = args.fps
SR = 44100
def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)

TASHKEEL = re.compile('[\u064B-\u0652\u0670]')
# Pronunciation (owner, 2026-11-13): the story text is written plain (it is what the screen shows). What the VOICE reads comes from pron.json
# (+ optional meta.pron in the story): word -> spelling with diacritics / Egyptian qaf written as hamza (e.g. أوقف -> أوَأف). Keys have no diacritics.
PRON = json.load(open(os.path.join(HERE, "pron.json")))
PRON.update({TASHKEEL.sub("", k): v for k, v in (sb.get("meta", {}).get("pron") or {}).items()})
_PUNCT = "،,.؟?!:؛\"«»()"
def voice_text(text, pron):
    def one(m):
        tok = m.group(); core = tok.strip(_PUNCT); key = TASHKEEL.sub("", core)
        return tok.replace(core, pron[key], 1) if core and key in pron else tok
    return re.sub(r"\S+", one, text)

def chunk_spans(text, vtext, hl):
    """same grouping rule as engine.split_chunks; the display words come from `text`, the character spans (for the voice timing) from `vtext`"""
    words = [(m.group(), v.start(), v.end()) for m, v in zip(re.finditer(r"\S+", text), re.finditer(r"\S+", vtext))]
    groups, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= 4 or sum(len(x[0]) for x in cur) >= 19 or (len(cur) >= 2 and re.search(r"[،,.؟?!:]$", w[0])): groups.append(cur); cur = []
    if cur:
        if groups and len(cur) == 1: groups[-1].extend(cur)
        else: groups.append(cur)
    out = []
    for g in groups:
        s0, s1 = g[0][1], g[-1][2]; s = TASHKEEL.sub("", " ".join(w[0] for w in g))  # diacritics are for the VOICE only: never shown on screen
        s = s.rstrip('.')  # no full stop at the end of a caption; the voice still gets the punctuation
        for h in hl or []:
            h = TASHKEEL.sub("", h)
            if h in s and "*" not in s: s = s.replace(h, "*" + h + "*")
        out.append((s, s0, s1))
    return out


# ---- speech check (added 2026-11-13): the voice model sometimes invents words (a take once contained "كل قواظ وقرب باباكوا" that is not in the script).
# After generating a take we transcribe it (ElevenLabs scribe) and compare with the script; below the threshold the take is regenerated (max 3 tries).
import difflib
def _norm(t): return re.sub(r"[^\u0621-\u064A ]", "", TASHKEEL.sub("", t)).replace("ة", "ه").replace("أ", "ا").replace("إ", "ا").replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي")
def transcribe(path):
    try:
        r = subprocess.run(["curl", "-s", "-m", "120", "-X", "POST", "https://api.elevenlabs.io/v1/speech-to-text", "-F", "model_id=scribe_v1", "-F", "language_code=ara", "-F", "file=@" + path], capture_output=True, text=True)
        return json.loads(r.stdout).get("text")
    except Exception:
        return None
def speech_ok(path, expected, threshold=0.85):
    t = transcribe(path)
    if t is None: return True, None  # no transcription available (e.g. scheduled environment): cannot check, accept
    sc = difflib.SequenceMatcher(None, _norm(t), _norm(expected)).ratio()
    t_chk = re.sub(r"(?i)\b(laser|whatsapp|facebook|instagram|ok)\b", "", t)  # common loan words are fine; a BRAND name in Latin letters means the voice read it in English
    if re.search(r"[A-Za-z]", t_chk): return False, round(min(sc, 0.5), 2)  # the voice pronounced a name in English (e.g. Sono / laser): regenerate
    return sc >= threshold, round(sc, 2)

# ---------------------------------------------------------------- voices
V.SETTINGS.update((sb.get("meta") or {}).get("voice_settings") or {})
V.VO.update((sb.get("meta") or {}).get("vo") or {})  # Instinct narrator: {"energy": "calm|moderate|energetic", "voice": "auto|female|male", "notes": "..."}  # e.g. a livelier ad read: {"stability":0.4,"style":0.35,"speed":1.03}
lines = E.collect_lines(sb); line_timing = {}; envs = {}; audio_src = {}
hl_of = {(si, bi): sb["scenes"][si]["beats"][bi]["say"].get("hl") for lst in lines.values() for si, bi, _ in lst}
for spk, lst in lines.items():
    joined = "\n\n".join(voice_text(x[2], PRON) for x in lst); mp3 = os.path.join(args.out, f"voice_{spk.replace(chr(35), chr(95))}.mp3"); al = None
    reuse = os.environ.get("RK_REUSE"); rj = os.path.join(reuse, f"voice_{spk.replace(chr(35), chr(95))}.json") if reuse else None
    if reuse and rj and os.path.exists(rj):
        import shutil as _sh; _sh.copy(os.path.join(reuse, f"voice_{spk.replace(chr(35), chr(95))}.mp3"), mp3); al = json.load(open(rj)); print("reusing voice take", spk)
    elif not args.dry:
        left = V.quota()
        instinct = spk.split(chr(35))[0] == "narrator" and V.VO["engine"] == "instinct"  # the Instinct narrator does not use ElevenLabs characters
        if left is not None and left < len(joined) + 50 and not instinct: print("WARNING: ElevenLabs quota too low, using dry timing for", spk)
        else:
            al = V.speak(spk.split(chr(35))[0], joined, mp3); shown = " ".join(TASHKEEL.sub("", x[2]) for x in lst)
            for attempt in range(7):
                if al is None: break
                good, sc = speech_ok(mp3, shown)
                print(f"speech check {spk}: score={sc} {'ok' if good else 'MISMATCH - regenerating'}")
                if good or attempt == 6: break
                al = V.speak(spk.split(chr(35))[0], joined, mp3)
        if al is None: print("WARNING: voice failed for", spk, "-> dry timing (no audio)")
    dry = al is None
    if not dry: json.dump(al, open(os.path.join(args.out, f'voice_{spk.replace(chr(35), chr(95))}.json'), 'w'))  # kept for debugging caption timing
    if not dry: json.dump(al, open(os.path.join(args.out, f'voice_{spk}.json'), 'w'))
    if dry: al = V.estimate(joined)
    st, en = al["start"], al["end"]; n = len(st); wav = decode(mp3) if not dry else None
    p95 = np.percentile(np.abs(wav), 95) if wav is not None and len(wav) else 1.0
    pos = 0; got = []
    for si, bi, text in lst:
        vtxt = voice_text(text, PRON); a, b = pos, pos + len(vtxt); pos = b + 2
        ia, ib = min(a, n - 1), min(max(b - 1, a), n - 1)
        ta, tb = st[ia], en[ib]
        words = [(html, st[min(a + s0, n - 1)] - ta, en[min(max(a + s1 - 1, a + s0), n - 1)] - ta) for html, s0, s1 in chunk_spans(text, vtxt, hl_of[(si, bi)])]
        line_timing[(si, bi)] = dict(dur=tb - ta + 0.05, words=words, env_key=(si, bi))
        audio_src[(si, bi)] = (mp3 if not dry else None, ta, tb)
        got.append((si, bi, ta, tb))
        if wav is not None:
            seg = wav[int(ta * SR):int(tb * SR)]; w = int(SR / FPS)
            r = np.array([np.sqrt(np.mean(seg[i:i + w] ** 2)) if len(seg[i:i + w]) else 0 for i in range(0, max(len(seg) - w, 1), w)])
            e = np.clip(r / max(p95, 1e-6), 0, 1) ** 0.8; envs[(si, bi)] = np.convolve(e, [0.25, 0.5, 0.25], mode="same").tolist()

    if (sb.get("meta") or {}).get("voice_continuous") and len(got) > 1 and not spk.count(chr(35)):
        # the whole take plays as ONE continuous stream (its natural breathing is kept); each scene lasts from its sentence start to the next one's start
        for k, (si, bi, ta, tb) in enumerate(got):
            tend = got[k + 1][2] if k + 1 < len(got) else tb + 0.35
            line_timing[(si, bi)]["dur"] = tend - ta
            audio_src[(si, bi)] = (mp3 if not dry else None, ta, tend, True, k == 0, k == len(got) - 1)

tl = E.plan(sb, line_timing)
dur = min(tl.dur, args.max_sec) if args.max_sec else tl.dur
if os.environ.get("RK_DEBUG"):
    print("SCENES", [(round(x["t0"],2), round(x["t1"],2)) for x in tl.scenes]); print("CAPS", [(round(a, 2), round(b, 2), h[:14]) for a, b, h in tl.caps])
print(f"timeline {tl.dur:.1f}s, {len(tl.scenes)} scenes, {sum(len(a['say']) for a in tl.actors.values())} lines, voices={'dry' if args.dry else 'ElevenLabs'}")

# ---------------------------------------------------------------- frames
XF = 0.3  # crossfade between background shots (seconds)
ALPHA = any("bg" in sc for sc in sb["scenes"])  # scenes with a video/photo background composed under transparent overlay frames
fr = os.path.join(args.out, "frames_svg"); jp = os.path.join(args.out, "frames"); shutil.rmtree(fr, ignore_errors=True); shutil.rmtree(jp, ignore_errors=True); os.makedirs(fr)
N = int(dur * FPS)
for i in range(N): open(f"{fr}/f_{i:04d}.svg", "w").write(E.frame_svg(tl, i / FPS, envs))
q = N // args.workers + 1; procs = []
for k in range(args.workers):
    a, b = k * q, min(N, (k + 1) * q)
    if a < b: procs.append(subprocess.Popen(["node", os.path.join(HERE, "render_frames.js"), fr, jp, "png" if ALPHA else "jpg", str(a), str(b)], stdout=subprocess.DEVNULL, env=dict(os.environ, **({"RF_ALPHA": "1"} if ALPHA else {}))))
for p in procs: p.wait()
# clean frame (no logo, no captions) for the reel cover: scripts/reelkit/cover.py puts the approved cover template on top of it
try:
    tc = float(sb.get("meta", {}).get("cover_t", min(2.0, tl.scenes[0]["t1"] - 0.3)))
    svgp = os.path.join(args.out, "cover_frame.svg"); open(svgp, "w").write(E.frame_svg(tl, tc, envs, {"no_caps": True, "no_chrome": True}))
    subprocess.run(["node", os.path.join(HERE, "shot_svg.js"), svgp, os.path.join(args.out, "cover_frame.png"), "1080", "1920"], check=True, stdout=subprocess.DEVNULL)
except Exception as e:
    print("WARNING: cover frame failed:", e)
print("frames rendered:", len(os.listdir(jp)))
if args.frames_only: sys.exit(0)

# ---------------------------------------------------------------- audio
contact = 0.0 if args.no_end else 3.0; total = dur + contact
mx = S.Mix(total); LEVEL = {}; TARGET_RMS = 0.12
for v in tl.voice:
    src = audio_src[(v["si"], v["bi"])]; mp3, ta, tb = src[:3]; cont = len(src) > 3
    if mp3 is None: continue
    wav = decode(mp3)
    if mp3 not in LEVEL:  # every speaker is brought to the same speech loudness (a quiet voice next to a loud one was the owner's complaint)
        act = np.abs(wav)[np.abs(wav) > 0.02]
        LEVEL[mp3] = float(np.clip(TARGET_RMS / max(np.sqrt(np.mean(act ** 2)) if len(act) else TARGET_RMS, 1e-6), 0.4, 4.0))
    if cont:  # continuous take: no cuts between sentences, only a soft entrance on the first and a soft end on the last
        seg = wav[int(ta * SR):int(tb * SR)].copy() * LEVEL[mp3]; seg = np.tanh(seg / 0.9) * 0.9
        if src[4]: f = int(0.04 * SR); seg[:f] *= np.linspace(0, 1, f)
        if src[5]: f = int(0.15 * SR); seg[-f:] *= np.linspace(1, 0, f)
        mx.add(seg, v["t"], 1.0); continue
    seg = wav[int(ta * SR):int(tb * SR) + int(0.24 * SR)].copy() * LEVEL[mp3]; seg = np.tanh(seg / 0.9) * 0.9; f = int(0.04 * SR); seg[-int(0.12 * SR):] *= np.linspace(1, 0, int(0.12 * SR))  # keep the word ending, fade out softly
    seg[:f] *= np.linspace(0, 1, f); seg[-f:] *= np.linspace(1, 0, f); mx.add(seg, v["t"], 1.0)
bed = (sb.get("meta") or {}).get("bed_audio")
if bed:  # the owner's live clip: its own sound plays as one continuous stream from bed["t0"], whatever the scenes show on top
    bw = decode(bed["path"]); act = np.abs(bw)[np.abs(bw) > 0.02]; g = float(np.clip(0.12 / max(np.sqrt(np.mean(act ** 2)) if len(act) else 0.12, 1e-6), 0.4, 4.0))
    bw = np.tanh(bw * g / 0.9) * 0.9; f = int(0.02 * SR); bw[:f] *= np.linspace(0, 1, f); bw[-f:] *= np.linspace(1, 0, f); mx.add(bw, bed.get("t0", 0.0), 1.0)
for t0, nm, g in tl.sfx:
    if t0 < dur: mx.sfx(nm, t0, g * 0.8)
mood = sb.get("meta", {}).get("music", "upbeat"); mf = os.path.join(args.kit, f"sono_music_{mood}.mp3")
if os.path.exists(mf):
    m = decode(mf); m0 = sb.get("meta", {}).get("music_from", 1.0); i0 = int(m0 * SR); mus = np.zeros(mx.N); L = min(len(m), mx.N - i0); mus[i0:i0 + L] = m[:L]
    tm = np.arange(mx.N) / SR; mus *= np.clip((tm - m0) / 1.2, 0, 1) * np.clip((total - tm) / 1.8, 0, 1) * 0.10; mx.a += mus
a = mx.a / max(1e-9, np.max(np.abs(mx.a))) * 0.9; pcm = (a * 32767).astype(np.int16)
import wave
with wave.open(os.path.join(args.out, "audio.wav"), "wb") as w_:
    w_.setnchannels(2); w_.setsampwidth(2); w_.setframerate(SR); w_.writeframes(np.column_stack([pcm, pcm]).tobytes())

# ---------------------------------------------------------------- mux
content = os.path.join(args.out, "content.mp4")
if not ALPHA:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", f"{jp}/f_%04d.jpg", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", content], check=True)
else:
    segs = []; OVF = round(XF * FPS)
    for i, sc in enumerate(tl.scenes):
        n = max(1, round(sc["t1"] * FPS) - round(sc["t0"] * FPS)) + (OVF if i < len(tl.scenes) - 1 else 0); bg = sb["scenes"][i].get("bg") or {}; sg = os.path.join(args.out, f"bg_{i:02d}.mp4")
        if bg.get("video"):
            fit = bg.get("fit", "blur"); cx = bg.get("cx", 0.5)
            if fit == "fill": vf = "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920"
            elif fit == "cover": vf = f"scale=-2:1920:flags=lanczos,crop=1080:1920:(iw-1080)*{cx}:0"
            else: vf = "split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:8,eq=brightness=-0.12[bgv];[b]scale=1080:-2:flags=lanczos[fgv];[bgv][fgv]overlay=(W-w)/2:(H-h)/2"
            spd = float(bg.get("speed", 1.0)); st0 = float(bg.get("start", 0)); en0 = st0 + (n / FPS) * spd
            pre = f"trim=start={st0}:end={en0:.3f},setpts=(PTS-STARTPTS)/{spd}," + (f"minterpolate=fps={FPS}:mi_mode=blend," if spd < 0.99 else "")
            if bg.get("crop"):  # [x, y, w, h] as fractions of the clip: zoom into a region (e.g. the device, away from faces)
                cx_, cy_, cw_, ch_ = bg["crop"]; pre += f"crop=iw*{cw_}:ih*{ch_}:iw*{cx_}:ih*{cy_},"
            vf = pre + vf
            cmd = ["ffmpeg", "-v", "error", "-y", "-i", bg["video"], "-an", "-filter_complex" if "[" in vf else "-vf", vf, "-r", str(FPS), "-frames:v", str(n), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", sg]
        else:
            z0, z1 = bg.get("z0", 1.0), bg.get("z1", 1.12)
            vf = f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale=2160:3840,zoompan=z='{z0}+({z1}-{z0})*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps={FPS}"
            cmd = ["ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", bg["photo"], "-vf", vf, "-frames:v", str(n), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", sg]
        subprocess.run(cmd, check=True); segs.append(sg)
    bgall = os.path.join(args.out, "bg.mp4"); cmd = ["ffmpeg", "-v", "error", "-y"]
    for sg in segs: cmd += ["-i", sg]
    if len(segs) == 1: fc, last = "[0:v]null[x0]", "x0"
    else:
        parts = []; last = "0:v"
        def nfr(path): return int(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip() or 0)
        lens = [nfr(x) / FPS for x in segs]; acc = lens[0]
        for i in range(1, len(segs)):
            off = max(0.0, acc - XF); acc = off + lens[i]; parts.append(f"[{last}][{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}[x{i}]"); last = f"x{i}"
        fc = ";".join(parts)
    fc += f";[{last}]tpad=stop_mode=clone:stop_duration=1[xo]" if len(segs) > 1 else ""
    if os.environ.get("RK_DEBUG"): print("XFADE", fc, [round(x["t0"], 2) for x in tl.scenes])
    cmd += ["-filter_complex", fc, "-map", "[xo]" if len(segs) > 1 else "[x0]", "-frames:v", str(round(tl.dur * FPS)), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", bgall]
    subprocess.run(cmd, check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", bgall, "-framerate", str(FPS), "-i", f"{jp}/f_%04d.png", "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]", "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", content], check=True)
final = os.path.join(args.out, sb.get("meta", {}).get("file", "reel.mp4"))
if args.no_end:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", content, "-i", os.path.join(args.out, "audio.wav"), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final], check=True)
else:
    cc = os.path.join(args.out, "contact.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(args.kit, "sono_contact_video.jpg"), "-vf", "zoompan=z='min(1+0.0007*on,1.07)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=90:s=1080x1920:fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", cc], check=True)
    out_ = os.path.join(args.kit, "sono_outro.mp4")
    clip = (sb.get("meta") or {}).get("prepend_clip")
    if clip:  # an existing clip (the owner's live presenter clip) goes FIRST, its own sound kept, then the generated content
        main = os.path.join(args.out, "main.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", content, "-i", os.path.join(args.out, "audio.wav"), "-i", clip,
                        "-filter_complex", "[2:v]fps=30,scale=1080:1920:flags=lanczos,setsar=1[v1];[0:v]fps=30,scale=1080:1920,setsar=1[v0];[v1][v0]concat=n=2:v=1:a=0[v];"
                        f"[1:a]atrim=0:{dur:.3f},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a0];[2:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11[a1];[a1][a0]concat=n=2:v=0:a=1,apad=pad_dur=3[a]",
                        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k", main], check=True)
        content_in, audio_in = main, main
    else:
        content_in, audio_in = content, os.path.join(args.out, "audio.wav")
    flt = ("[0:v]fps=30,scale=1080:1920,setsar=1[v0];[1:v]fps=30,scale=1080:1920,setsar=1[v1];[2:v]fps=30,scale=1080:1920,setsar=1[v2];[v0][v1][v2]concat=n=3:v=1:a=0[v];"
           "[3:a]aresample=48000,aformat=channel_layouts=stereo[a0];[2:a]aresample=48000,aformat=channel_layouts=stereo[a2];[a0][a2]concat=n=2:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11[a]")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", content_in, "-i", cc, "-i", out_, "-i", audio_in, "-filter_complex", flt, "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final], check=True)
print("DONE", final)
json.dump(dict(title=sb.get("meta", {}).get("title"), dur=tl.dur, tags=sb.get("meta", {}).get("tags", {})), open(os.path.join(args.out, "info.json"), "w"), ensure_ascii=False)
