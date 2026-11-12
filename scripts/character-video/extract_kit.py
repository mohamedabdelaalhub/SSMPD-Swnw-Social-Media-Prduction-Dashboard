#!/usr/bin/env python3
"""EPS character kit -> separated vector parts (SVG) + transparent PNG sprites + index.json.
usage: extract_kit.py <kit.eps> <outdir> [px_per_unit]
Pipeline: gs(EPS->PDF) -> pdftocairo(SVG, flat paths in paint order) -> drop card/frame/banner
-> cluster touching paths by bounding box -> one SVG per part -> Chromium renders PNG (transparent)."""
import sys, os, re, json, subprocess, colorsys
eps, out = sys.argv[1], sys.argv[2]; PPU = float(sys.argv[3]) if len(sys.argv) > 3 else 30
os.makedirs(out + "/svg", exist_ok=True); os.makedirs(out + "/png", exist_ok=True)
pdf = out + "/_kit.pdf"; svgf = out + "/_kit.svg"
subprocess.run(["gs","-q","-dNOPAUSE","-dBATCH","-dSAFER","-sDEVICE=pdfwrite","-dEPSCrop","-sOutputFile="+pdf,eps],check=True,timeout=280)
subprocess.run(["pdftocairo","-svg",pdf,svgf],check=True)
t = open(svgf).read()
W, H = map(float, re.search(r'width="([\d.]+)" height="([\d.]+)"', t).groups())
paths = re.findall(r'<path [^>]*?/>', t)
def bbox(p):
    d = re.search(r' d="([^"]+)"', p).group(1)
    n = [float(x) for x in re.findall(r'-?\d+\.?\d*(?:e-?\d+)?', d)]
    xs, ys = n[0::2], n[1::2]
    return min(xs), min(ys), max(xs), max(ys)
items = []
for i, p in enumerate(paths):
    b = bbox(p); fill = re.search(r'fill="([^"]+)"', p)
    items.append(dict(i=i, p=p, b=b, fill=fill.group(1) if fill else ""))
TEAL = "rgb(10.98"
def drop(it):
    x0,y0,x1,y1 = it["b"]; w,h = x1-x0, y1-y0
    if w*h > 0.2*W*H: return True                    # card / full-canvas backgrounds
    if abs(W-165) < 1:
        if it["fill"].startswith(TEAL): return True  # teal frame + corner dots
        if y1 < 9.5 and 40 < x0 < 125: return True   # "Business concept" banner
    return False
items = [it for it in items if not drop(it)]
# union-find on touching bounding boxes
par = list(range(len(items)))
def find(a):
    while par[a] != a: par[a] = par[par[a]]; a = par[a]
    return a
TOL = 0.12
CELL = 3.0
grid = {}
for k, it in enumerate(items):
    x0,y0,x1,y1 = it["b"]
    for gx in range(int((x0-TOL)//CELL), int((x1+TOL)//CELL)+1):
        for gy in range(int((y0-TOL)//CELL), int((y1+TOL)//CELL)+1):
            grid.setdefault((gx,gy), []).append(k)
for ks in grid.values():
    for ai in range(len(ks)):
        a = ks[ai]; ax0,ay0,ax1,ay1 = items[a]["b"]
        for bi in range(ai+1, len(ks)):
            b = ks[bi]; bx0,by0,bx1,by1 = items[b]["b"]
            if ax0-TOL <= bx1 and bx0-TOL <= ax1 and ay0-TOL <= by1 and by0-TOL <= ay1:
                ra, rb = find(a), find(b)
                if ra != rb: par[rb] = ra
groups = {}
for k, it in enumerate(items): groups.setdefault(find(k), []).append(it)
parts = []
for g in groups.values():
    x0 = min(i["b"][0] for i in g); y0 = min(i["b"][1] for i in g); x1 = max(i["b"][2] for i in g); y1 = max(i["b"][3] for i in g)
    if (x1-x0)*(y1-y0) < 0.04: continue          # specks
    parts.append(dict(g=sorted(g, key=lambda i: i["i"]), b=(x0,y0,x1,y1)))
parts.sort(key=lambda q: (round(q["b"][1]/max(6.0, H/16)), q["b"][0]))
maxdim = max(max(q["b"][2]-q["b"][0], q["b"][3]-q["b"][1]) for q in parts)
PPU = min(PPU, 2400.0 / maxdim)     # keep the biggest part <= ~2400 px
index = []
for n, q in enumerate(parts):
    x0,y0,x1,y1 = q["b"]; pad = 0.05; w, h = x1-x0+2*pad, y1-y0+2*pad
    body = "\n".join(i["p"] for i in q["g"])
    name = f"p{n:03d}"
    open(f"{out}/svg/{name}.svg","w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0-pad:.4f} {y0-pad:.4f} {w:.4f} {h:.4f}" width="{w*PPU:.1f}" height="{h*PPU:.1f}">\n{body}\n</svg>')
    index.append(dict(id=name, x=round(x0,2), y=round(y0,2), w=round(x1-x0,2), h=round(y1-y0,2), cx=round((x0+x1)/2/W,3), cy=round((y0+y1)/2/H,3), paths=len(q["g"])))
json.dump(dict(source=os.path.basename(eps), kit_w=W, kit_h=H, px_per_unit=PPU, parts=index), open(out+"/index.json","w"), indent=1)
print(len(items), "paths ->", len(index), "parts")
