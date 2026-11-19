#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Swnw official letterhead document builder: cover page + body on the official A4 letterhead.

usage: python3 swnw_doc.py content.json OUTDIR [basename]
Outputs OUTDIR/<basename>.pdf (ready to send) and OUTDIR/<basename>.docx (editable).
Text is typeset verbatim from the JSON; this tool never rewrites wording.
"""
import json, os, subprocess, sys, html, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=HERE, capture_output=True, text=True).stdout.strip() or os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
LETTERHEAD = os.path.join(ROOT, 'assets/img/swnw-official-letterhead.png')
FONT_R = os.path.join(ROOT, 'assets/fonts/BigVesta-Regular.woff2')
FONT_B = os.path.join(ROOT, 'assets/fonts/BigVesta-Bold.woff2')
FADE = 0.55           # how much the big background figure is washed out (0 = original, 1 = gone)
BAND = (0.14, 0.87)   # vertical band of the letterhead that is faded (below the header wave, above the footer)
MARGIN = dict(top=50, bottom=44, side=20)  # mm; keeps text clear of the header wave and footer block

def light_letterhead(out_png):
    from PIL import Image
    im = Image.open(LETTERHEAD).convert('RGB'); w, h = im.size
    y0, y1 = int(h * BAND[0]), int(h * BAND[1])
    band = im.crop((0, y0, w, y1))
    white = Image.new('RGB', band.size, (255, 255, 255))
    im.paste(Image.blend(band, white, FADE), (0, y0))
    im.save(out_png)

def split_title(t):
    for sep in (' — ', ' - '):
        if sep in t: a, b = t.split(sep, 1); return a.strip(), b.strip()
    return t, ''

def build_html(c, out_html, lh_png):
    e = html.escape; m = c['meta']
    css = f"""
@font-face{{font-family:"BigVesta Arabic";src:url("file://{FONT_R}") format("woff2");font-weight:400}}
@font-face{{font-family:"BigVesta Arabic";src:url("file://{FONT_B}") format("woff2");font-weight:700}}
@page{{size:A4;margin:{MARGIN['top']}mm {MARGIN['side']}mm {MARGIN['bottom']}mm {MARGIN['side']}mm}}
*{{box-sizing:border-box}}html{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
body{{margin:0;font-family:"BigVesta Arabic","Hiragino Kaku",Tahoma,sans-serif;color:#16212E;font-size:10.6pt;line-height:1.85;direction:rtl}}
.cover{{height:{297-MARGIN['top']-MARGIN['bottom']-1}mm;display:flex;flex-direction:column;justify-content:center;break-after:page;padding-inline-end:6mm;border-inline-end:4px solid #F15A22}}
.cover .k{{display:inline-block;align-self:flex-start;background:#F15A22;color:#fff;font-weight:700;font-size:10pt;border-radius:99px;padding:.5mm 5mm;margin-bottom:6mm}}
.cover h1{{font-size:25pt;line-height:1.5;color:#0F369D;margin:0 0 4mm;font-weight:700}}
.cover .t2{{font-size:17pt;line-height:1.6;color:#F15A22;font-weight:700;margin:0 0 8mm}}
.cover .rule{{height:3px;width:60mm;background:linear-gradient(90deg,#0F369D 0,#0F369D 70%,#F15A22 70%);border-radius:2px;margin:0 0 8mm}}
.cover .sub{{font-size:12pt;color:#16212E;font-weight:700;margin-bottom:14mm}}
.cover .card{{background:#F4F6FC;border:1px solid #D5DEEE;border-inline-start:4px solid #0F369D;border-radius:3mm;padding:4mm 5mm;margin-bottom:3mm;font-size:11pt;font-weight:700}}
.cover .card b{{color:#0F369D}}
h2{{font-size:12.5pt;color:#0F369D;margin:6mm 0 2.5mm;padding-inline-start:3mm;border-inline-start:3px solid #F15A22;line-height:1.5;font-weight:700;break-after:avoid}}
p{{margin:0 0 2.6mm;text-align:justify}}
ul{{list-style:none;margin:0 0 3mm;padding:0}}
li{{position:relative;padding-inline-start:5.5mm;margin:0 0 2.2mm;text-align:justify;break-inside:avoid}}
li::before{{content:"";position:absolute;inset-inline-start:0;top:.62em;width:2.4mm;height:2.4mm;background:#F15A22;border-radius:.5mm}}
li b{{color:#0F369D}}
.split{{break-inside:avoid;margin:2mm 0 3.5mm}}.split .t{{font-weight:700;margin-bottom:2mm}}
.cards{{display:grid;grid-template-columns:1fr 1fr;gap:4mm}}
.card2{{background:#F4F6FC;border:1px solid #D5DEEE;border-radius:3mm;padding:3.5mm 4mm;display:flex;gap:3.5mm;align-items:flex-start;break-inside:avoid}}
.card2 .n{{flex:none;min-width:17mm;height:17mm;border-radius:50%;background:#0F369D;color:#fff;display:grid;place-items:center;font-weight:700;font-size:12pt}}
.card2.o .n{{background:#F15A22}}.card2 b{{display:block;color:#0F369D;font-size:10pt;line-height:1.6}}.card2 span{{font-size:9.6pt;line-height:1.7;display:block}}
.formula{{break-inside:avoid;background:#FFF4EE;border:1px solid #F7C3A8;border-inline-start:4px solid #F15A22;border-radius:3mm;padding:3.5mm 4.5mm;margin:3.5mm 0}}
.formula .t{{font-weight:700;color:#7A2E0E;margin-bottom:1.5mm}}.formula .f{{font-weight:700;font-size:10.4pt}}
table{{width:100%;border-collapse:separate;border-spacing:0;font-size:9.6pt;line-height:1.7;border:1px solid #D5DEEE;border-radius:3mm;overflow:hidden;break-inside:avoid}}
th{{background:#0F369D;color:#fff;font-weight:700;padding:2.5mm 3mm;text-align:right}}
td{{padding:2.5mm 3mm;border-top:1px solid #E1E5EE;vertical-align:top}}
td:first-child{{font-weight:700;color:#0F369D;background:#F4F6FC;width:30%}}
"""
    o = ['<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>%s</title><style>%s</style></head><body>' % (e(m.get('doc_title', '')), css)]
    if c.get('cover', True):
        t1, t2 = split_title(m['title'])
        o.append('<section class="cover">')
        if m.get('kicker'): o.append('<span class="k">%s</span>' % e(m['kicker']))
        o.append('<h1>%s</h1>' % e(t1))
        if t2: o.append('<div class="t2">%s</div>' % e(t2))
        o.append('<div class="rule"></div>')
        if m.get('subtitle'): o.append('<div class="sub">%s</div>' % e(m['subtitle']))
        for k in ('to', 'date'):
            if m.get(k): o.append('<div class="card">%s</div>' % e(m[k]))
        o.append('</section>')
    for sec in c['sections']:
        o.append('<h2>%s</h2>' % e(sec['title'])); ul = []
        def flush():
            nonlocal ul
            if ul: o.append('<ul>' + ''.join(ul) + '</ul>'); ul = []
        for b in sec['blocks']:
            k = b['type']
            if k == 'bullet': ul.append('<li><b>%s</b> %s</li>' % (e(b['head']), e(b['body'])))
            else:
                flush()
                if k == 'p': o.append('<p>%s</p>' % e(b['text']))
                elif k == 'split':
                    o.append('<div class="split"><div class="t">%s</div><div class="cards">%s</div></div>' % (e(b['title']), ''.join('<div class="card2%s"><div class="n">%s</div><div><b>%s</b><span>%s</span></div></div>' % (' o' if i else '', e(x['num']), e(x['head']), e(x['body'])) for i, x in enumerate(b['items']))))
                elif k == 'formula': o.append('<div class="formula"><div class="t">%s</div><div class="f">%s</div></div>' % (e(b['title']), e(b['text'])))
                elif k == 'table':
                    o.append('<table><thead><tr>%s</tr></thead><tbody>%s</tbody></table>' % (''.join('<th>%s</th>' % e(x) for x in b['head']), ''.join('<tr>%s</tr>' % ''.join('<td>%s</td>' % e(x) for x in r) for r in b['rows'])))
        flush()
    o.append('</body></html>')
    open(out_html, 'w', encoding='utf8').write('\n'.join(o))

def build_pdf(c, work, lh_png, out_pdf):
    h = os.path.join(work, 'doc.html'); build_html(c, h, lh_png)
    body = os.path.join(work, 'body.pdf')
    subprocess.run(['node', os.path.join(HERE, 'render_pdf.cjs'), h, body], check=True)
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    lh = os.path.join(work, 'lh.pdf'); cv = canvas.Canvas(lh, pagesize=A4); cv.drawImage(lh_png, 0, 0, width=A4[0], height=A4[1]); cv.save()
    w = PdfWriter()
    for pg in PdfReader(body).pages:
        base = PdfReader(lh).pages[0]; base.merge_page(pg); w.add_page(base)
    w.add_metadata({'/Title': c['meta'].get('doc_title', '')}); w.write(out_pdf)

def build_docx(c, lh_png, out_docx):
    from docx import Document
    from docx.shared import Mm, Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.section import WD_SECTION
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement, parse_xml
    FONT = 'BigVesta Arabic'; BLUE = RGBColor(0x0F, 0x36, 0x9D); ORANGE = RGBColor(0xF1, 0x5A, 0x22); GREY = RGBColor(0x4C, 0x56, 0x6A)
    d = Document(); sec = d.sections[0]
    sec.page_width = Mm(210); sec.page_height = Mm(297)
    sec.top_margin = Mm(MARGIN['top']); sec.bottom_margin = Mm(MARGIN['bottom']); sec.left_margin = sec.right_margin = Mm(MARGIN['side'])
    sec.header_distance = Mm(0); sec.footer_distance = Mm(0)
    st = d.styles['Normal']; st.font.name = FONT; st.font.size = Pt(10.5)
    rpr = st.element.get_or_add_rPr(); rf = rpr.find(qn('w:rFonts'))
    if rf is None: rf = OxmlElement('w:rFonts'); rpr.append(rf)
    for a in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'): rf.set(qn(a), FONT)
    hp = sec.header.paragraphs[0]; run = hp.add_run(); run.add_picture(lh_png, width=Mm(210), height=Mm(297))
    inline = run._r.xpath('.//wp:inline')[0]; graphic = inline.find(qn('a:graphic'))
    anchor = parse_xml('<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="%d" cy="%d"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="Letterhead"/><wp:cNvGraphicFramePr/></wp:anchor>' % (Mm(210), Mm(297)))
    anchor.append(graphic); inline.getparent().replace(inline, anchor)
    def rtl(p): p._p.get_or_add_pPr().insert(0, OxmlElement('w:bidi'))
    def run_(p, text, bold=False, size=None, color=None):
        r = p.add_run(text); r.bold = bold; r.font.name = FONT
        if size: r.font.size = Pt(size)
        if color is not None: r.font.color.rgb = color
        rp = r._r.get_or_add_rPr(); rp.append(OxmlElement('w:rtl')); f = rp.find(qn('w:rFonts'))
        if f is None: f = OxmlElement('w:rFonts'); rp.insert(0, f)
        for a in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'): f.set(qn(a), FONT)
        if size: z = OxmlElement('w:szCs'); z.set(qn('w:val'), str(int(size * 2))); rp.append(z)
        if bold: rp.append(OxmlElement('w:bCs'))
    def para(text='', bold=False, size=None, color=None, after=6, align=WD_ALIGN_PARAGRAPH.JUSTIFY, keep=False):
        p = d.add_paragraph(); rtl(p); p.alignment = align; pf = p.paragraph_format
        pf.space_after = Pt(after); pf.space_before = Pt(0); pf.line_spacing = 1.35; pf.keep_with_next = keep
        if text: run_(p, text, bold, size, color)
        return p
    def shade(cell, fill):
        sh = OxmlElement('w:shd'); sh.set(qn('w:val'), 'clear'); sh.set(qn('w:color'), 'auto'); sh.set(qn('w:fill'), fill); cell._tc.get_or_add_tcPr().append(sh)
    def borders(cell, color='D5DEEE', sz='6'):
        b = OxmlElement('w:tcBorders')
        for ed in ('top', 'left', 'bottom', 'right'):
            x = OxmlElement('w:' + ed); x.set(qn('w:val'), 'single'); x.set(qn('w:sz'), sz); x.set(qn('w:color'), color); b.append(x)
        cell._tc.get_or_add_tcPr().append(b)
    def cell_text(cell, text, bold=False, color=None, size=9.5):
        p = cell.paragraphs[0]; rtl(p); p.alignment = WD_ALIGN_PARAGRAPH.RIGHT; p.paragraph_format.space_after = Pt(2); p.paragraph_format.line_spacing = 1.3; run_(p, text, bold, size, color)
    def add_line(cell, text, bold=False, size=9.5):
        p = cell.add_paragraph(); rtl(p); p.alignment = WD_ALIGN_PARAGRAPH.RIGHT; p.paragraph_format.line_spacing = 1.3; run_(p, text, bold, size)
    def bidi_table(t): t._tbl.tblPr.append(OxmlElement('w:bidiVisual'))
    m = c['meta']
    if c.get('cover', True):
        t1, t2 = split_title(m['title']); R = WD_ALIGN_PARAGRAPH.RIGHT
        if m.get('kicker'): para(m['kicker'], bold=True, size=10, color=ORANGE, after=10, align=R)
        para(t1, bold=True, size=28, color=BLUE, after=6, align=R)
        if t2: para(t2, bold=True, size=16, color=ORANGE, after=14, align=R)
        if m.get('subtitle'): para(m['subtitle'], bold=True, size=12, after=26, align=R)
        for k in ('to', 'date'):
            if m.get(k):
                tb = d.add_table(rows=1, cols=1); bidi_table(tb); cc = tb.rows[0].cells[0]; shade(cc, 'F4F6FC'); borders(cc); cell_text(cc, m[k], size=11); para(after=4)
        # body starts on a new page; cover content is vertically centred in its own section
        s1 = d.sections[0]; va = OxmlElement('w:vAlign'); va.set(qn('w:val'), 'center'); s1._sectPr.append(va)
        d.add_section(WD_SECTION.NEW_PAGE)
    for s in c['sections']:
        p = para(s['title'], bold=True, size=12.5, color=BLUE, after=4, align=WD_ALIGN_PARAGRAPH.RIGHT, keep=True); p.paragraph_format.space_before = Pt(10)
        bd = OxmlElement('w:pBdr'); r = OxmlElement('w:right'); r.set(qn('w:val'), 'single'); r.set(qn('w:sz'), '24'); r.set(qn('w:space'), '6'); r.set(qn('w:color'), 'F15A22'); bd.append(r); p._p.get_or_add_pPr().append(bd)
        for b in s['blocks']:
            k = b['type']
            if k == 'p': para(b['text'])
            elif k == 'bullet':
                p = para(after=4); p.paragraph_format.right_indent = Mm(5); p.paragraph_format.first_line_indent = Mm(-5)
                run_(p, '■  ', size=8, color=ORANGE); run_(p, b['head'] + ' ', bold=True, color=BLUE); run_(p, b['body'])
            elif k == 'split':
                para(b['title'], bold=True, after=3, keep=True)
                tb = d.add_table(rows=1, cols=2); bidi_table(tb); tb.alignment = WD_TABLE_ALIGNMENT.CENTER
                for i, x in enumerate(b['items']):
                    cc = tb.rows[0].cells[i]; shade(cc, 'F4F6FC'); borders(cc); cell_text(cc, x['num'] + '  ' + x['head'], bold=True, color=(BLUE if i == 0 else ORANGE), size=10.5); add_line(cc, x['body'])
                para(after=4)
            elif k == 'formula':
                tb = d.add_table(rows=1, cols=1); bidi_table(tb); cc = tb.rows[0].cells[0]; shade(cc, 'FFF4EE'); borders(cc, 'F7C3A8', '8')
                cell_text(cc, b['title'], bold=True, color=RGBColor(0x7A, 0x2E, 0x0E), size=10.5); add_line(cc, b['text'], bold=True, size=10.5); para(after=4)
            elif k == 'table':
                n = len(b['head']); tb = d.add_table(rows=1 + len(b['rows']), cols=n); bidi_table(tb); tb.alignment = WD_TABLE_ALIGNMENT.CENTER
                for i, x in enumerate(b['head']):
                    cc = tb.rows[0].cells[i]; shade(cc, '0F369D'); borders(cc, '0F369D'); cell_text(cc, x, bold=True, color=RGBColor(255, 255, 255))
                for ri, r in enumerate(b['rows'], 1):
                    for ci, x in enumerate(r):
                        cc = tb.rows[ri].cells[ci]; borders(cc, 'E1E5EE')
                        if ci == 0: shade(cc, 'F4F6FC'); cell_text(cc, x, bold=True, color=BLUE)
                        else: cell_text(cc, x)
                para(after=4)
    d.core_properties.title = m.get('doc_title', ''); d.save(out_docx)

def main():
    if len(sys.argv) < 3: print(__doc__); sys.exit(1)
    c = json.load(open(sys.argv[1], encoding='utf8')); out = os.path.abspath(sys.argv[2]); base = sys.argv[3] if len(sys.argv) > 3 else 'swnw-document'
    os.makedirs(out, exist_ok=True); work = tempfile.mkdtemp(prefix='swnwdoc-'); lh_png = os.path.join(work, 'letterhead-light.png')
    try:
        light_letterhead(lh_png)
        build_pdf(c, work, lh_png, os.path.join(out, base + '.pdf'))
        build_docx(c, lh_png, os.path.join(out, base + '.docx'))
        print('wrote', os.path.join(out, base + '.pdf'), 'and .docx')
    finally: shutil.rmtree(work, ignore_errors=True)

if __name__ == '__main__': main()
