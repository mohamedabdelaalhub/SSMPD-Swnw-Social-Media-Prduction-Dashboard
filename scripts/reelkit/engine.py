"""Storyboard -> timeline -> SVG frames.  See README.md for the storyboard format.
Pure functions: plan(storyboard, line_timing) builds a Timeline; frame_svg(tl, t) draws one frame."""
import math, random, re
import base as B
import person as PS
import sets as SETS
import props as PROPS
import kitstyle as KS

W, H = 1080, 1920
FLOOR = 1560
BLUE, ORG = B.BLUE, B.ORG

# ---------------------------------------------------------------- gestures
IDLE_L, IDLE_R = (-66, -318), (66, -318)
def gesture(name, u, t):
    """returns dict(aL,aR,aL_front,lean,jump,kind?) for gesture `name`, u = seconds since it started."""
    s = math.sin; g = dict(aL=IDLE_L, aR=IDLE_R, aL_front=False, lean=0.0, jump=0.0)
    if name == "idle":
        g["aL"] = (-66 + 2 * s(t * 1.7), -318 + 3 * s(t * 2.1)); g["aR"] = (66 - 2 * s(t * 1.7), -318 + 3 * s(t * 2.3))
    elif name == "wave":
        g["aR"] = (118 + 16 * s(u * 15), -548 + 12 * s(u * 15)); g["kind"] = "happy"
    elif name == "point":
        g["aR"] = (150, -450 + 8 * s(u * 6)); g["aL"] = (-74, -326)
    elif name == "present":
        g["aR"] = (120, -400 + 10 * s(u * 3)); g["aL"] = (-74, -326)
    elif name == "hands_up":
        g["aL"] = (-100, -600 + 10 * s(u * 9)); g["aR"] = (100, -600 + 10 * s(u * 9 + 1)); g["kind"] = "happy"
    elif name == "hip":
        g["aL"] = (-74, -326); g["aR"] = (74, -326)
    elif name == "cheek":
        g["aL"] = (-46, -500); g["aL_front"] = True; g["kind"] = "ouch"
    elif name == "chin":
        g["aL"] = (-27, -452); g["aL_front"] = True; g["kind"] = "thinking"
    elif name == "shrug":
        k = 0.5 + 0.5 * s(u * 5); g["aL"] = (-105, -420 - 18 * k); g["aR"] = (105, -420 - 18 * k)
    elif name == "clap":
        x = 14 + 28 * abs(s(u * 12)); g["aL"] = (-x, -390); g["aR"] = (x, -390); g["kind"] = "happy"
    elif name == "thumbs":
        g["aR"] = (100, -520); g["kind"] = "happy"
    elif name == "talk_a":
        g["aL"] = (-96 + 14 * s(u * 3.1), -400 + 36 * s(u * 2.3)); g["aR"] = (100 - 10 * s(u * 2.7), -380 + 30 * s(u * 3.4 + 1)); g["lean"] = 2.2 * s(u * 2)
    elif name == "talk_b":
        g["aL"] = (-74, -326); g["aR"] = (104 + 12 * s(u * 3.3), -430 + 40 * s(u * 2.6)); g["lean"] = 1.5 * s(u * 1.7)
    elif name == "talk_c":
        g["aL"] = (-88 + 8 * s(u * 2.2), -360 + 20 * s(u * 3)); g["aR"] = (88 - 8 * s(u * 2.5), -360 + 20 * s(u * 2.7)); g["lean"] = 1.2 * s(u * 2.4)
    elif name == "nod":
        g["aL"], g["aR"] = IDLE_L, IDLE_R
    return g
TALK_GESTURES = ["talk_a", "talk_b", "talk_c"]
REACTIONS = {  # name -> (face, gesture, hop)
    "ouch": ("ouch", "cheek", 70), "scared": ("scared", "shrug", 0), "happy": ("happy", "hands_up", 30), "think": ("thinking", "chin", 0),
    "surprised": ("surprised", "hands_up", 20), "laugh": ("happy", "clap", 18), "wave": ("happy", "wave", 0), "point": ("normal", "point", 0),
    "cheer": ("happy", "hands_up", 40), "shrug": ("normal", "shrug", 0), "nod": ("normal", "nod", 0), "thumbs": ("happy", "thumbs", 0)}

def ease(u): u = max(0.0, min(1.0, u)); return u * u * (3 - 2 * u)
def lerp(a, b, u): return a + (b - a) * u

# ---------------------------------------------------------------- planning
class Timeline:
    pass

def split_chunks(text, hl):
    words = text.split()
    chunks, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= 4 or (len(cur) >= 2 and re.search(r"[،,.؟?!:]$", w)): chunks.append(cur); cur = []
    if cur:
        if chunks and len(cur) == 1: chunks[-1].extend(cur)
        else: chunks.append(cur)
    out = []
    for ch in chunks:
        s = " ".join(ch)
        for h in hl or []:
            s = s.replace(h, "*" + h + "*") if h in s and "*" not in s else s
        out.append(s)
    return out

def html_hl(s):
    parts = s.split("*"); return "".join(f'<tspan fill="#F15A22">{p}</tspan>' if i % 2 else p for i, p in enumerate(parts))

def collect_lines(sb):
    """speaker -> list of (scene_idx, beat_idx, text) in storyboard order"""
    out = {}
    for si, sc in enumerate(sb["scenes"]):
        for bi, b in enumerate(sc.get("beats", [])):
            sy = b.get("say")
            if sy: out.setdefault(sb["cast"][sy["who"]].get("voice", "narrator"), []).append((si, bi, sy["text"]))
    return out

def plan(sb, line_timing, seed=1):
    """line_timing[(si,bi)] = dict(dur=seconds, words=[(chunk_text, t0, t1)] or None)"""
    rnd = random.Random(sb.get("meta", {}).get("seed", seed))
    tl = Timeline(); tl.scenes = []; tl.actors = {}; tl.caps = []; tl.cards = []; tl.fx = []; tl.sfx = []; tl.voice = []; tl.setprops = []; tl.bubbles = []
    for aid, a in sb["cast"].items():
        tl.actors[aid] = dict(look=a["look"], x=[], s=[], y=FLOOR + 20, faces=[], gest=[], props=[], say=[], walk=[], jumps=[], vis=[], z=len(tl.actors))
    t = 0.0
    for si, sc in enumerate(sb["scenes"]):
        scene = dict(i=si, t0=t, set=sc.get("set", "living"), cam=sc.get("cam", {}), trans=sc.get("trans", "cut" if si == 0 else "fade"), floor=sc.get("floor", FLOOR))
        for aid, st in sc.get("actors", {}).items():
            a = tl.actors[aid]
            a["vis"].append([t, None])
            a["x"].append((t, st.get("x", 0.5) * W)); a["s"].append((t, st.get("s", 1.5)))
            if st.get("face"): a["faces"].append((t, t + 99, st["face"]))
            if st.get("prop"): a["props"].append((t, st["prop"]))
        if sc.get("sfx_in"): tl.sfx.append((t, sc["sfx_in"], 0.4))
        for bi, b in enumerate(sc.get("beats", [])):
            dur = 0.0
            def A(aid): return tl.actors[aid]
            if "enter" in b:
                e = b["enter"]; a = A(e["who"]); d = e.get("dur", 1.1)
                x0 = {"left": -0.25, "right": 1.25}.get(e.get("from", "right"), 1.25) * W
                a["vis"].append([t, None]); a["x"].append((t, x0)); a["x"].append((t + d, e.get("x", 0.6) * W)); a["s"].append((t, e.get("s", 1.5)))
                a["walk"].append((t, t + d)); dur = max(dur, d); tl.sfx.append((t, "whoosh", 0.25))
            if "walk" in b:
                e = b["walk"]; a = A(e["who"]); d = e.get("dur", 1.0)
                cur = a["x"][-1][1]; a["x"].append((t, cur)); a["x"].append((t + d, e["x"] * W)); a["walk"].append((t, t + d)); dur = max(dur, d)
            if "exit" in b:
                e = b["exit"]; a = A(e["who"]); d = e.get("dur", 1.0); cur = a["x"][-1][1]
                x1 = {"left": -0.3, "right": 1.3}.get(e.get("to", "right"), 1.3) * W
                a["x"].append((t, cur)); a["x"].append((t + d, x1)); a["walk"].append((t, t + d)); a["vis"][-1][1] = t + d; dur = max(dur, d)
            if "face" in b:
                e = b["face"]; A(e["who"])["faces"].append((t, t + e.get("dur", 1.2), e["kind"]))
            if "prop" in b:
                e = b["prop"]; A(e["who"])["props"].append((t, e.get("name")))
            if "act" in b:
                for e in (b["act"] if isinstance(b["act"], list) else [b["act"]]):
                    a = A(e["who"]); d = e.get("dur", 1.2); nm = e["do"]
                    if nm == "jump":
                        a["jumps"].append((t, 0.6, e.get("h", 90))); tl.sfx.append((t, "boing", 0.3)); dur = max(dur, 0.1)
                    else:
                        f, g, hop = REACTIONS.get(nm, ("normal", nm, 0))
                        if nm in REACTIONS and REACTIONS[nm][0] != "normal": a["faces"].append((t, t + d, f))
                        a["gest"].append((t, t + d, g))
                        if hop: a["jumps"].append((t, min(0.7, d), hop))
                        if nm == "ouch": tl.sfx.append((t, "yelp", 0.5))
                    dur = max(dur, e.get("block", 0.0))
            if "say" in b:
                sy = b["say"]; a = A(sy["who"]); lt = line_timing[(si, bi)]; d = lt["dur"]
                a["say"].append((t, t + d, lt.get("env_key")))
                tl.voice.append(dict(speaker=sb["cast"][sy["who"]].get("voice", "narrator"), si=si, bi=bi, t=t, dur=d))
                if sy.get("gesture"): a["gest"].append((t, t + d, sy["gesture"]))
                else:
                    gi = rnd.randrange(3); pos = t
                    while pos < t + d:
                        seg = rnd.uniform(1.0, 1.8); a["gest"].append((pos, min(pos + seg, t + d), TALK_GESTURES[gi % 3])); gi += 1; pos += seg
                if not sy.get("silent"):
                    words = [(c, t + w0, t + w1) for (c, w0, w1) in lt["words"]] if lt.get("words") else None
                    if not words:
                        chunks = split_chunks(sy["text"], sy.get("hl")); tot = sum(len(c) for c in chunks) or 1; cum = 0; words = []
                        for c in chunks: words.append((c, t + d * cum / tot, t + d * (cum + len(c)) / tot)); cum += len(c)
                    for k, (c, w0, w1) in enumerate(words):
                        nxt = words[k + 1][1] if k + 1 < len(words) else None
                        end = nxt if (nxt is not None and nxt - w1 < 0.7) else w1 + 0.3
                        tl.caps.append((w0, end, html_hl(c)))
                dur = max(dur, d + sy.get("pad", 0.2))
            if "fx" in b:
                f = dict(b["fx"]); f["t0"] = t; tl.fx.append(f)
                if f["kind"] == "burst": tl.sfx.append((t, "impact", 0.8)); dur = max(dur, f.get("block", 0.5))
                if f["kind"] == "flash": tl.sfx.append((t, "ding", 0.3))
            if "card" in b:
                c = b["card"]; tl.cards.append(dict(t0=t, idx=c.get("idx", 1), text=c["text"], y=c.get("y", 380 + 130 * (c.get("idx", 1) - 1)), scene=si)); tl.sfx.append((t, "pop", 0.3))
            if "set_prop" in b:
                e = b["set_prop"]; tl.setprops.append(dict(t0=t, t1=None, scene=si, name=e["name"], x=e.get("x", 0.5) * W, y=e.get("y", FLOOR + 10), s=e.get("s", 1.2), rot=e.get("rot", 0)))
            if "bubble" in b:
                e = b["bubble"]; tl.bubbles.append(dict(t0=t, t1=t + e.get("dur", 2.0), who=e["who"], text=e["text"], kind=e.get("kind", "think")))
            if "sfx" in b:
                for nm in (b["sfx"] if isinstance(b["sfx"], list) else [b["sfx"]]): tl.sfx.append((t, nm, 0.5))
            if "wait" in b: dur = max(dur, b["wait"])
            if "dur" in b: dur = b["dur"]
            if b.get("with_next"): dur = 0.0
            t += dur
        scene["t1"] = t + sc.get("tail", 0.0); t = scene["t1"]
        for a in tl.actors.values():
            if a["vis"] and a["vis"][-1][1] is None and not sc.get("keep"): a["vis"][-1][1] = scene["t1"]
        tl.scenes.append(scene)
        for p in tl.setprops:
            if p["scene"] == si and p["t1"] is None: p["t1"] = scene["t1"]
        for c in tl.cards:
            if c["scene"] == si: c["t1"] = scene["t1"] - 0.05
    tl.dur = t
    tl.caps.sort(key=lambda c: c[0])
    tl.caps = [(a, min(b, tl.caps[i + 1][0]) if i + 1 < len(tl.caps) else b, h) for i, (a, b, h) in enumerate(tl.caps)]
    for f in tl.fx:
        sc_ = next((s for s in tl.scenes if s["t0"] <= f["t0"] < s["t1"]), None)
        if sc_: f["t1"] = min(f["t0"] + f.get("dur", 1.6), sc_["t1"])
    for a in tl.actors.values():
        for v in a["vis"]:
            if v[1] is None: v[1] = tl.dur + 1
    return tl

# ---------------------------------------------------------------- drawing
def _key(keys, t, default):
    if not keys: return default
    if t <= keys[0][0]: return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1 and t1 > t0: return lerp(v0, v1, ease((t - t0) / (t1 - t0)))
        if t <= t1: return v1
    return keys[-1][1]

def actor_pose(tl, aid, t, envs):
    a = tl.actors[aid]
    vis = any(v0 <= t < v1 for v0, v1 in a["vis"])
    if not vis: return None
    p = dict(look=a["look"], x=_key(a["x"], t, 540), y=a["y"], s=_key(a["s"], t, 1.5))
    walking = next((w for w in a["walk"] if w[0] <= t < w[1]), None)
    if walking: p["walk"] = t * 9.5
    # gesture
    g = None
    for t0, t1, nm in a["gest"]:
        if t0 <= t < t1: g = (nm, t - t0)
    base = gesture(g[0], g[1], t) if g else gesture("idle", 0, t)
    if walking:
        ph = t * 9.5; base["aL"] = (-64 + 24 * math.sin(ph), -318); base["aR"] = (64 - 24 * math.sin(ph), -318)
    p["gname"] = g[0] if g else None
    p["aL"], p["aR"], p["aL_front"], p["lean"] = base["aL"], base["aR"], base["aL_front"], base["lean"]
    # face
    kind = None
    for t0, t1, k in a["faces"]:
        if t0 <= t < t1: kind = k
    if kind is None and g and base.get("kind"): kind = base["kind"]
    blink = (t * 1.0 + hash(aid) % 7) % 2.6 < 0.13
    saying = next((s for s in a["say"] if s[0] <= t < s[1]), None)
    if saying:
        env = envs.get(saying[2]); mo = 0.0
        if env is not None:
            i = int((t - saying[0]) * 24); mo = env[i] if 0 <= i < len(env) else 0.0
        else: mo = 0.5 + 0.5 * math.sin(t * 15)
        p["kind"] = "talk_blink" if blink else "talk"; p["mo"] = mo
        if kind in ("ouch", "scared", "surprised"): p["kind"] = kind
    else:
        p["kind"] = kind or ("blink" if blink else "normal")
    # jumps
    j = 0.0
    for t0, d, h in a["jumps"]:
        if t0 <= t < t0 + d: j += h * math.sin(math.pi * (t - t0) / d) ** 0.9
    if walking: j += abs(math.sin(t * 9.5)) * 7
    p["jump"] = j
    # prop
    pr = None
    for t0, nm in a["props"]:
        if t0 <= t: pr = nm
    if pr == "glass": p["prop"] = "glass"; p["glass"] = dict(theta=-12, water=0.7, shake=0)
    elif pr in ("phone", "clip", "bag", "cane"): p["prop"] = pr
    return p

def _burst(t, f):
    t0 = f["t0"]; d = f.get("dur", 1.6)
    if not (t0 <= t < min(t0 + d, f.get("t1", t0 + d))): return ""
    u = B.pop(t, t0 + 0.03, 0.25); sz = f.get("size", 150)
    return (f'<g transform="translate({f.get("x", 540)},{f.get("y", 330)}) scale({max(u, 0.001):.3f}) rotate({-6 * math.sin(t * 14):.1f})">'
            + B.burst(0, 0, 190, 270, 14, t * 0.4) + B.T(0, sz * 0.31, f["text"], sz, "#ffffff", 900, B.INK, 18) + '</g>')

def _bubble(t, bb, p):
    if not (bb["t0"] <= t < bb["t1"]) or p is None: return ""
    u = B.pop(t, bb["t0"], 0.25); x = p["x"] + 150 * p["s"] * 0.55; y = p["y"] - 700 * p["s"] * (0.74 if p["look"] in ("boy", "girl") else 1)
    s = f'<g transform="translate({x:.0f},{y:.0f}) scale({max(u, .001):.3f})">'
    if bb["kind"] == "think":
        s += B.Ci(-90, 120, 12, "#fff", 5) + B.Ci(-60, 80, 18, "#fff", 5) + f'<ellipse cx="0" cy="0" rx="200" ry="90" fill="#fff" stroke="{B.INK}" stroke-width="7"/>'
    else:
        s += f'<path d="M-200,-80 Q0,-130 200,-80 Q230,0 200,70 L40,70 L-30,130 L-10,70 L-200,70 Q-230,0 -200,-80 Z" fill="#fff" stroke="{B.INK}" stroke-width="7"/>'
    s += B.T(0, 18, bb["text"], 54, B.BLUE, 800) + '</g>'
    return s

def frame_svg(tl, t, envs, opts=None):
    opts = opts or {}
    sc = next((s for s in tl.scenes if s["t0"] <= t < s["t1"]), tl.scenes[-1])
    u = (t - sc["t0"]) / max(0.01, sc["t1"] - sc["t0"])
    cam = sc["cam"]; z = lerp(cam.get("z0", 1.0), cam.get("z1", 1.0), ease(u)); px = lerp(cam.get("x0", 0), cam.get("x1", 0), ease(u)); py = lerp(cam.get("y0", 0), cam.get("y1", 0), ease(u))
    sx = sy = 0.0
    for f in tl.fx:
        if f["kind"] in ("burst", "shake") and f["t0"] <= t < f["t0"] + 0.6:
            k = 1 - (t - f["t0"]) / 0.6; amp = f.get("shake", 1.0 if f["kind"] == "burst" else 1.0)
            sx += 16 * k * amp * math.sin(t * 95); sy += 12 * k * amp * math.cos(t * 83)
    o = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
    o += f'<g transform="translate({sx:.1f},{sy:.1f})"><g transform="translate(540,960) scale({z:.4f}) translate({-540 - px:.1f},{-960 - py:.1f})">'
    o += SETS.set_svg(sc["set"], W, H, sc["floor"])
    for p in tl.setprops:
        if p["scene"] == sc["i"] and p["t0"] <= t < (p["t1"] or 1e9): o += PROPS.prop(p["name"], p["x"], p["y"], p["s"], p["rot"])
    poses = {}
    order = sorted(tl.actors, key=lambda k: (tl.actors[k]["z"]))
    for aid in order:
        p = actor_pose(tl, aid, t, envs)
        poses[aid] = p
    for aid in sorted(poses, key=lambda k: (poses[k] or {"y": 0})["x"] if poses[k] else 0):
        p = poses[aid]
        if p is None: continue
        o += B.El(p["x"], p["y"] + 6, 150 * p["s"] * 0.85 * 0.74 * (0.74 if p["look"] in ("boy", "girl") else 1), 22 * p["s"] * 0.7, BLUE, 0, B.INK, 0.16)
        if isinstance(p["look"], str) and p["look"] in KS.CFG: o += KS.kit_actor(p, p["look"])
        elif p["look"] == "tooth": o += B.tooth(dict(p, kind="happy", legs=True))
        else: o += PS.person(p)
    o += '</g>'
    for bb in tl.bubbles: o += _bubble(t, bb, poses.get(bb["who"]))
    for f in tl.fx:
        if f["kind"] == "burst": o += _burst(t, f)
        if f["kind"] == "flash" and f["t0"] <= t < f["t0"] + 0.3: o += f'<rect width="{W}" height="{H}" fill="#fff" opacity="{0.8 * (1 - (t - f["t0"]) / 0.3):.2f}"/>'
    o += '</g>'
    for c in tl.cards: o += B.card(t, c["t0"], c["t1"], c["idx"], c["text"], c["y"])
    if not opts.get("no_caps"):
        for a, b, h in tl.caps: o += B.capbox(t, a, b, h)
    o += B.chrome() if B.LOGO_URI else ""
    # scene transition-in
    tr = sc["trans"]; tin = t - sc["t0"]
    if tin < 0.35 and tr != "cut":
        k = 1 - tin / 0.35
        if tr == "fade": o += f'<rect width="{W}" height="{H}" fill="#fff" opacity="{k:.2f}"/>'
        elif tr == "slide": o += f'<rect x="{(1 - k) * 0}" y="0" width="{W * k:.0f}" height="{H}" fill="{BLUE}" opacity="{0.9 * k:.2f}"/>'
        elif tr == "flash": o += f'<rect width="{W}" height="{H}" fill="#F15A22" opacity="{0.6 * k:.2f}"/>'
    if t < 0.25: o += f'<rect width="{W}" height="{H}" fill="#fff" opacity="{1 - t / 0.25:.2f}"/>'
    if t > tl.dur - 0.3: o += f'<rect width="{W}" height="{H}" fill="#fff" opacity="{min(1, (t - (tl.dur - 0.3)) / 0.3):.2f}"/>'
    return o + '</svg>'
