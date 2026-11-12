"""8 flat backgrounds in the Swnw palette. set_svg(name, W=1080, H=1920, floor=1560) -> svg string (wall + floor + furniture)."""
import math

BLUE, ORG, DARK = "#0F369D", "#F15A22", "#16212E"

def R(x, y, w, h, fill, rx=0, st=None, sw=0, op=1):
    s = f' stroke="{st}" stroke-width="{sw}"' if st else ""
    return f'<rect x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{h:.0f}" rx="{rx}" fill="{fill}" fill-opacity="{op}"{s}/>'

def C(x, y, r, fill, op=1, st=None, sw=0):
    s = f' stroke="{st}" stroke-width="{sw}"' if st else ""
    return f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r}" fill="{fill}" fill-opacity="{op}"{s}/>'

def PG(pts, fill, op=1):
    return f'<polygon points="{" ".join(f"{a:.0f},{b:.0f}" for a, b in pts)}" fill="{fill}" fill-opacity="{op}"/>'

def floor_band(W, H, floor, col, line):
    return R(0, floor, W, H - floor, col) + R(0, floor - 4, W, 8, line)

def window(x, y, w, h, sky="#BFE3F7", frame="#ffffff", night=False):
    s = R(x, y, w, h, "#16212E" if night else sky, 14, frame, 10)
    s += R(x + w / 2 - 4, y, 8, h, frame) + R(x, y + h / 2 - 4, w, 8, frame)
    if night: s += C(x + w * 0.72, y + h * 0.3, 34, "#fff7c9") + C(x + w * 0.28, y + h * 0.2, 4, "#fff", 0.9) + C(x + w * 0.5, y + h * 0.72, 3, "#fff", 0.9)
    else: s += C(x + w * 0.74, y + h * 0.26, 30, "#FFD84A")
    return s

def kitchen(W, H, F):
    s = R(0, 0, W, F, "#FFF4E2") + R(0, 0, W, 130, "#F1E3C8")
    s += window(70, 420, 330, 300)
    s += R(470, 360, 540, 150, "#ffffff", 18, "#d8cdb4", 6) + R(470, 360, 270, 150, "#f6efe0", 18, "#d8cdb4", 6)
    for x in (600, 870): s += C(x, 435, 9, "#c9bda0")
    s += R(0, 1250, W, F - 1250, "#e9dcc1") + R(0, 1236, W, 22, "#ffffff")
    s += R(660, 1130, 220, 110, "#d6dce6", 12, "#9aa3b4", 5) + C(740, 1185, 26, "#9aa3b4") + C(820, 1185, 26, "#9aa3b4")
    s += R(150, 1090, 80, 150, ORG, 12) + R(140, 1070, 100, 26, "#c9461a", 8)
    return s + floor_band(W, H, F, "#CFC3A8", "#b3a789")

def clinic(W, H, F):
    s = R(0, 0, W, F, "#E9F2FC") + R(0, F - 220, W, 220, "#d6e6f8")
    s += R(430, 300, 220, 220, "#ffffff", 28, BLUE, 8) + R(522, 340, 36, 140, "#2F7D5C", 8) + R(470, 392, 140, 36, "#2F7D5C", 8)
    s += R(60, 560, 260, 360, "#ffffff", 20, "#c6d4ea", 6) + C(190, 680, 56, "#F5F7FB", 1, "#9fb0d0", 5) + R(150, 770, 80, 110, BLUE, 14)
    s += R(700, 1100, 300, 130, "#ffffff", 20, "#b9c8e2", 6) + R(700, 1230, 300, 40, "#8da3cf", 8)
    s += R(120, 1180, 120, 60, "#8da3cf", 16) + R(150, 1120, 22, 80, "#2F7D5C", 8) + C(161, 1096, 44, "#3a9d70") + C(130, 1130, 30, "#2F7D5C") + C(194, 1126, 30, "#4dba84")
    return s + floor_band(W, H, F, "#BFD3EC", "#9fb8dd")

def bedroom(W, H, F):
    s = R(0, 0, W, F, "#E6E9FA") + window(660, 360, 300, 380, night=True)
    s += R(90, 1010, 520, 360, "#ffffff", 30, "#c6cae8", 6) + R(90, 1090, 520, 280, "#0F369D", 24) + R(110, 1020, 190, 90, "#ffffff", 30, "#c6cae8", 5)
    s += R(60, 880, 36, 480, "#8a6b4a", 10) + R(600, 960, 36, 410, "#8a6b4a", 10)
    s += R(780, 1120, 150, 200, "#8a6b4a", 14) + R(830, 1000, 50, 120, "#f1d39a", 6) + PG([(790, 1000), (920, 1000), (890, 920), (820, 920)], "#FFD84A") + C(855, 1070, 90, "#FFE98A", 0.25)
    s += R(120, 360, 190, 240, "#ffffff", 14, "#c6cae8", 6) + C(215, 480, 56, "#F15A22", 0.8)
    return s + floor_band(W, H, F, "#C7C9E6", "#A9ACD3")

def street(W, H, F):
    s = R(0, 0, W, F, "#CDEBFA") + C(880, 220, 90, "#FFE070") + C(300, 260, 70, "#ffffff", 0.9) + C(380, 240, 90, "#ffffff", 0.9) + C(470, 270, 60, "#ffffff", 0.9)
    cols = ["#9db9e6", "#b9cdee", "#8aa7dd", "#a9bfe9"]
    x = -20
    for i, (w, h) in enumerate([(230, 760), (200, 980), (260, 640), (240, 880), (210, 700)]):
        s += R(x, F - 160 - h, w, h, cols[i % 4]) + "".join(R(x + 30 + 60 * c, F - 160 - h + 40 + 80 * r_, 36, 46, "#ffffff", 6, None, 0, 0.8) for c in range(max(1, int(w // 60) - 1)) for r_ in range(int(h // 80) - 1) if (c + r_) % 3 != 2)
        x += w + 10
    s += R(0, F - 160, W, 160, "#9aa3b4") + R(0, F - 190, W, 40, "#d9dde6") + "".join(R(60 + 220 * k, F - 80, 120, 14, "#ffffff", 4) for k in range(5))
    s += R(920, F - 520, 14, 330, "#5b6478", 4) + C(927, F - 540, 28, "#FFE98A", 1, "#5b6478", 5)
    return s + R(0, F, W, H - F, "#8a93a6") + R(0, F - 4, W, 8, "#7b8498")

def school(W, H, F):
    s = R(0, 0, W, F, "#EAF3E6") + R(120, 300, 840, 440, "#2f6b4f", 18, "#8a6b4a", 18)
    s += f'<text x="540" y="470" text-anchor="middle" font-family="DejaVu Sans" font-size="110" font-weight="800" fill="#ffffff" fill-opacity="0.9">A  B  C</text><text x="540" y="620" text-anchor="middle" font-family="DejaVu Sans" font-size="90" fill="#ffffff" fill-opacity="0.8">1 + 2 = 3</text>'
    s += C(540, 200, 56, "#ffffff", 1, DARK, 8) + R(536, 156, 8, 46, DARK) + R(540, 198, 34, 8, DARK)
    for x in (110, 640):
        s += R(x, 1130, 330, 28, "#b98a58", 8) + R(x + 20, 1158, 18, 110, "#7a5a38") + R(x + 292, 1158, 18, 110, "#7a5a38")
    return s + floor_band(W, H, F, "#D5CBB2", "#b8ad92")

def living(W, H, F):
    s = R(0, 0, W, F, "#FBEFE9") + R(110, 380, 330, 220, "#ffffff", 14, "#e0cfc4", 8) + R(160, 420, 230, 130, "#F15A22", 8, None, 0, 0.35)
    s += R(560, 360, 360, 260, "#2a2f3d", 18, "#5b6478", 10) + R(580, 380, 320, 220, "#7fb4e8", 8)
    s += R(80, 1030, 520, 220, "#0F369D", 40) + R(80, 940, 520, 140, "#1c4bbf", 40) + R(60, 1010, 90, 240, "#0b2a7a", 30) + R(550, 1010, 90, 240, "#0b2a7a", 30)
    s += R(690, 1100, 260, 140, "#a77a52", 12) + C(820, 1060, 50, "#f1d39a") + R(814, 1000, 12, 64, "#8a6b4a")
    s += R(40, 1270, 1000, 40, "#F15A22", 20, None, 0, 0.55)
    return s + floor_band(W, H, F, "#E3C9B8", "#c9ad9b")

def pharmacy(W, H, F):
    s = R(0, 0, W, F, "#E8F6EF")
    for r_ in range(3):
        s += R(60, 330 + r_ * 220, 960, 24, "#ffffff", 6, "#b9d6c8", 4)
        s += "".join(R(90 + 80 * k, 330 + r_ * 220 - 100 + (k * 13 % 30), 56, 100 - (k * 13 % 30), ["#F15A22", "#0F369D", "#ffffff", "#0090D8", "#f7c95a"][(k + r_) % 5], 6, "#8fb3a4", 3) for k in range(12))
    s += R(440, 150, 200, 130, "#2F7D5C", 22) + R(520, 168, 40, 94, "#ffffff", 8) + R(493, 195, 94, 40, "#ffffff", 8)
    s += R(0, 1180, W, 90, "#ffffff", 0, "#b9d6c8", 6) + R(0, 1270, W, F - 1270, "#cfe6da")
    return s + floor_band(W, H, F, "#BFD9CB", "#9fc2b0")

def garden(W, H, F):
    s = R(0, 0, W, F, "#C9ECFB") + C(180, 220, 100, "#FFE070") + C(620, 240, 80, "#ffffff", 0.95) + C(720, 220, 100, "#ffffff", 0.95) + C(840, 250, 70, "#ffffff", 0.95)
    s += R(0, F - 330, W, 330, "#7fd18b")
    for x, h in ((130, 520), (900, 640)):
        s += R(x - 20, F - h, 40, h, "#8a5b35") + C(x, F - h, 150, "#3a9d70") + C(x - 90, F - h + 70, 110, "#2F7D5C") + C(x + 90, F - h + 70, 110, "#4dba84")
    s += R(380, F - 190, 360, 24, "#b98a58", 8) + R(390, F - 166, 18, 90, "#7a5a38") + R(712, F - 166, 18, 90, "#7a5a38") + R(380, F - 280, 360, 20, "#b98a58", 8)
    return s + R(0, F, W, 2000, "#6fc27c") + R(0, F - 4, W, 8, "#4fa85e")

SETS = {"kitchen": kitchen, "clinic": clinic, "bedroom": bedroom, "street": street, "school": school,
        "living": living, "pharmacy": pharmacy, "garden": garden}

def set_svg(name, W=1080, H=1920, floor=1560):
    return SETS[name](W, H, floor)
