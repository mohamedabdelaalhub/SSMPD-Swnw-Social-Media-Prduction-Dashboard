#!/usr/bin/env python3
"""Swnw stickman test video: 'اللي بيشرب ساقع بحذر'. Generates SVG frames (1080x1920, 24fps)."""
import math, os, sys, random

import json as _json
try:
    SCH = _json.load(open(os.environ.get("SCH", "sched.json")))
except Exception:
    SCH = {"fin": 999, "dur": 30, "caps": [], "cards": [], "speak": [], "pops": []}
FIN = SCH["fin"]
W, H, FPS, DUR = 1080, 1920, 24, SCH["dur"]
INK = "#1c1c24"; SKIN = "#f4cfa4"
BLUE = "#0F369D"; NAVY = "#16212E"; ORG = "#F15A22"; CYAN = "#0F369D"; PANEL = "#F3F6FC"; DARK = "#16212E"; ICE = "#6EC6F5"
HAIR = "#3a2a22"
FONT = "BigVesta Arabic, Hiragino Kaku, DejaVu Sans, Arial"

import base64
REPO = os.environ.get("SSMPD_REPO", os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))
try:
    LOGO_URI = "data:image/png;base64," + base64.b64encode(open(os.environ.get("KIT", ".") + "/sono_logo_web.png", "rb").read()).decode()
except Exception:
    LOGO_URI = ""
# ---------- helpers ----------
def cl(x, a=0.0, b=1.0): return max(a, min(b, x))
def ss(x): x = cl(x); return x * x * (3 - 2 * x)
def lerp(a, b, u): return a + (b - a) * u
def mix(v0, v1, u):
    if isinstance(v0, tuple): return tuple(lerp(a, b, u) for a, b in zip(v0, v1))
    return lerp(v0, v1, u)
def kf(t, keys):
    if t <= keys[0][0]: return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            return mix(v0, v1, ss((t - t0) / (t1 - t0)) if t1 > t0 else 1)
    return keys[-1][1]
def pop(t, t0, dur=0.22):
    u = cl((t - t0) / dur)
    if u <= 0: return 0.0
    return ss(u) + 0.15 * math.sin(u * math.pi)

def P(d, fill="none", w=6, c=INK, extra=""):
    return f'<path d="{d}" fill="{fill}" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" {extra}/>'
def Ci(x, y, r, fill=SKIN, w=6, c=INK): return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{fill}" stroke="{c}" stroke-width="{w}"/>'
def El(x, y, rx, ry, fill, w=0, c=INK, op=1): return f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{fill}" fill-opacity="{op}" stroke="{c}" stroke-width="{w}"/>'
def T(x, y, s, size=40, c=INK, w=700, stroke=None, sw=0, anchor="middle", op=1):
    st = f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" paint-order="stroke"' if stroke else ''
    return f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" font-family="{FONT}" font-size="{size}" font-weight="{w}" fill="{c}" fill-opacity="{op}" direction="rtl"{st}>{s}</text>'
def tube(pts, w, col):
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    return (f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{w+8}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')
def shoe(x, y, d=1, col=ORG):
    return (P(f"M{x-14*d},{y-24} L{x+10*d},{y-24} Q{x+46*d},{y-22} {x+50*d},{y-4} L{x-14*d},{y-4} Z", col, 6)
            + P(f"M{x-14*d},{y-4} L{x+50*d},{y-4}", "none", 5, "#f4f4f4"))
def hand(x, y, r=13, col=SKIN): return Ci(x, y, r, col, 5)
def G(x, y, s, inner, rot=0, extra=""):
    return f'<g transform="translate({x:.1f},{y:.1f}) rotate({rot:.2f}) scale({s:.4f})" {extra}>{inner}</g>'

def ik(S, Wt, side, l1=88, l2=76):
    dx, dy = Wt[0] - S[0], Wt[1] - S[1]
    dist = max(math.hypot(dx, dy), 1e-6)
    ux, uy = dx / dist, dy / dist
    d = max(abs(l1 - l2) + 1, min(l1 + l2 - 1, dist))
    Wc = (S[0] + ux * d, S[1] + uy * d)
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(l1 * l1 - a * a, 0))
    px, py = -uy, ux
    c1 = (S[0] + ux * a + px * h, S[1] + uy * a + py * h)
    c2 = (S[0] + ux * a - px * h, S[1] + uy * a - py * h)
    pick = lambda c: c[1] + 0.4 * side * c[0]
    return (c1 if pick(c1) > pick(c2) else c2), Wc

# ---------- face ----------
def face(kind="normal", glasses=False, mustache=False, lash=False, r=60, mo=0.0, bare=False):
    s = "" if bare else Ci(-r, 0, 11, SKIN, 5) + Ci(r, 0, 11, SKIN, 5) + Ci(0, 0, r, SKIN, 6)
    ex = 22
    def eye(sx, px=0, py=0, pr=6, rx=13, ry=15):
        return El(sx, -8, rx, ry, "#fff", 4) + Ci(sx + px, -8 + py, pr, INK, 0) + Ci(sx + px + 2, -8 + py - 2, 2, "#fff", 0)
    brow = lambda sx, dy=0, tilt=0: P(f"M{sx-12},{-34+dy+tilt} Q{sx},{-42+dy} {sx+12},{-34+dy-tilt}", "none", 5)
    closed = kind == "talk_blink"
    if closed: kind = "talk"
    if kind in ("normal", "talk"):
        if closed:
            s += P(f"M{-ex-12},-6 Q{-ex},2 {-ex+12},-6", "none", 5) + P(f"M{ex-12},-6 Q{ex},2 {ex+12},-6", "none", 5) + brow(-ex) + brow(ex)
        else:
            s += eye(-ex) + eye(ex) + brow(-ex) + brow(ex)
        if kind == "talk":
            op = 0.15 + 0.85 * mo
            s += El(0, 36, 8 + 3 * op, 2 + 8 * op, INK)
            if op > 0.6: s += El(0, 40 + 3 * op, 5 + op, 2 + op, "#e8736a")
        else:
            s += P("M-14,34 Q0,46 14,34", "none", 5)
    elif kind == "blink":
        s += P(f"M{-ex-12},-6 Q{-ex},2 {-ex+12},-6", "none", 5) + P(f"M{ex-12},-6 Q{ex},2 {ex+12},-6", "none", 5)
        s += brow(-ex) + brow(ex) + P("M-14,34 Q0,46 14,34", "none", 5)
    elif kind == "scared":
        s += eye(-ex, 0, 2, 4) + eye(ex, 0, 2, 4)
        s += P(f"M{-ex-14},-28 L{-ex+10},-40", "none", 5) + P(f"M{ex+14},-28 L{ex-10},-40", "none", 5)
        s += El(0, 36, 12, 16, INK) + El(0, 42, 7, 6, "#d9473a")
        s += f'<path d="M{r+8},-40 q10,18 0,26 q-10,-8 0,-26z" fill="#6ec3f4" stroke="{INK}" stroke-width="3"/>'
    elif kind == "ouch":
        s += P(f"M{-ex-12},-18 L{-ex+10},-2 M{-ex-12},-2 L{-ex+10},-18", "none", 6) + P(f"M{ex-10},-18 L{ex+12},-2 M{ex-10},-2 L{ex+12},-18", "none", 6)
        s += P(f"M{-ex-14},-32 L{-ex+10},-40", "none", 5) + P(f"M{ex+14},-32 L{ex-10},-40", "none", 5)
        s += P("M-22,50 Q0,24 22,50 Z", "#fff", 5) + P("M-14,46 Q0,38 14,46", "none", 3, "#e8736a")
    elif kind == "happy":
        s += P(f"M{-ex-12},-6 Q{-ex},-22 {-ex+12},-6", "none", 6) + P(f"M{ex-12},-6 Q{ex},-22 {ex+12},-6", "none", 6)
        s += P("M-24,28 Q0,62 24,28 Z", "#fff", 5) + P("M-12,46 Q0,56 12,46 Q0,38 -12,46 Z", "#e8736a", 0)
        s += El(-40, 20, 10, 6, "#f2a09a") + El(40, 20, 10, 6, "#f2a09a")
    elif kind == "surprised":
        s += eye(-ex, 0, 0, 5, 15, 18) + eye(ex, 0, 0, 5, 15, 18) + brow(-ex, -12) + brow(ex, -12) + El(0, 36, 9, 12, INK)
    elif kind == "thinking":
        s += eye(-ex, 6, -4) + eye(ex, 6, -4)
        s += P(f"M{-ex-12},-30 Q{-ex},-36 {-ex+12},-32", "none", 5) + P(f"M{ex-12},-40 Q{ex},-54 {ex+14},-40", "none", 5)
        s += P("M-12,36 L14,30", "none", 5)
    if not mustache and not bare and kind not in ("surprised",): s += P("M0,4 Q-6,13 2,13", "none", 4)
    if lash and kind in ("normal", "happy"): s += P(f"M{-ex-12},-14 l-7,-5 M{ex+12},-14 l7,-5", "none", 4)
    if mustache: s += P("M-18,19 Q-9,9 0,17 Q9,9 18,19 Q9,25 0,21 Q-9,25 -18,19 Z", HAIR, 3)
    if glasses:
        s += (f'<circle cx="{-ex}" cy="-8" r="22" fill="#ffffff" fill-opacity="0.25" stroke="#5a3a24" stroke-width="6"/>'
              f'<circle cx="{ex}" cy="-8" r="22" fill="#ffffff" fill-opacity="0.25" stroke="#5a3a24" stroke-width="6"/>'
              + P("M-2,-10 L2,-10", "none", 5, "#5a3a24") + P(f"M{-ex-22},-10 L{-r},-6 M{ex+22},-10 L{r},-6", "none", 4, "#5a3a24"))
    return s

# ---------- glass ----------
GL = 96  # hand -> rim
def glass(water=0.7, shake=0):
    gl = f'<g transform="translate({shake:.1f},0)">'
    body = "M-17,14 L17,14 L25,-82 L-25,-82 Z"
    lvl = -82 + (1 - water) * 96
    gl += f'<path d="{body}" fill="#dff4ff" fill-opacity="0.55" stroke="#4aa8d6" stroke-width="5" stroke-linejoin="round"/>'
    gl += f'<clipPath id="gclip"><path d="{body}"/></clipPath><g clip-path="url(#gclip)"><rect x="-30" y="{lvl:.1f}" width="60" height="110" fill="#7fd0f5" fill-opacity="0.8"/></g>'
    gl += f'<rect x="-14" y="{lvl-6:.1f}" width="17" height="17" rx="3" fill="#ffffff" fill-opacity="0.85" stroke="#9ed8f0" stroke-width="3" transform="rotate(-12 -6 {lvl:.1f})"/>'
    gl += f'<rect x="3" y="{lvl-1:.1f}" width="15" height="15" rx="3" fill="#ffffff" fill-opacity="0.85" stroke="#9ed8f0" stroke-width="3" transform="rotate(14 10 {lvl:.1f})"/>'
    gl += '<path d="M-12,-70 L-9,-20" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.8"/>'
    gl += '<circle cx="14" cy="-30" r="2.5" fill="#ffffff"/><circle cx="-4" cy="-8" r="2" fill="#ffffff"/></g>'
    return gl

# ---------- characters ----------
def abu(p):
    x, y, s = p["x"], p["y"], p["s"]
    kind = p.get("kind", "normal"); lean = p.get("lean", 0); j = p.get("jump", 0)
    hdx, hdy, ht = p.get("hdx", 0), p.get("hdy", 0), p.get("ht", 0)
    SL, SR = (-44, -428), (44, -428)
    o = ""
    # legs
    wk = p.get("walk")
    if wk is None:
        o += tube([(-26, -250), (-40, -130), (-44, -30)], 24, NAVY) + tube([(26, -250), (44, -130), (58, -30)], 24, NAVY)
        o += shoe(-44, 0, -1, BLUE) + shoe(58, 0, 1, BLUE)
    else:
        for side, ph in ((-1, wk), (1, wk + math.pi)):
            lift = max(0.0, math.sin(ph)) * 44; sw = math.cos(ph) * 14
            hip = (side * 26, -250); ank = (side * 46 + sw, -30 - lift)
            knee = ((hip[0] + ank[0]) / 2 + side * 6, (hip[1] + ank[1]) / 2 - lift * 0.25)
            o += tube([hip, knee, ank], 24, NAVY) + shoe(ank[0], -lift, side, BLUE)
    up = f'<g transform="rotate({lean:.2f} 0 -250)">'
    aL = p.get("aL"); aR = p.get("aR")
    def arm(S, Wt, side, front_hand=True):
        E, Wc = ik(S, Wt, side)
        return tube([S, E], 20, ORG) + tube([E, Wc], 13, SKIN), Wc
    armL, wL = arm(SL, aL, -1)
    armR, wR = arm(SR, aR, 1)
    if not p.get("aL_front"): up += armL + hand(*wL)
    up += P("M-54,-440 Q0,-462 54,-440 L48,-248 Q0,-232 -48,-248 Z", ORG, 6) + P("M-18,-452 L0,-420 L18,-452", "#fff", 5)
    up += P("M-48,-262 L48,-262", "none", 12, NAVY) + f'<rect x="-9" y="-270" width="18" height="16" fill="#ffffff" stroke="{INK}" stroke-width="3"/>'
    up += tube([(0, -462), (0, -438)], 16, SKIN)
    up += f'<g transform="translate({hdx:.1f},{hdy:.1f}) rotate({ht:.2f} 0 -470)">'
    up += f'<g transform="translate(0,-520)">{face(kind, glasses=True, mustache=True, mo=p.get("mo", 0))}</g>'
    up += P("M-58,-545 Q-52,-606 -12,-596 Q8,-622 38,-598 Q68,-582 58,-538 Q42,-566 22,-560 Q2,-578 -20,-562 Q-40,-562 -58,-545 Z", HAIR, 5)
    up += '</g>'
    if p.get("aL_front"): up += armL + hand(*wL)
    g = p.get("glass")
    up += armR
    if g is not None:
        up += f'<g transform="translate({wR[0]:.1f},{wR[1]:.1f}) rotate({g["theta"]:.2f})">{glass(g.get("water", .7), g.get("shake", 0))}</g>'
    up += hand(*wR) + '</g>'
    return G(x, y - j * s, s, o + up)

def tooth(p):
    x, y, s = p["x"], p["y"], p["s"]
    kind = p.get("kind", "scared"); fill = p.get("fill", "#ffffff"); legs = p.get("legs", True)
    rot = p.get("rot", 0)
    o = ""
    if legs:
        o += tube([(-22, -200), (-28, -34)], 11, INK) + tube([(24, -200), (30, -34)], 11, INK)
        o += shoe(-28, 0, -1, ORG) + shoe(30, 0, 1, ORG)
    SL, SR = (-62, -340), (62, -340)
    def arm(S, Wt, side):
        E, Wc = ik(S, Wt, side, 50, 50)
        return tube([S, E, Wc], 10, "#ffffff") + Ci(Wc[0], Wc[1], 16, "#ffffff", 5)
    o += arm(SL, p.get("aL", (-120, -290)), -1) + arm(SR, p.get("aR", (120, -300)), 1)
    body = "M-66,-390 Q-78,-486 -30,-486 Q0,-466 30,-486 Q78,-486 66,-390 Q64,-300 44,-206 Q28,-196 22,-258 Q0,-284 -22,-258 Q-28,-196 -44,-206 Q-64,-300 -66,-390 Z"
    o += P(body, fill, 7)
    o += P("M48,-452 Q62,-400 52,-330", "none", 6, "#d6e9f5") + P("M-46,-452 Q-56,-420 -52,-390", "none", 5, "#eef6fb")
    o += f'<g transform="translate(0,-388) scale(0.95)">{face(kind, bare=True)}</g>'
    o += El(-36, -366, 11, 7, "#f2a09a") + El(36, -366, 11, 7, "#f2a09a")
    if p.get("frost", 0) > 0:
        f = p["frost"]
        for (cx, cy, r) in [(-40, -450, 14), (30, -470, 12), (50, -400, 10), (-52, -380, 11)]:
            o += f'<path d="M{cx-r},{cy} L{cx+r},{cy} M{cx},{cy-r} L{cx},{cy+r} M{cx-r*.7},{cy-r*.7} L{cx+r*.7},{cy+r*.7} M{cx+r*.7},{cy-r*.7} L{cx-r*.7},{cy+r*.7}" stroke="#4aa8d6" stroke-width="4" stroke-linecap="round" opacity="{f}"/>'
    return G(x, y, s, o, rot)

def doctor(p):
    x, y, s = p["x"], p["y"], p["s"]
    kind = p.get("kind", "talk"); mo = p.get("mo", 0); j = p.get("jump", 0)
    SL, SR = (-50, -428), (50, -428)
    o = tube([(-24, -210), (-30, -120), (-34, -34)], 22, NAVY) + tube([(24, -210), (30, -120), (38, -34)], 22, NAVY)
    o += shoe(-34, 0, -1, "#f2f2f2") + shoe(38, 0, 1, "#f2f2f2")
    EL, WL = ik(SL, p.get("aL", (-110, -300)), -1)
    ER, WR = ik(SR, p.get("aR", (70, -330)), 1)
    o += tube([SL, EL], 20, "#ffffff") + tube([EL, WL], 13, SKIN) + hand(*WL)
    o += tube([SR, ER], 20, "#ffffff") + tube([ER, WR], 13, SKIN)
    o += (f'<g transform="translate({WR[0]:.1f},{WR[1]:.1f}) rotate(8)"><rect x="-26" y="-44" width="52" height="70" rx="5" fill="#d9b27a" stroke="{INK}" stroke-width="5"/>'
          f'<rect x="-18" y="-32" width="36" height="48" fill="#fff" stroke="{INK}" stroke-width="2"/><path d="M-14,-20 h28 M-14,-10 h28 M-14,0 h22" stroke="{CYAN}" stroke-width="3"/>'
          f'<rect x="-12" y="-50" width="24" height="10" rx="3" fill="#8a8a92" stroke="{INK}" stroke-width="3"/></g>')
    o += hand(*WR)
    o += P("M-62,-440 Q0,-466 62,-440 L78,-190 Q0,-174 -78,-190 Z", "#ffffff", 6) + P("M0,-446 L0,-196", "none", 4, "#c9c9d2")
    o += P("M-24,-452 L0,-392 L-30,-410 Z", PANEL, 5) + P("M24,-452 L0,-392 L30,-410 Z", PANEL, 5) + P("M-22,-446 L0,-400 L22,-446", CYAN, 4)
    o += P("M-24,-446 Q-38,-372 0,-362 Q38,-372 24,-446", "none", 5, "#2a2f3d") + Ci(0, -352, 10, "#bfc7d0", 4)
    o += f'<rect x="30" y="-384" width="30" height="20" rx="3" fill="{CYAN}" stroke="{INK}" stroke-width="3"/><path d="M35,-376 h20 M35,-370 h12" stroke="#fff" stroke-width="2.5"/>'
    o += tube([(0, -464), (0, -440)], 16, SKIN)
    o += f'<g transform="translate(0,-520)">{face(kind, mo=mo)}</g>'
    o += P("M-60,-530 Q-56,-596 4,-592 Q60,-590 60,-532 Q40,-566 8,-562 Q-30,-560 -60,-530 Z", "#2a2020", 5)
    return G(x, y - j * s, s, o)

# ---------- scene pieces ----------
def caption(t, t0, t1, lines, size=64, col="#ffffff", y=250, strk=BLUE):
    if not (t0 <= t < t1): return ""
    u = pop(t, t0, 0.2)
    fade = 1 - ss((t - (t1 - 0.15)) / 0.15) if t > t1 - 0.15 else 1
    out = ""
    for i, ln in enumerate(lines):
        out += T(0, i * (size + 18), ln, size, col, 800, strk, 16)
    return f'<g transform="translate(540,{y}) scale({max(u,0.001):.3f})" opacity="{fade:.2f}">{out}</g>'

def capbox(t, t0, t1, html, y=1450):
    if not (t0 <= t < t1): return ""
    u = pop(t, t0, 0.18)
    fade = 1 - ss((t - (t1 - 0.12)) / 0.12) if t > t1 - 0.12 else 1
    return (f'<g class="cap" transform="translate(540,{y}) scale({max(u,0.001):.3f})" opacity="{fade:.2f}">'
            f'<rect class="capr2" x="-200" y="-44" width="400" height="100" rx="28" fill="{ORG}" fill-opacity="0.9"/>'
            f'<rect class="capr" x="-200" y="-50" width="400" height="100" rx="28" fill="{BLUE}" stroke="#ffffff" stroke-width="4"/>'
            f'<text class="capt" x="0" y="18" text-anchor="middle" font-family="{FONT}" font-size="64" font-weight="700" fill="#ffffff" direction="rtl">{html}</text></g>')
def hl(w): return f'<tspan fill="#FFB089">{w}</tspan>'

def card(t, t0, t1, idx, text, y):
    if not (t0 <= t < t1 + 0.4): return ""
    u = pop(t, t0, 0.25)
    sl = ss((t - t1) / 0.4)  # slide out to the right
    ox = sl * 1200
    out = (f'<rect x="-360" y="-58" width="720" height="116" rx="30" fill="#ffffff" stroke="{BLUE}" stroke-width="6"/>'
           f'<circle cx="300" cy="0" r="40" fill="{ORG}" stroke="{BLUE}" stroke-width="5"/>' + T(300, 17, str(idx), 50, "#ffffff", 800)
           + T(-30, 16, text, 46, BLUE, 800))
    return f'<g transform="translate({540+ox:.1f},{y}) scale({max(u,0.001):.3f})">{out}</g>'

def burst(cx, cy, r1, r2, n=14, rot=0):
    pts = []
    for i in range(n * 2):
        r = r2 if i % 2 == 0 else r1
        a = rot + i * math.pi / n
        pts.append(f"{cx + r*math.cos(a):.1f},{cy + r*math.sin(a):.1f}")
    return f'<polygon points="{" ".join(pts)}" fill="{ORG}" stroke="{BLUE}" stroke-width="10" stroke-linejoin="round"/>'

def background(t):
    o = (f'<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DDE9FA"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>'
         f'<radialGradient id="mouth" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#c44a58"/><stop offset="1" stop-color="#6e1a28"/></radialGradient></defs>')
    o += f'<rect width="{W}" height="{H}" fill="url(#bg)"/>'
    o += f'<circle cx="940" cy="360" r="260" fill="{CYAN}" opacity="0.07"/><circle cx="120" cy="1100" r="300" fill="{ORG}" opacity="0.06"/>'
    fy = kf(t, [(FIN, 1560), ((FIN+0.9), 1500)])
    o += f'<rect x="0" y="{fy:.0f}" width="{W}" height="{H-fy:.0f}" fill="#D3E2F7"/><rect x="0" y="{fy-4:.0f}" width="{W}" height="8" fill="#B7CCEA"/>'
    return o

def chrome():
    return (f'<defs><linearGradient id="topg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{BLUE}" stop-opacity="0.95"/><stop offset="0.6" stop-color="{BLUE}" stop-opacity="0.55"/><stop offset="1" stop-color="{BLUE}" stop-opacity="0"/></linearGradient></defs>'
            f'<rect x="0" y="0" width="{W}" height="290" fill="url(#topg)"/>'
            f'<image href="{LOGO_URI}" x="34" y="40" width="250" height="106"/>')

def shadow(x, y, s, jump):
    k = 1 - cl(jump / 160) * 0.4
    return El(x, y + 6, 150 * s * k * 0.85, 22 * s * k * 0.85, "#0C3096", 0, INK, 0.16)

# ---------- timeline ----------
IMPACT = 9.9
def abu_pose(t):
    x, y, s = kf(t, [(0, (380, 1580, 1.65)), (16.3, (380, 1580, 1.65)), (17.5, (270, 1640, 1.3)), (FIN, (270, 1640, 1.3)), ((FIN+0.9), (210, 1540, 1.0))])
    p = {"x": x, "y": y, "s": s}
    # ---- first approach (stop/start) ----
    prog = kf(t, [(0, 0), (4.0, 0), (5.0, 0.32), (5.6, 0.32), (6.6, 0.62), (7.5, 0.62), (8.7, 0.9), (9.2, 0.9), (9.75, 1.0)])
    thF = -35.0; Mx, My = 6, -486
    WF = (Mx - GL * math.sin(math.radians(thF)), My + GL * math.cos(math.radians(thF)))
    W0 = (74, -322)
    # ---- second approach: other side of the mouth, braver and faster ----
    th2 = -44.0; M2 = (-14, -484)
    WF2 = (M2[0] - GL * math.sin(math.radians(th2)), M2[1] + GL * math.cos(math.radians(th2)))
    prog2 = kf(t, [(13.0, 0), (13.9, 0.55), (14.2, 0.55), (14.7, 1.0)])
    if t < IMPACT:
        shake = math.sin(t * 38) * (0.6 + 2.6 * prog)
        wr = (lerp(W0[0], WF[0], prog) + shake * 0.5, lerp(W0[1], WF[1], prog))
        p["aR"] = wr
        p["glass"] = {"theta": lerp(-6, thF, prog), "water": 0.72, "shake": shake * 0.3}
    elif t < 13.0:
        p["aR"] = kf(t, [(IMPACT, WF), (IMPACT + 0.25, (118, -585)), (IMPACT + 0.9, (112, -560)), (11.8, (84, -300)), (13.0, (84, -300))])
    elif t < 16.2:
        if t < 14.7:
            sh = math.sin(t * 40) * (0.4 + 2.2 * prog2)
            p["aR"] = (lerp(W0[0], WF2[0], prog2) + sh * 0.5, lerp(W0[1], WF2[1], prog2))
            p["glass"] = {"theta": lerp(-6, th2, prog2), "water": 0.72, "shake": sh * 0.3}
        else:
            back = ss((t - 15.3) / 0.7)
            p["aR"] = (lerp(WF2[0], 84, back), lerp(WF2[1], -300, back))
            p["glass"] = {"theta": lerp(th2, -6, back), "water": 0.6, "shake": 0}
    else:
        p["aR"] = kf(t, [(16.2, (84, -300)), (16.4, (72, -300)), ((FIN-0.2), (72, -300)), ((FIN+0.6), (100, -540))])
    # ---- left arm ----
    if t < 5.0:
        p["aL"] = (-27, -452); p["aL_front"] = True
    elif t < IMPACT:
        p["aL"] = kf(t, [(5.0, (-27, -452)), (5.8, (-72, -332)), (IMPACT, (-72, -332))]); p["aL_front"] = t < 5.4
    elif t < 12.0:
        p["aL"] = kf(t, [(IMPACT, (-72, -332)), (IMPACT + 0.2, (-46, -500))]); p["aL_front"] = True
    elif t < 13.0:
        p["aL"] = (-27, -452); p["aL_front"] = True
    elif t < 14.7:
        p["aL"] = (-74, -326); p["aL_front"] = False
    elif t < 15.7:
        p["aL"] = kf(t, [(14.7, (-74, -326)), (14.9, (-46, -500))]); p["aL_front"] = True
    elif t < 16.4:
        p["aL"] = (-27, -452); p["aL_front"] = True
    elif t < FIN:
        p["aL"] = (-70 + 4 * math.sin(t * 2), -300); p["aL_front"] = False
    else:
        p["aL"] = (-104 - 10 * math.sin(t * 9), -560 + 12 * math.sin(t * 9)); p["aL_front"] = False
    # ---- face ----
    blink = (int(t * 10) % 31 == 0) and 16.4 < t < FIN
    if t < 5.0: p["kind"] = "thinking"
    elif t < IMPACT: p["kind"] = "scared"
    elif t < 11.8: p["kind"] = "ouch"
    elif t < 14.2: p["kind"] = "thinking"
    elif t < 14.7: p["kind"] = "scared"
    elif t < 15.7: p["kind"] = "ouch"
    elif t < 16.4: p["kind"] = "thinking"
    elif t < FIN: p["kind"] = "blink" if blink else "normal"
    else: p["kind"] = "happy"
    # ---- jumps / wobble ----
    jump = 0
    if IMPACT <= t < IMPACT + 0.7:
        jump = 110 * math.sin(math.pi * (t - IMPACT) / 0.7) ** 0.9
    if 14.7 <= t < 15.1:
        jump = 34 * math.sin(math.pi * (t - 14.7) / 0.4)
    p["jump"] = jump
    if IMPACT <= t < IMPACT + 1.6:
        p["ht"] = 8 * math.sin((t - IMPACT) * 28) * (1 - (t - IMPACT) / 1.6); p["lean"] = -6 * (1 - (t - IMPACT) / 1.6)
    elif 13.0 <= t < 14.7:
        p["ht"] = 10 * prog2
    elif 14.7 <= t < 15.7:
        p["ht"] = 6 * math.sin((t - 14.7) * 30) * (1 - (t - 14.7))
    elif t >= (FIN+0.2):
        p["lean"] = 3 * math.sin(t * 6)
    if t > (FIN+0.9): p["jump"] = abs(math.sin(t * 5)) * 16
    return p

def tooth_bubble_pose(t):
    p = {"x": 0, "y": 0, "s": 1, "legs": False}
    if t < IMPACT:
        prog = kf(t, [(3.8, 0), (9.7, 1)])
        p["rot"] = math.sin(t * 30) * (1 + 5 * prog)
        p["x"] = math.sin(t * 41) * (1 + 5 * prog)
        p["kind"] = "scared"
        p["aL"] = (-100 + 8 * math.sin(t * 20), -330 - 20 * prog); p["aR"] = (100 - 8 * math.sin(t * 22), -330 - 20 * prog)
    else:
        tau = t - IMPACT
        p["rot"] = math.sin(tau * 36) * 9 * max(0, 1 - tau / 1.8)
        p["x"] = math.sin(tau * 50) * 8 * max(0, 1 - tau / 1.8)
        p["kind"] = "ouch" if tau < 1.9 else "scared"
        p["fill"] = "#cfeefc"; p["frost"] = 1.0
        p["aL"] = (-118, -430); p["aR"] = (118, -430)
    return p

def tooth_B_pose(t):
    p = {"x": 0, "y": 0, "s": 1, "legs": False}
    if t < 14.7:
        pr = kf(t, [(13.3, 0), (14.6, 1)])
        p["rot"] = math.sin(t * 34) * (1 + 5 * pr); p["kind"] = "scared"
        p["aL"] = (-100 + 8 * math.sin(t * 20), -330 - 20 * pr); p["aR"] = (100 - 8 * math.sin(t * 22), -330 - 20 * pr)
    else:
        tau = t - 14.7
        p["rot"] = math.sin(tau * 40) * 9 * max(0, 1 - tau / 1.0); p["kind"] = "ouch"
        p["fill"] = "#cfeefc"; p["frost"] = 1.0; p["aL"] = (-118, -430); p["aR"] = (118, -430)
    return p

def frame(t):
    random.seed(int(t * FPS))
    # screen shake
    sx = sy = 0
    if IMPACT <= t < IMPACT + 0.7:
        k = 1 - (t - IMPACT) / 0.7
        sx, sy = 18 * k * math.sin(t * 95), 14 * k * math.cos(t * 83)
    elif 14.7 <= t < 15.1:
        k = 1 - (t - 14.7) / 0.4
        sx, sy = 8 * k * math.sin(t * 95), 6 * k * math.cos(t * 83)
    o = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
    o += background(t)
    o += f'<g transform="translate({sx:.1f},{sy:.1f})">'
    ab = abu_pose(t)
    # shadows
    o += shadow(ab["x"], ab["y"], ab["s"], ab.get("jump", 0))
    # doctor
    dxs, dys, dss = kf(t, [(16.4, (1380, 1640, 1.3)), (17.7, (810, 1640, 1.3)), (FIN, (810, 1640, 1.3)), ((FIN+0.9), (540, 1540, 1.0))])
    show_doc = t >= 16.4
    if show_doc:
        speaking = any(a <= t < b for a, b in SCH["speak"])
        _de = SCH.get("doc_env")
        if _de:
            _i = int(round((t - _de["t0"]) * _de["fps"]))
            mo = _de["vals"][_i] if 0 <= _i < len(_de["vals"]) else 0.0
        else:
            mo = (0.5 + 0.5 * math.sin(t * 15)) * (1 if speaking else 0)
        pose_t = t
        aL = (-108 + 6 * math.sin(t * 3), -440 + 14 * math.sin(t * 3.7)) if speaking else (-108, -310)
        if t >= (FIN+0.9): aL = (-100 - 10 * math.sin(t * 9), -560 + 10 * math.sin(t * 9))
        dp = {"x": dxs, "y": dys, "s": dss, "kind": "talk" if speaking else ("happy" if t >= (FIN+0.2) else "normal"), "mo": mo, "aL": aL, "aR": (66, -336)}
        dp["jump"] = abs(math.sin(t * 5)) * 14 if t > (FIN+1.1) else 0
        o += shadow(dxs, dys, dss, 0) + doctor(dp)
    # tooth full body in end card
    if t >= FIN:
        txs = kf(t, [(FIN, 1400), ((FIN+1.0), 870)])
        tp = {"x": txs, "y": 1540, "s": 1.0, "kind": "happy", "legs": True,
              "aL": (-110 - 8 * math.sin(t * 8), -400 + 10 * math.sin(t * 8)), "aR": (112, -310)}
        tp["y"] = 1540 - (abs(math.sin(t * 5 + 1)) * 14 if t > (FIN+1.1) else 0)
        o += shadow(txs, 1540, 1.0, 0) + tooth(tp)
    o += abu_draw(ab)
    # flying glass + splash
    o += glass_fx(t)
    o += '</g>'
    # mouth-cam bubble (first approach, then again for the second try with two teeth)
    ub = None
    if 3.7 <= t < 12.0:
        ub = pop(t, 3.7, 0.3) if t < 11.4 else 1 - ss((t - 11.4) / 0.6)
    elif 13.3 <= t < 16.7:
        ub = pop(t, 13.3, 0.3) if t < 16.0 else 1 - ss((t - 16.0) / 0.7)
    if ub is not None:
        mx, my = ab["x"] + 6 * ab["s"], ab["y"] - 488 * ab["s"]
        o += bubble(t, mx, my, 810, 1010, 200, ub)
    # captions (Swnw "box" style: white box hugging 2-5 word chunks, key word orange)
    if IMPACT <= t < 11.8:
        u = pop(t, IMPACT + 0.05, 0.25)
        o += (f'<g transform="translate(540,300) scale({max(u,0.001):.3f}) rotate({-6*math.sin(t*14):.1f})">'
              + burst(0, 0, 190, 270, 14, t * 0.4) + T(0, 46, "آآآي!", 150, "#ffffff", 900, INK, 18) + '</g>')
    for _a, _b, _h in SCH["caps"]:
        o += capbox(t, _a, _b, _h)
    if 14.7 <= t < 15.5:
        u = pop(t, 14.75, 0.2)
        o += (f'<g transform="translate(540,330) scale({max(u,0.001):.3f}) rotate({5*math.sin(t*16):.1f})">'
              + burst(0, 0, 120, 175, 12, t * 0.5) + T(0, 34, "آي!", 104, "#ffffff", 900, INK, 14) + '</g>')
    o += capbox(t, 15.5, 16.4, hl("برضه!"))
    for _c in SCH["cards"]:
        o += card(t, _c[0], FIN - 0.2, _c[1], _c[2], _c[3])
    # flash
    if IMPACT <= t < IMPACT + 0.3:
        o += f'<rect width="{W}" height="{H}" fill="#ffffff" opacity="{0.85*(1-(t-IMPACT)/0.3):.2f}"/>'
    if 14.7 <= t < 14.95:
        o += f'<rect width="{W}" height="{H}" fill="#ffffff" opacity="{0.45*(1-(t-14.7)/0.25):.2f}"/>'
    o += chrome()
    # fade in/out
    if t < 0.3: o += f'<rect width="{W}" height="{H}" fill="#ffffff" opacity="{1-t/0.3:.2f}"/>'
    if t > DUR - 0.4: o += f'<rect width="{W}" height="{H}" fill="#ffffff" opacity="{(t-(DUR-0.4))/0.4:.2f}"/>'
    o += '</svg>'
    return o

def abu_draw(ab):
    return abu(ab)

def bubble(t, mx, my, bx, by, br, u):
    tp = tooth_bubble_pose(t)
    o = f'<g transform="translate({bx},{by}) scale({max(u,0.001):.3f})">'
    # cone from mouth
    ex, ey = mx - bx, my - by
    o += f'<polygon points="{ex:.0f},{ey:.0f} -{br*0.55:.0f},-{br*0.8:.0f} -{br*0.6:.0f},{br*0.8:.0f}" fill="{BLUE}" opacity="0.10" stroke="{BLUE}" stroke-width="4" stroke-dasharray="14 10"/>'
    o += f'<clipPath id="bclip"><circle cx="0" cy="0" r="{br}"/></clipPath>'
    o += f'<circle cx="0" cy="0" r="{br}" fill="url(#mouth)"/>'
    o += '<g clip-path="url(#bclip)">'
    o += f'<rect x="-{br}" y="{br*0.55:.0f}" width="{br*2}" height="{br}" fill="#e88a99"/>'
    o += f'<rect x="-{br}" y="-{br*1.05:.0f}" width="{br*2}" height="{br*0.28:.0f}" fill="#e88a99"/>'
    o += f'<rect x="-{br+30}" y="-60" width="90" height="190" rx="36" fill="#fff" stroke="#e7d9dc" stroke-width="5"/>'
    o += f'<rect x="{br-60}" y="-60" width="90" height="190" rx="36" fill="#fff" stroke="#e7d9dc" stroke-width="5"/>'
    if t < 12.0:
        o += G(0, 170, 0.62, tooth({**tp, "x": 0, "y": 0, "s": 1}), 0)
    else:
        A = {**tp, "x": 0, "y": 0, "s": 1, "rot": 0, "kind": "ouch", "fill": "#cfeefc", "frost": 1.0, "aL": (-118, -430), "aR": (118, -430)}
        o += G(-92, 175, 0.5, tooth(A), 0) + G(92, 175, 0.5, tooth({**tooth_B_pose(t), "x": 0, "y": 0, "s": 1}), 0)
    o += '</g>'
    ring = CYAN if (IMPACT <= t < 12.0 or t >= 14.7) else BLUE
    o += f'<circle cx="0" cy="0" r="{br}" fill="none" stroke="{ring}" stroke-width="14"/>'
    o += '</g>'
    return o

def glass_fx(t):
    o = ""
    if t < IMPACT: return o
    tau = t - IMPACT
    ox, oy = 390.0, 778.0
    vx, vy, g = 430.0, -1320.0, 2970.0
    land = 1.303
    fade = 1 - ss((t - 12.4) / 0.8) if t > 12.4 else 1
    # droplets
    rnd = random.Random(7)
    for i in range(18):
        a = rnd.uniform(-math.pi, 0); sp = rnd.uniform(300, 900)
        dx, dy = math.cos(a) * sp, math.sin(a) * sp
        if tau < 0.9:
            px, py = ox + dx * tau, oy + dy * tau + 0.5 * 2400 * tau * tau
            o += f'<circle cx="{px:.1f}" cy="{py:.1f}" r="{rnd.uniform(6,14):.1f}" fill="#7fd0f5" stroke="#4aa8d6" stroke-width="3" opacity="{1-tau/0.9:.2f}"/>'
    if tau < land:
        px, py = ox + vx * tau, oy + vy * tau + 0.5 * g * tau * tau
        rot = -480 * tau
        o += f'<g transform="translate({px:.1f},{py:.1f}) rotate({rot:.1f}) scale(1.4)" opacity="{fade:.2f}"><g transform="translate(0,30)">{glass(0.35)}</g></g>'
    else:
        lt = tau - land
        px = ox + vx * land
        o += f'<g opacity="{fade:.2f}">' + El(px - 30, 1585, 70 + 120 * ss(lt / 0.6), 14 + 12 * ss(lt / 0.6), "#7fd0f5", 4, "#4aa8d6", 0.9)
        o += f'<g transform="translate({px:.1f},1560) rotate(-78) scale(1.4)"><g transform="translate(0,30)">{glass(0.1)}</g></g></g>'
        if lt < 0.6:
            rnd2 = random.Random(11)
            for i in range(10):
                a = rnd2.uniform(-math.pi * 0.95, -math.pi * 0.05); sp = rnd2.uniform(200, 520)
                qx, qy = px + math.cos(a) * sp * lt, 1580 + math.sin(a) * sp * lt + 0.5 * 2400 * lt * lt
                o += f'<circle cx="{qx:.1f}" cy="{qy:.1f}" r="8" fill="#7fd0f5" stroke="#4aa8d6" stroke-width="3" opacity="{1-lt/0.6:.2f}"/>'
    return o

def end_card(t):
    if t < 23.4: return ""
    u = ss((t - 23.4) / 0.6)
    o = f'<g opacity="{u:.2f}">'
    o += T(540, 330, "Swnw", 190, BLUE, 900) + f'<rect x="300" y="360" width="480" height="14" rx="7" fill="{ORG}"/>'
    p1 = pop(t, 24.0, 0.25); p2 = pop(t, 24.5, 0.25); p3 = pop(t, 25.3, 0.25)
    o += f'<g transform="translate(540,560) scale({max(p1,0.001):.3f})">{T(0,0,"لو الوجع بيتكرر..",78,BLUE,800,"#ffffff",14)}</g>'
    o += f'<g transform="translate(540,670) scale({max(p2,0.001):.3f})">{T(0,0,"استشر دكتور الأسنان",86,ORG,900,"#ffffff",14)}</g>'
    o += (f'<g transform="translate(540,860) scale({max(p3,0.001):.3f})"><rect x="-470" y="-62" width="940" height="124" rx="62" fill="{ORG}" stroke="{BLUE}" stroke-width="7"/>'
          + T(0, 16, "إنت من الفريق ده؟ احكيلنا في الكومنتات", 44, "#ffffff", 800) + '</g>')
    o += T(540, 1862, "للتوعية فقط — مش بديل عن الفحص عند الدكتور", 30, "#4a5a7a", 500)
    o += '</g>'
    return o

if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    if len(sys.argv) > 2:
        for tt in [float(x) for x in sys.argv[2].split(",")]:
            open(f"{out}/test_{tt:05.2f}.svg", "w").write(frame(tt))
    else:
        n = int(DUR * FPS)
        for i in range(n):
            open(f"{out}/f_{i:04d}.svg", "w").write(frame(i / FPS))
        print("frames", n)
