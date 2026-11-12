#!/usr/bin/env python3
"""Synthesized SFX + light music for the Swnw stickman test video (no external assets)."""
import numpy as np, wave, sys, math

import json, subprocess, os
SCH = json.load(open("sched.json"))
SR = 44100; DUR = SCH["dur"] + SCH["contact_s"]
N = int(SR * DUR)
mix = np.zeros(N, dtype=np.float64)
rng = np.random.default_rng(3)

def add(sig, t0, gain=1.0):
    i = int(t0 * SR)
    if i >= N: return
    seg = sig[: N - i]
    mix[i:i + len(seg)] += seg * gain

def tt(dur): return np.arange(int(dur * SR)) / SR
def env(dur, decay): return np.exp(-tt(dur) * decay)

def tick():
    t = tt(0.05)
    return (np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 90) + 0.4 * np.sin(2 * np.pi * 900 * t) * np.exp(-t * 120))
def pop():
    t = tt(0.14); f = 480 + 900 * (t / 0.14)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28)
def whoosh(dur=0.7, up=True):
    t = tt(dur); n = rng.standard_normal(len(t))
    k = int(SR * 0.004); n = np.convolve(n, np.ones(k) / k, mode="same")
    a = np.sin(np.pi * (t / dur)) ** 2
    f = np.linspace(300, 2500, len(t)) if up else np.linspace(2500, 300, len(t))
    return n * a * 0.9 * (0.5 + 0.5 * np.sin(2 * np.pi * f * t / 4000))
def riser(dur):
    t = tt(dur); f = 220 + 1400 * (t / dur) ** 2
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / dur)
    s *= 0.6 + 0.4 * np.sin(2 * np.pi * (6 + 20 * t / dur) * t)
    return s * 0.7
def impact():
    t = tt(0.9)
    thump = np.sin(2 * np.pi * (140 * np.exp(-t * 6)) * t) * np.exp(-t * 7)
    nz = rng.standard_normal(len(t)) * np.exp(-t * 18) * 0.7
    return thump * 1.1 + nz
def yelp():
    t = tt(0.8); f = 1100 * np.exp(-t * 1.4) + 120 + 40 * np.sin(2 * np.pi * 9 * t)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.4 * np.sin(2 * np.pi * np.cumsum(2 * f) / SR)
    return s * np.minimum(1, t * 60) * np.exp(-t * 2.5) * 0.7
def boing():
    t = tt(0.55); f = 180 + 520 * np.abs(np.sin(2 * np.pi * 3.2 * t)) * np.exp(-t * 3)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5) * 0.6
def splash():
    t = tt(0.5); n = rng.standard_normal(len(t))
    k = int(SR * 0.002); n = np.convolve(n, np.ones(k) / k, mode="same")
    return n * np.exp(-t * 9) * 0.8
def clink():
    t = tt(0.35)
    return (np.sin(2 * np.pi * 2900 * t) + 0.6 * np.sin(2 * np.pi * 4100 * t)) * np.exp(-t * 18) * 0.5
def mallet(m, dur=0.5):
    f = 440 * 2 ** ((m - 69) / 12); t = tt(dur)
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t * 14)) * np.exp(-t * 7) * np.minimum(1, t * 400)
def bass(m, dur=0.45):
    f = 440 * 2 ** ((m - 69) / 12); t = tt(dur)
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 5) * np.minimum(1, t * 200)
def hat():
    t = tt(0.05); n = rng.standard_normal(len(t))
    return np.diff(n, prepend=0) * np.exp(-t * 90) * 0.5


KIT = os.environ.get("KIT", ".")
def load_mp3(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)
def fade(seg, ms=15):
    n = int(SR * ms / 1000); seg = seg.copy()
    seg[:n] *= np.linspace(0, 1, n); seg[-n:] *= np.linspace(1, 0, n); return seg
IMPACT = 9.9
FIN = SCH["fin"]
# tension ticks
for k in range(6): add(tick(), 0.5 + k * 0.5, 0.18)
tcur, gap = 4.0, 0.6
while tcur < IMPACT - 0.05:
    add(tick(), tcur, 0.3); tcur += gap; gap = max(0.2, gap * 0.9)
for t0 in (5.0, 6.6, 8.7): add(clink(), t0, 0.3)
for t0 in SCH["pops"]: add(pop(), t0, 0.22)
add(riser(IMPACT - 8.0), 8.0, 0.3)
add(impact(), IMPACT, 0.9); add(yelp(), IMPACT + 0.03, 0.6); add(boing(), IMPACT + 0.2, 0.45); add(clink(), IMPACT + 0.05, 0.45)
add(splash(), IMPACT + 0.05, 0.35); add(splash(), 11.2, 0.45)
add(whoosh(0.8, True), 16.3, 0.3); add(whoosh(0.8, False), FIN - 0.1, 0.3)
tt2 = 13.3
while tt2 < 14.65:
    add(tick(), tt2, 0.35); tt2 += 0.22
for t0 in (13.9, 14.2): add(clink(), t0, 0.25)
add(impact(), 14.7, 0.5); add(yelp(), 14.72, 0.35); add(clink(), 14.72, 0.35); add(boing(), 14.9, 0.25)
# ---- voice (one ElevenLabs take, cut at its natural pauses and placed on the scenes) ----
vo = load_mp3(os.path.join(KIT, "voice.mp3"))
vod = load_mp3(os.path.join(KIT, "voice_doctor.mp3"))
voice = np.zeros(N)
for s in SCH["vo_slices"]:
    src = vo if s["src"] == "narr" else vod
    seg = fade(src[int(s["a"] * SR):int(s["b"] * SR)]); i = int(s["place"] * SR); voice[i:i + len(seg)] += seg[: N - i]
g0, g1 = SCH["g8"]; seg = fade(vo[int(g0 * SR):int(g1 * SR)]); i = int((SCH["dur"] + 0.22) * SR); voice[i:i + len(seg)] += seg[: max(0, N - i)]
# ---- music from the Swnw kit, low under the voice ----
mus = load_mp3(os.path.join(KIT, "sono_music_upbeat.mp3"))
m0 = 10.9; ml = N - int(m0 * SR); music = np.zeros(N); music[int(m0 * SR):] = mus[:ml]
tm = np.arange(N) / SR
music *= np.clip((tm - m0) / 1.2, 0, 1) * np.clip((DUR - tm) / 1.8, 0, 1) * 0.16
mix_total = mix + voice * 1.0 + music
mix_total = mix_total / max(1e-9, np.max(np.abs(mix_total))) * 0.9
pcm = (mix_total * 32767).astype(np.int16)
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(np.column_stack([pcm, pcm]).tobytes())
print("audio ok", DUR, "voice peak", float(np.max(np.abs(voice))), "music peak", float(np.max(np.abs(music))))
