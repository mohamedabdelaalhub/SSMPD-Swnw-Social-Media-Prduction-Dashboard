"""Parametric cartoon person (rigged with 2-bone IK arms, walk cycle, lip-sync mouth, expressions).
One function, many looks: man, woman with hair, woman in hijab, boy, girl, grandpa in galabeya + cane,
grandma in abaya + white hijab, doctor (man/woman) ... Colors are the Swnw palette plus tints."""
import math
import base as B
from base import P, Ci, El, tube, shoe, hand, G, ik, face

INK = B.INK
BLUE, ORG, DARK = B.BLUE, B.ORG, B.DARK

SKINS = {"light": "#f4cfa4", "tan": "#e7b98a", "brown": "#c98f62", "dark": "#9b6a45"}

def L(**k):
    d = dict(age="adult", skin="light", hair="short", hair_col="#3a2a22", top="tee", top_col=ORG, bottom_col=B.NAVY,
             shoe_col=BLUE, glasses=False, mustache=False, beard=None, hijab_col="#0F369D", hat=None, acc=None, lash=False)
    d.update(k); return d

LOOKS = {
    "abu":        L(glasses=True, mustache=True),
    "man_tie":    L(top="shirt", top_col="#dfe9fb", bottom_col="#16212E", hair="side", glasses=False, acc="tie"),
    "man_beard":  L(top="tee", top_col="#0F369D", bottom_col="#2b3550", hair="short", beard="#2a1d17", skin="tan"),
    "mama_hair":  L(top="dress", top_col="#0F369D", hair="long", hair_col="#6b3a22", lash=True, shoe_col=ORG),
    "mama_hijab": L(top="dress", top_col="#0090D8", hair="hijab", hijab_col="#0F369D", lash=True, shoe_col=ORG, skin="tan"),
    "boy":        L(age="kid", top="tee", top_col="#f7c95a", bottom_col="#0F369D", hair="spiky", shoe_col=ORG),
    "girl":       L(age="kid", top="dress", top_col="#f26b9a", hair="pigtails", hair_col="#1c1c24", lash=True, shoe_col="#0F369D"),
    "grandpa":    L(age="elder", top="galabeya", top_col="#e9e1cf", hair="taqiyah", hair_col="#f1f1f1", mustache=True, glasses=True,
                    acc="cane", shoe_col="#6b4a2a", skin="tan"),
    "grandma":    L(age="elder", top="abaya", top_col="#2b2f3d", hair="hijab", hijab_col="#f3f3f3", glasses=True, lash=True,
                    acc="cane", shoe_col="#16212E", skin="tan"),
    "doctor_m":   L(top="coat", top_col="#ffffff", bottom_col="#16212E", hair="side", hair_col="#2a2020", glasses=True, acc="stetho", shoe_col="#f2f2f2"),
    "doctor_f":   L(top="coat", top_col="#ffffff", bottom_col="#16212E", hair="bun", hair_col="#2a2020", lash=True, acc="stetho", shoe_col="#f2f2f2"),
}

def _hair_back(look):
    st, c = look["hair"], look["hair_col"]
    if st == "long":
        return P("M-64,0 Q-76,-96 0,-98 Q76,-96 64,0 Q74,84 58,122 Q36,110 30,80 L-30,80 Q-36,110 -58,122 Q-74,84 -64,0 Z", c, 6)
    if st == "hijab":
        h = look["hijab_col"]
        return P("M-82,0 Q-86,-98 0,-100 Q86,-98 82,0 Q86,84 44,106 L-44,106 Q-86,84 -82,0 Z", h, 6)
    if st == "pigtails":
        return Ci(-70, -14, 26, c, 5) + Ci(70, -14, 26, c, 5) + El(-70, -14, 12, 8, "#f26b9a", 3) + El(70, -14, 12, 8, "#f26b9a", 3)
    return ""

def _hair_front(look):
    st, c = look["hair"], look["hair_col"]
    if st == "short":
        return P("M-58,-25 Q-52,-86 -12,-76 Q8,-102 38,-78 Q68,-62 58,-18 Q42,-46 22,-40 Q2,-58 -20,-42 Q-40,-42 -58,-25 Z", c, 5)
    if st == "side":
        return P("M-58,-22 Q-56,-90 6,-86 Q60,-84 58,-22 Q36,-60 -6,-56 Q-34,-52 -58,-22 Z", c, 5)
    if st == "spiky":
        return P("M-50,-46 L-44,-92 L-22,-60 L-4,-102 L14,-62 L38,-94 L48,-46 Q0,-70 -50,-46 Z", c, 5)
    if st == "bun":
        return Ci(0, -98, 20, c, 5) + P("M-58,-22 Q-56,-90 0,-86 Q56,-90 58,-22 Q34,-56 0,-62 Q-34,-56 -58,-22 Z", c, 5)
    if st == "long":
        return P("M-56,-16 Q-40,-80 10,-70 Q50,-64 56,-16 Q34,-36 6,-46 Q-24,-26 -56,-16 Z", c, 5)
    if st == "hijab":
        return P("M-56,-14 Q0,-82 56,-14 Q30,-42 0,-46 Q-30,-42 -56,-14 Z", look["hijab_col"], 5)
    if st == "pigtails":
        return P("M-56,-20 Q-50,-84 0,-84 Q50,-84 56,-20 Q30,-52 0,-54 Q-30,-52 -56,-20 Z", c, 5) + \
               f'<path d="M-52,-62 l-14,-12 l4,18 z" fill="#f26b9a" stroke="{INK}" stroke-width="3"/><path d="M52,-62 l14,-12 l-4,18 z" fill="#f26b9a" stroke="{INK}" stroke-width="3"/>'
    if st == "taqiyah":
        return P("M-48,-40 Q-44,-86 0,-88 Q44,-86 48,-40 Q0,-56 -48,-40 Z", "#ffffff", 5) + \
               "".join(f'<path d="M{x},-58 l0,-18" stroke="#c7c7c7" stroke-width="3"/>' for x in (-30, -15, 0, 15, 30)) + \
               P("M-58,-10 Q-60,-40 -50,-34 L-50,0 Q-58,0 -58,-10 Z", look["hair_col"], 4) + P("M58,-10 Q60,-40 50,-34 L50,0 Q58,0 58,-10 Z", look["hair_col"], 4)
    return ""

def person(p):
    """p: x,y,s (feet position + scale), look (name or dict), kind (expression), mo (mouth 0..1), aL/aR (wrist targets, body coords),
    aL_front, prop (None|'glass'|'phone'|'clip'|'bag'), jump, lean, ht, hdx,hdy, walk (phase or None)."""
    look = LOOKS[p["look"]] if isinstance(p.get("look"), str) else p["look"]
    skin = SKINS.get(look["skin"], look["skin"])
    old = B.SKIN; B.SKIN = skin
    try:
        x, y, s = p["x"], p["y"], p["s"]
        kid = look["age"] == "kid"; elder = look["age"] == "elder"
        if kid: s = s * 0.74
        top, topc, botc = look["top"], look["top_col"], look["bottom_col"]
        SL, SR = (-44, -428), (44, -428)
        o = ""
        wk = p.get("walk")
        robe = top in ("galabeya", "abaya")
        legs_skin = top == "dress"
        legcol = skin if legs_skin else botc
        lw = 12 if legs_skin else 24
        if not robe:
            if wk is None:
                a = [(-26, -250), (-40, -130), (-44, -30)] if not legs_skin else [(-20, -200), (-24, -34)]
                b = [(26, -250), (44, -130), (58, -30)] if not legs_skin else [(20, -200), (24, -34)]
                o += tube(a, lw, legcol) + tube(b, lw, legcol) + shoe(a[-1][0], 0, -1, look["shoe_col"]) + shoe(b[-1][0], 0, 1, look["shoe_col"])
            else:
                for side, ph in ((-1, wk), (1, wk + math.pi)):
                    lift = max(0.0, math.sin(ph)) * 44; sw = math.cos(ph) * 14
                    hip = (side * (20 if legs_skin else 26), -200 if legs_skin else -250); ank = (side * 46 + sw, -30 - lift)
                    knee = ((hip[0] + ank[0]) / 2 + side * 6, (hip[1] + ank[1]) / 2 - lift * 0.25)
                    o += tube([hip, knee, ank], lw, legcol) + shoe(ank[0], -lift, side, look["shoe_col"])
        else:
            for side in (-1, 1):
                ph = (wk + (0 if side < 0 else math.pi)) if wk is not None else None
                lift = max(0.0, math.sin(ph)) * 30 if ph is not None else 0
                o += shoe(side * 40 + (math.cos(ph) * 12 if ph is not None else 0), -lift, side, look["shoe_col"])
        up = f'<g transform="rotate({p.get("lean", 3 if elder else 0):.2f} 0 -250)">'
        def arm(S, Wt, side):
            E, Wc = ik(S, Wt, side)
            sleeve = topc if top not in ("shirt",) else topc
            return tube([S, E], 20, sleeve) + tube([E, Wc], 13, skin), Wc
        aL = p.get("aL", (-66, -318)); aR = p.get("aR", (66, -318))
        armL, wL = arm(SL, aL, -1); armR, wR = arm(SR, aR, 1)
        if not p.get("aL_front"): up += armL + hand(*wL, col=skin)
        # torso
        if top == "tee" or top == "shirt":
            up += P("M-54,-440 Q0,-462 54,-440 L48,-248 Q0,-232 -48,-248 Z", topc, 6) + P("M-18,-452 L0,-420 L18,-452", "#fff", 5)
            up += P("M-48,-262 L48,-262", "none", 12, botc)
            if look["acc"] == "tie": up += P("M-8,-440 L0,-424 L8,-440 L6,-330 L0,-318 L-6,-330 Z", ORG, 4)
        elif top == "dress":
            up += P("M-50,-430 Q0,-452 50,-430 L46,-250 Q0,-236 -46,-250 Z", topc, 6)
            up += P("M-48,-262 L48,-262 L82,-170 Q0,-150 -82,-170 Z", topc, 6) + P("M-48,-262 L48,-262", "none", 12, "#ffffff")
            up += P("M-22,-440 Q0,-414 22,-440", "none", 5, "#ffffff")
        elif top == "coat":
            up += P("M-62,-440 Q0,-466 62,-440 L78,-190 Q0,-174 -78,-190 Z", "#ffffff", 6) + P("M0,-446 L0,-196", "none", 4, "#c9c9d2")
            up += P("M-24,-452 L0,-392 L-30,-410 Z", B.PANEL, 5) + P("M24,-452 L0,-392 L30,-410 Z", B.PANEL, 5) + P("M-22,-446 L0,-400 L22,-446", BLUE, 4)
        elif robe:
            wide = 76 if top == "galabeya" else 84
            up += P(f"M-58,-440 Q0,-464 58,-440 L{wide},-24 Q0,-4 -{wide},-24 Z", topc, 6)
            if top == "galabeya":
                up += P("M0,-448 L0,-300", "none", 4, "#b9ae93") + "".join(f'<circle cx="0" cy="{yy}" r="5" fill="#b9ae93" stroke="{INK}" stroke-width="2"/>' for yy in (-410, -370, -330))
            else:
                up += P("M-20,-444 Q0,-420 20,-444", "none", 5, "#555a70")
        if look["acc"] == "stetho":
            up += P("M-24,-446 Q-38,-372 0,-362 Q38,-372 24,-446", "none", 5, "#2a2f3d") + Ci(0, -352, 10, "#bfc7d0", 4)
        up += tube([(0, -466), (0, -438)], 16, skin)
        # head
        hs = 1.16 if kid else 1.0
        hd = f'<g transform="translate({p.get("hdx",0):.1f},{p.get("hdy",0):.1f}) rotate({p.get("ht",0):.2f} 0 -470)"><g transform="translate(0,-520) scale({hs})">'
        hd += _hair_back(look)
        if look["hair"] == "hijab":
            hd += Ci(0, 0, 56, skin, 6)
            fc = face(p.get("kind", "normal"), glasses=look["glasses"], mustache=look["mustache"], lash=look["lash"], mo=p.get("mo", 0), bare=True)
            hd += f'<g transform="scale(0.92)">{fc}</g>' + _hair_front(look)
        else:
            hd += face(p.get("kind", "normal"), glasses=look["glasses"], mustache=look["mustache"], lash=look["lash"], mo=p.get("mo", 0))
            if look["beard"]:
                hd += P("M-46,10 Q-40,64 0,70 Q40,64 46,10 Q30,34 0,30 Q-30,34 -46,10 Z", look["beard"], 5)
            hd += _hair_front(look)
        if elder and look["hair"] not in ("hijab", "taqiyah"):
            pass
        hd += '</g></g>'
        up += hd
        if p.get("aL_front"): up += armL + hand(*wL, col=skin)
        prop = p.get("prop") or ("cane" if look["acc"] == "cane" and p.get("prop") is None else None)
        up += armR
        if prop == "cane":
            up += tube([(wR[0], wR[1]), (wR[0] + 6, -8)], 9, "#7a5230")
        elif prop == "glass" and p.get("glass") is not None:
            g = p["glass"]; up += f'<g transform="translate({wR[0]:.1f},{wR[1]:.1f}) rotate({g["theta"]:.2f})">{B.glass(g.get("water", .7), g.get("shake", 0))}</g>'
        elif prop == "phone":
            up += f'<g transform="translate({wR[0]:.1f},{wR[1]:.1f}) rotate(-12)"><rect x="-12" y="-44" width="26" height="46" rx="5" fill="#2a2f3d" stroke="{INK}" stroke-width="4"/><rect x="-8" y="-38" width="18" height="32" rx="3" fill="#7fd0f0"/></g>'
        elif prop == "clip":
            up += f'<g transform="translate({wR[0]:.1f},{wR[1]:.1f}) rotate(8)"><rect x="-26" y="-44" width="52" height="70" rx="5" fill="#d9b27a" stroke="{INK}" stroke-width="5"/><rect x="-18" y="-32" width="36" height="48" fill="#fff" stroke="{INK}" stroke-width="2"/></g>'
        elif prop == "bag":
            up += f'<g transform="translate({wR[0]:.1f},{wR[1]:.1f})"><rect x="-26" y="0" width="52" height="46" rx="8" fill="#6b4a2a" stroke="{INK}" stroke-width="5"/><path d="M-14,0 q14,-26 28,0" fill="none" stroke="{INK}" stroke-width="5"/></g>'
        up += hand(*wR, col=skin) + '</g>'
        return G(x, y - p.get("jump", 0) * s, s, o + up)
    finally:
        B.SKIN = old
