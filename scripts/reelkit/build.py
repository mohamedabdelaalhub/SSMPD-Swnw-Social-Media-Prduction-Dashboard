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

def chunk_spans(text, hl):
    """same grouping rule as engine.split_chunks but keeps character spans"""
    words = [(m.group(), m.start(), m.end()) for m in re.finditer(r"\S+", text)]
    groups, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= 4 or (len(cur) >= 2 and re.search(r"[،,.؟?!:]$", w[0])): groups.append(cur); cur = []
    if cur:
        if groups and len(cur) == 1: groups[-1].extend(cur)
        else: groups.append(cur)
    out = []
    for g in groups:
        s0, s1 = g[0][1], g[-1][2]; s = text[s0:s1]
        s = s.rstrip('.')  # no full stop at the end of a caption (owner, 2026-11-13); the voice still gets the punctuation
        for h in hl or []:
            if h in s and "*" not in s: s = s.replace(h, "*" + h + "*")
        out.append((s, s0, s1))
    return out

# ---------------------------------------------------------------- voices
lines = E.collect_lines(sb); line_timing = {}; envs = {}; audio_src = {}
hl_of = {(si, bi): sb["scenes"][si]["beats"][bi]["say"].get("hl") for lst in lines.values() for si, bi, _ in lst}
for spk, lst in lines.items():
    joined = "\n\n".join(x[2] for x in lst); mp3 = os.path.join(args.out, f"voice_{spk}.mp3"); al = None
    if not args.dry:
        left = V.quota()
        if left is not None and left < len(joined) + 50: print("WARNING: ElevenLabs quota too low, using dry timing for", spk)
        else: al = V.speak(spk, joined, mp3)
        if al is None: print("WARNING: voice failed for", spk, "-> dry timing (no audio)")
    dry = al is None
    if not dry: json.dump(al, open(os.path.join(args.out, f'voice_{spk}.json'), 'w'))  # kept for debugging caption timing
    if not dry: json.dump(al, open(os.path.join(args.out, f'voice_{spk}.json'), 'w'))
    if dry: al = V.estimate(joined)
    st, en = al["start"], al["end"]; n = len(st); wav = decode(mp3) if not dry else None
    p95 = np.percentile(np.abs(wav), 95) if wav is not None and len(wav) else 1.0
    pos = 0
    for si, bi, text in lst:
        a, b = pos, pos + len(text); pos = b + 2
        ia, ib = min(a, n - 1), min(max(b - 1, a), n - 1)
        ta, tb = st[ia], en[ib]
        words = [(html, st[min(a + s0, n - 1)] - ta, en[min(max(a + s1 - 1, a + s0), n - 1)] - ta) for html, s0, s1 in chunk_spans(text, hl_of[(si, bi)])]
        line_timing[(si, bi)] = dict(dur=tb - ta + 0.05, words=words, env_key=(si, bi))
        audio_src[(si, bi)] = (mp3 if not dry else None, ta, tb)
        if wav is not None:
            seg = wav[int(ta * SR):int(tb * SR)]; w = int(SR / FPS)
            r = np.array([np.sqrt(np.mean(seg[i:i + w] ** 2)) if len(seg[i:i + w]) else 0 for i in range(0, max(len(seg) - w, 1), w)])
            e = np.clip(r / max(p95, 1e-6), 0, 1) ** 0.8; envs[(si, bi)] = np.convolve(e, [0.25, 0.5, 0.25], mode="same").tolist()

tl = E.plan(sb, line_timing)
dur = min(tl.dur, args.max_sec) if args.max_sec else tl.dur
if os.environ.get("RK_DEBUG"):
    print("SCENES", [(round(x["t0"],2), round(x["t1"],2)) for x in tl.scenes]); print("CAPS", [(round(a, 2), round(b, 2), h[:14]) for a, b, h in tl.caps])
print(f"timeline {tl.dur:.1f}s, {len(tl.scenes)} scenes, {sum(len(a['say']) for a in tl.actors.values())} lines, voices={'dry' if args.dry else 'ElevenLabs'}")

# ---------------------------------------------------------------- frames
fr = os.path.join(args.out, "frames_svg"); jp = os.path.join(args.out, "frames"); shutil.rmtree(fr, ignore_errors=True); shutil.rmtree(jp, ignore_errors=True); os.makedirs(fr)
N = int(dur * FPS)
for i in range(N): open(f"{fr}/f_{i:04d}.svg", "w").write(E.frame_svg(tl, i / FPS, envs))
q = N // args.workers + 1; procs = []
for k in range(args.workers):
    a, b = k * q, min(N, (k + 1) * q)
    if a < b: procs.append(subprocess.Popen(["node", os.path.join(HERE, "render_frames.js"), fr, jp, "jpg", str(a), str(b)], stdout=subprocess.DEVNULL))
for p in procs: p.wait()
print("frames rendered:", len(os.listdir(jp)))
if args.frames_only: sys.exit(0)

# ---------------------------------------------------------------- audio
contact = 0.0 if args.no_end else 3.0; total = dur + contact
mx = S.Mix(total); LEVEL = {}; TARGET_RMS = 0.12
for v in tl.voice:
    mp3, ta, tb = audio_src[(v["si"], v["bi"])]
    if mp3 is None: continue
    wav = decode(mp3)
    if mp3 not in LEVEL:  # every speaker is brought to the same speech loudness (a quiet voice next to a loud one was the owner's complaint)
        act = np.abs(wav)[np.abs(wav) > 0.02]
        LEVEL[mp3] = float(np.clip(TARGET_RMS / max(np.sqrt(np.mean(act ** 2)) if len(act) else TARGET_RMS, 1e-6), 0.4, 4.0))
    seg = wav[int(ta * SR):int(tb * SR) + int(0.05 * SR)].copy() * LEVEL[mp3]; seg = np.tanh(seg / 0.9) * 0.9; f = int(0.012 * SR)
    seg[:f] *= np.linspace(0, 1, f); seg[-f:] *= np.linspace(1, 0, f); mx.add(seg, v["t"], 1.0)
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
subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", f"{jp}/f_%04d.jpg", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", content], check=True)
final = os.path.join(args.out, sb.get("meta", {}).get("file", "reel.mp4"))
if args.no_end:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", content, "-i", os.path.join(args.out, "audio.wav"), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final], check=True)
else:
    cc = os.path.join(args.out, "contact.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(args.kit, "sono_contact_video.jpg"), "-vf", "zoompan=z='min(1+0.0007*on,1.07)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=90:s=1080x1920:fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", cc], check=True)
    out_ = os.path.join(args.kit, "sono_outro.mp4")
    flt = ("[0:v]fps=30,scale=1080:1920,setsar=1[v0];[1:v]fps=30,scale=1080:1920,setsar=1[v1];[2:v]fps=30,scale=1080:1920,setsar=1[v2];[v0][v1][v2]concat=n=3:v=1:a=0[v];"
           "[3:a]aresample=48000,aformat=channel_layouts=stereo[a0];[2:a]aresample=48000,aformat=channel_layouts=stereo[a2];[a0][a2]concat=n=2:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11[a]")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", content, "-i", cc, "-i", out_, "-i", os.path.join(args.out, "audio.wav"), "-filter_complex", flt, "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final], check=True)
print("DONE", final)
json.dump(dict(title=sb.get("meta", {}).get("title"), dur=tl.dur, tags=sb.get("meta", {}).get("tags", {})), open(os.path.join(args.out, "info.json"), "w"), ensure_ascii=False)
