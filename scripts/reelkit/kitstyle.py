"""Second visual style: the licensed Shutterstock vector kits (parts live in the kit under characters/<kit>/svg/pNNN.svg).
 - 'pose' actors swap between ready-made full-body poses (kit_639683044: 22 poses of a doctor)
 - 'puppet' actors put an expression/mouth-shape head over a full-body front view (same units, aligned by top + centre)
Parts are read from CHAR_LIB/<kit>/svg/<part>.svg; missing ones are fetched from the kit through the gateway (token in ~/.swnw-run-token)."""
import json, os, re, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "kitstyle.json")))
LIB = os.environ.get("CHAR_LIB", os.path.expanduser("~/.cache/swnw-char-kits"))
GATEWAY = os.environ.get("SWNW_GATEWAY", "https://api.swnwclinics.com/functions/v1/claude-automation")
_cache, _idx = {}, {}

def _fetch(kit, rel):
    dst = os.path.join(LIB, kit, rel)
    if os.path.exists(dst): return dst
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tok = open(os.path.expanduser("~/.swnw-run-token")).read().strip()
    subprocess.run(["curl", "-s", "-A", "claude-task", "-m", "60", "-X", "POST", f"{GATEWAY}?op=kit_get&name=characters/{kit}/{rel}", "-H", f"X-Run-Token: {tok}", "-o", dst], check=True)
    return dst

def index(kit):
    if kit not in _idx: _idx[kit] = {p["id"]: p for p in json.load(open(_fetch(kit, "index.json")))["parts"]}
    return _idx[kit]

def part(kit, pid):
    k = (kit, pid)
    if k not in _cache:
        t = open(_fetch(kit, f"svg/{pid}.svg")).read()
        vb = [float(x) for x in re.search(r'viewBox="([^"]+)"', t).group(1).split()]
        inner = t[t.index(">", t.index("<svg")) + 1: t.rindex("</svg>")]
        _cache[k] = (vb, inner)
    return _cache[k]

def _draw(kit, pid, x, y, ppu, anchor="bottom"):
    vb, inner = part(kit, pid); w, h = vb[2] * ppu, vb[3] * ppu
    x0 = x - w / 2; y0 = y - h if anchor == "bottom" else y
    return f'<svg x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}" viewBox="{vb[0]} {vb[1]} {vb[2]} {vb[3]}" overflow="visible">{inner}</svg>'

def kit_actor(p, name):
    """p: x,y,s, kind (expression), mo (0..1 mouth), gesture name (p['gname']), walk (phase or None)"""
    c = CFG[name]; kit = c["kit"]; s = p["s"] / 1.5; idx = index(kit)
    if c["type"] == "pose":
        GM = {"wave": "wave", "point": "point", "thumbs": "point", "think": "think", "shrug": "present", "cheer": "present", "surprised": "stress", "scared": "stress", "ouch": "stress", "nod": "talk_a", "happy": "present", "laugh": "present"}
        nm = p.get("pose") or GM.get(p.get("gname") or "") or ("talk_a" if str(p.get("kind", "")).startswith("talk") and p.get("mo", 0) > 0.15 else "idle")
        pose = c["poses"].get(nm, c["poses"]["idle"])
        if p.get("walk") is not None: pose = c["poses"]["walk" if int(p["walk"] / 3.2) % 2 == 0 else "walk"]
        ppu = c["target_px"] * s / idx[c["idle"]]["h"]
        bob = (abs(__import__("math").sin(p["walk"])) * 8 if p.get("walk") is not None else 0) + p.get("jump", 0)
        return _draw(kit, pose, p["x"], p["y"] - bob * s, ppu)
    # puppet
    ppu = c["target_px"] * s / idx[c["ppu_ref"]]["h"]
    body = idx[c["body"]]; bvb, _ = part(kit, c["body"])
    bob = (abs(__import__("math").sin(p["walk"])) * 8 if p.get("walk") is not None else 0) + p.get("jump", 0)
    yb = p["y"] - bob * s
    o = _draw(kit, c["body"], p["x"], yb, ppu)
    kind, mo = p.get("kind", "normal"), p.get("mo", 0.0)
    if kind in ("talk", "talk_blink"):
        key = "blink" if kind == "talk_blink" else ("neutral" if mo < 0.16 else "talk1" if mo < 0.5 else "talk2")
    else:
        key = {"normal": "neutral", "blink": "blink", "happy": "happy", "ouch": "ouch", "scared": "scared", "thinking": "think", "surprised": "scared", "angry": "angry"}.get(kind, "neutral")
    hid = c["heads"][key]
    hv, _ = part(kit, hid)
    top_y = yb - bvb[3] * ppu          # top of the body sprite
    dx = c.get("head_dx", 0) * ppu; dy = c.get("head_dy", 0) * ppu
    o += _draw(kit, hid, p["x"] + dx, top_y + dy, ppu, anchor="top")
    return o
