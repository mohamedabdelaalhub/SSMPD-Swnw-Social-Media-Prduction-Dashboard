"""15 props. prop(name, x, y, s=1, rot=0) -> svg (origin = bottom centre of the object)."""
import math
INK = "#1c1c24"; BLUE = "#0F369D"; ORG = "#F15A22"

def _g(x, y, s, rot, inner):
    return f'<g transform="translate({x:.1f},{y:.1f}) rotate({rot:.1f}) scale({s:.3f})">{inner}</g>'
def r(x, y, w, h, f, rx=6, sw=5, st=INK): return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{f}" stroke="{st}" stroke-width="{sw}"/>'
def c(x, y, rr, f, sw=5, st=INK): return f'<circle cx="{x}" cy="{y}" r="{rr}" fill="{f}" stroke="{st}" stroke-width="{sw}"/>'
def p(d, f="none", sw=5, st=INK): return f'<path d="{d}" fill="{f}" stroke="{st}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'

def thermometer(): return r(-12, -170, 24, 150, "#ffffff", 12) + c(0, -22, 26, "#e63e3e") + r(-5, -150, 10, 110, "#e63e3e", 5, 0) + "".join(p(f"M12,{-150+i*22} h14") for i in range(5))
def toothbrush(): return r(-10, -190, 20, 150, "#0090D8", 10) + r(-26, -230, 52, 50, "#ffffff", 8) + "".join(r(-22 + i * 11, -246, 7, 20, "#ffffff", 3, 3) for i in range(5)) + r(-10, -60, 20, 60, "#F15A22", 10)
def backpack(): return r(-70, -190, 140, 190, "#F15A22", 34) + r(-50, -120, 100, 80, "#c9461a", 16) + p("M-30,-190 q30,-50 60,0") + r(-26, -96, 52, 8, "#ffffff", 3, 0)
def pills(): return r(-44, -150, 88, 150, "#ffffff", 14) + r(-44, -170, 88, 34, "#F15A22", 10) + r(-30, -110, 60, 50, "#e8f0fb", 6, 3) + p("M-14,-90 h28 M0,-104 v28", "none", 6, "#2F7D5C")
def tissue(): return r(-80, -90, 160, 90, "#7fd0f0", 14) + p("M-30,-90 q10,-60 28,-30 q18,-60 36,-10", "#ffffff", 5)
def heater(): return r(-80, -170, 160, 170, "#8a93a6", 20) + "".join(r(-58 + i * 30, -146, 16, 100, "#F15A22", 8, 3) for i in range(5)) + c(0, -30, 10, "#ffffff", 3) + c(0, -90, 130, "#FFB36A", 0, "none").replace('fill="#FFB36A"', 'fill="#FFB36A" fill-opacity="0.18"')
def mug(): return r(-46, -90, 92, 90, "#ffffff", 14) + p("M46,-70 q40,0 40,28 q0,28 -40,28", "none", 8) + p("M-20,-110 q10,-20 0,-36 M10,-110 q10,-20 0,-36", "none", 5, "#9aa3b4")
def icecream(): return p("M-34,-150 L0,0 L34,-150 Z", "#e8b75c", 6) + c(0, -170, 48, "#f8a4c0") + c(-26, -200, 30, "#ffffff") + c(26, -200, 30, "#7fd0f0")
def juice(): return r(-44, -140, 88, 140, "#0090D8", 10) + r(-30, -100, 60, 50, "#ffffff", 8, 3) + r(18, -190, 12, 60, "#F15A22", 4, 3)
def clock(): return c(0, -80, 80, "#ffffff", 8) + p("M0,-80 L0,-130 M0,-80 L36,-62", "none", 8) + c(0, -80, 8, INK, 0)
def pillow(): return p("M-90,-100 Q0,-130 90,-100 Q110,-50 90,0 Q0,24 -90,0 Q-110,-50 -90,-100 Z", "#ffffff", 6)
def apple(): return p("M0,-110 Q-70,-140 -66,-70 Q-60,0 0,-4 Q60,0 66,-70 Q70,-140 0,-110 Z", "#e63e3e", 6) + p("M0,-110 q4,-30 24,-40", "none", 7, "#7a5230") + p("M6,-124 q30,-18 40,6 q-26,12 -40,-6", "#4dba84", 5)
def scale_(): return r(-100, -50, 200, 50, "#c6d4ea", 16) + r(-60, -46, 120, 28, "#ffffff", 8, 3) + p("M0,-46 l16,-8", "none", 5, "#e63e3e")
def tooth(): return p("M-50,-140 Q-60,-210 -22,-210 Q0,-196 22,-210 Q60,-210 50,-140 Q48,-80 34,-12 Q20,-6 14,-60 Q0,-80 -14,-60 Q-20,-6 -34,-12 Q-48,-80 -50,-140 Z", "#ffffff", 6)
def waterbottle(): return r(-36, -170, 72, 170, "#bfe8fb", 24) + r(-18, -200, 36, 36, "#0F369D", 8) + p("M-24,-110 q24,16 48,0", "none", 5, "#4aa8d6")

PROPS = {"thermometer": thermometer, "toothbrush": toothbrush, "backpack": backpack, "pills": pills, "tissue": tissue, "heater": heater,
         "mug": mug, "icecream": icecream, "juice": juice, "clock": clock, "pillow": pillow, "apple": apple, "scale": scale_, "tooth": tooth, "waterbottle": waterbottle}

def prop(name, x, y, s=1.0, rot=0.0): return _g(x, y, s, rot, PROPS[name]())
