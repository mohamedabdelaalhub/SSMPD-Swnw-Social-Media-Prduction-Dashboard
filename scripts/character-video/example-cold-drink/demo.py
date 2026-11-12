#!/usr/bin/env python3
"""Animation features demo: walk, wave, blink, talk (lip-sync from the voice envelope), jump."""
import os, sys, math, subprocess, wave
import numpy as np
sys.path.insert(0, '.')
import anim4 as A
S = os.environ.get("WORK", ".")
KIT = os.environ.get("KIT", S + "/kit"); FPS = 24; DUR = 10.4; PLACE = 3.2
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", KIT + "/voice.mp3", "-f", "f32le", "-ac", "1", "-ar", "44100", "-"], capture_output=True).stdout
vo = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
SL = vo[:int(5.75 * 44100)]
win = int(44100 / FPS)
rms = np.array([np.sqrt(np.mean(SL[i:i + win] ** 2)) for i in range(0, len(SL) - win, win)])
p95 = np.percentile(rms, 95)
env = np.clip(rms / p95, 0, 1) ** 0.8
env = np.convolve(env, [0.25, 0.5, 0.25], mode="same")
def mouth(t):
    i = int(round((t - PLACE) * FPS))
    return float(env[i]) if 0 <= i < len(env) else 0.0
CAPS = [(0.0, 1.34, "بتشرب ساقع"), (1.34, 2.92, "زي اللي بيفكك *قنبلة؟*"), (2.92, 4.38, "بيقرّبها *بحذر*..."), (4.38, 5.75, "والسنّة *بتترعش!*")]
def html(s):
    parts = s.split('*'); return "".join(f'<tspan fill="#F15A22">{p}</tspan>' if i % 2 else p for i, p in enumerate(parts))
WALK_END = 2.8; TALK0 = PLACE; TALK1 = PLACE + 5.75; JUMP0 = 9.0
def frame(t):
    o = f'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">' + A.background(0)
    p = {"y": 1580, "s": 1.65}
    blink = (t % 2.3) < 0.13
    if t < WALK_END:
        p["x"] = A.lerp(-170, 380, A.ss(t / WALK_END) * 0.6 + (t / WALK_END) * 0.4)
        ph = t * 9.5; p["walk"] = ph
        p["aL"] = (-64 + 24 * math.sin(ph), -318); p["aR"] = (64 - 24 * math.sin(ph), -318)
        p["jump"] = abs(math.sin(ph)) * 7; p["kind"] = "blink" if blink else "normal"
    else:
        p["x"] = 380; p["jump"] = 0
        if t < TALK0:   # wave hello
            p["aR"] = (118 + 16 * math.sin(t * 15), -548 + 12 * math.sin(t * 15)); p["aL"] = (-70, -318); p["kind"] = "happy"
        elif t < TALK1:  # talk + gestures
            u = t - TALK0
            p["aL"] = (-96 + 14 * math.sin(u * 3.1), -400 + 36 * math.sin(u * 2.3))
            p["aR"] = (100 - 10 * math.sin(u * 2.7), -380 + 30 * math.sin(u * 3.4 + 1))
            p["kind"] = "talk_blink" if blink else "talk"; p["mo"] = mouth(t)
            p["lean"] = 2.2 * math.sin(u * 2.0)
        else:
            p["aL"] = (-90, -520); p["aR"] = (92, -520); p["kind"] = "happy"
            if t >= JUMP0:
                u = (t - JUMP0) % 0.6; p["jump"] = 90 * math.sin(math.pi * u / 0.6) ** 0.9
                p["aL"] = (-100, -600); p["aR"] = (100, -600)
    o += A.shadow(p["x"], p["y"], p["s"], p.get("jump", 0)) + A.abu(p)
    for a, b, h in CAPS:
        o += A.capbox(t, a + PLACE, b + PLACE, html(h))
    o += A.chrome()
    if t < 0.25: o += f'<rect width="1080" height="1920" fill="#fff" opacity="{1-t/0.25:.2f}"/>'
    if t > DUR - 0.3: o += f'<rect width="1080" height="1920" fill="#fff" opacity="{(t-(DUR-0.3))/0.3:.2f}"/>'
    return o + '</svg>'
if __name__ == "__main__":
    d = S + "/fr_demo"; os.makedirs(d, exist_ok=True)
    for i in range(int(DUR * FPS)): open(f"{d}/f_{i:04d}.svg", "w").write(frame(i / FPS))
    # audio: voice + footsteps + wave pop + boing
    SR = 44100; N = int(DUR * SR); mix = np.zeros(N)
    def add(sig, t0, g=1.0):
        i = int(t0 * SR); seg = sig[:max(0, N - i)]; mix[i:i + len(seg)] += seg * g
    tt = lambda d: np.arange(int(d * SR)) / SR
    thud = lambda: np.sin(2 * np.pi * 110 * tt(0.07)) * np.exp(-tt(0.07) * 45)
    pop = lambda: np.sin(2 * np.pi * np.cumsum(480 + 900 * tt(0.14) / 0.14) / SR) * np.exp(-tt(0.14) * 28)
    boing = lambda: np.sin(2 * np.pi * np.cumsum(180 + 520 * np.abs(np.sin(2 * np.pi * 3.2 * tt(0.5))) * np.exp(-tt(0.5) * 3)) / SR) * np.exp(-tt(0.5) * 5)
    k = 0
    while k * math.pi / 9.5 < WALK_END: add(thud(), k * math.pi / 9.5, 0.5); k += 1
    add(pop(), WALK_END, 0.3); add(pop(), 0.3, 0.2)
    for j in (0, 1): add(boing(), JUMP0 + j * 0.6, 0.35)
    seg = SL.copy(); n = int(0.015 * SR); seg[:n] *= np.linspace(0, 1, n); seg[-n:] *= np.linspace(1, 0, n)
    add(seg, PLACE, 1.0)
    mix = mix / max(1e-9, np.max(np.abs(mix))) * 0.9
    pcm = (mix * 32767).astype(np.int16)
    with wave.open(S + "/audio_demo.wav", "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(np.column_stack([pcm, pcm]).tobytes())
    print("demo frames", int(DUR * FPS))
