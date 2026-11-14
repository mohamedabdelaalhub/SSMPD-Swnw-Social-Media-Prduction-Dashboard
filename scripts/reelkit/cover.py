#!/usr/bin/env python3
"""Reel cover in the approved Swnw cover style (docs/templates/sono-reel-cover/cover.html) on top of the clean frame build.py saves.
python3 scripts/reelkit/cover.py OUTDIR "<title with *key words*>" "<tag>" "<subtitle>" [--brand sono]
 -> OUTDIR/reel-cover.png (1080x1920). Title: ≤3 lines, use \\n for a line break, *word* = orange key word. Upload it with the gateway ?op=upload_cover&content_id=<id>."""
import sys, os, re, html, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.environ.get("SSMPD_REPO", os.path.abspath(os.path.join(HERE, "..", "..")))
out, title, tag, sub = sys.argv[1:5]
tpl = open(os.path.join(REPO, "docs/templates/sono-reel-cover/cover.html")).read()
h1 = html.escape(title).replace("\\n", "<br>").replace("\n", "<br>"); h1 = re.sub(r"\*(.+?)\*", r'<span class=or>\1</span>', h1)
body = f'<div class=t><span class=tag>{html.escape(tag)}</span><h1>{h1}</h1><p>{html.escape(sub)}</p></div>'
tpl = re.sub(r"<div class=t>.*?</div>", body, tpl, flags=re.S)
tpl = tpl.replace("../../../assets", REPO + "/assets").replace("url(PHOTO.jpg)", "url(file://" + os.path.abspath(os.path.join(out, "cover_frame.png")) + ")")
hp = os.path.join(out, "cover.html"); open(hp, "w").write(tpl)
js = os.path.join(out, "cover_shot.js")
open(js, "w").write("""const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+process.argv[2]);await p.evaluate(()=>document.fonts.ready);
const ok=await p.evaluate(()=>document.fonts.check('700 80px BV'));if(!ok){console.error('FONT NOT LOADED');process.exit(2)}
await p.screenshot({path:process.argv[3]});await b.close()})()""")
subprocess.run(["node", js, os.path.abspath(hp), os.path.abspath(os.path.join(out, "reel-cover.png"))], check=True)
print("cover:", os.path.join(out, "reel-cover.png"))
