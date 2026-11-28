#!/usr/bin/env python3
"""Normalize the owner's syndicate / institution price files into the dashboard import format.

Input : docs/price-lists/20261128/*.xlsx  (as sent by the owner)
Output: docs/price-lists/20261128/normalized/<file>.xlsx with one sheet «Services» and the columns the import reader
        detects (price-import-reader.js): «كود الخدمة», «اسم الخدمة», «السعر», «القسم», plus «ملاحظة» (source sheet/row).
        docs/price-lists/20261128/normalized/REPORT.md — row counts per section and every row that needs a human.
Rules (no guessing):
  * price = the «قيمة 100%» / total column (the full price), never the member/parent shares;
  * a section title row («📋 أولاً: …») becomes the «القسم» of the rows under it (prefixed with the sheet name);
  * a cell with two prices («190\n110») is NOT split: the row is written with no price and listed in REPORT.md;
  * the 2024 consultation sheet keeps the Cairo table only (other governorates do not apply);
  * institution tables with one price per room class are written one row per class: «<service> — <class>».
"""
import re, sys, openpyxl
from pathlib import Path

SRC = Path('docs/price-lists/20261128'); OUT = SRC / 'normalized'
AR = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')

def num(v):
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().translate(AR).replace(',', '').replace('جنيه', '').replace('جنية', '').strip()
    return float(s) if re.fullmatch(r'\d+(\.\d+)?', s) else None

def clean(v):
    return re.sub(r'\s+', ' ', str(v or '')).strip()

HEADER_WORDS = {'قيمة الكشف (100%)', 'العيادة / الجهة الطبية', 'كود الإجراء', 'قيمة 100%', 'قيمة 100% (القاهرة)', 'السعر', 'إجمالي التكلفة', 'السعر الاسترشادي (100%)', 'نوع الخدمة المؤداة'}

def is_title(row):
    cells = [clean(c) for c in row if clean(c)]
    return len(cells) == 1 and (cells[0].startswith('📋') or not any(num(c) is not None for c in row))

def header_index(rows, want_price=('قيمة الكشف (100%)', 'قيمة 100%', 'قيمة 100% (القاهرة)', 'القاهرة 2025', 'إجمالي التكلفة', 'السعر', 'السعر ')):
    for i, r in enumerate(rows[:40]):
        cells = [clean(c) for c in r]
        for p in want_price:
            if clean(p) in cells:
                return i, cells
    return None, None

def tabular(ws, sheet_label):
    """Syndicate-style sheet: code + name + 100% price, section titles in between."""
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    out, flags, section = [], [], sheet_label
    hi, head = header_index(rows)
    if hi is None: return out, [f'«{sheet_label}»: no price header found — skipped'], 0
    def col(*names):
        for n in names:
            for j, h in enumerate(head):
                if h == n or (n and h.startswith(n)): return j
        return None
    c_code = next((j for j, h in enumerate(head) if h == 'كود الإجراء'), None); c_price = col('قيمة الكشف (100%)', 'قيمة 100%', 'القاهرة 2025', 'إجمالي التكلفة', 'السعر')
    c_name = col('نوع الخدمة المؤداة (عربي)', 'نوع الخدمة المؤداة', 'اسم الخدمة الطبية', 'اسم الخدمة', 'نوع الخدمة', 'نوع الاشعة', 'العيادة / الجهة الطبية')
    c_en = col('نوع الخدمة (إنجليزي)')
    for i, r in enumerate(rows):
        if i == hi: continue
        if not any(clean(c) for c in r): continue
        if is_title(r):
            section = sheet_label + ' — ' + clean(next(c for c in r if clean(c))).replace('📋', '').strip(' :')
            continue
        if [clean(c) for c in r] == head: continue
        if any(clean(c) in HEADER_WORDS for c in r): continue  # header repeated under each section title
        name = clean(r[c_name]) if c_name is not None and c_name < len(r) else ''
        if c_en is not None and c_en < len(r) and clean(r[c_en]): name = f'{name} ({clean(r[c_en])})' if name else clean(r[c_en])
        if not name: continue
        if head[0] == 'العيادة / الجهة الطبية':  # 2024 consultation table: clinic + doctor grade
            name = f'{clean(r[0])} — {clean(r[1])}'
        raw = r[c_price] if c_price is not None and c_price < len(r) else None
        price = num(raw)
        code = clean(r[c_code]) if c_code is not None and c_code < len(r) else ''
        if price is None:
            flags.append(f'«{sheet_label}» row {i+1}: «{name[:60]}» — price «{clean(raw)}» not a single number')
        if head[0] == 'العيادة / الجهة الطبية' and 'القاهرة' not in section:
            continue  # consultation prices for other governorates do not apply to the center (Cairo/Giza)
        out.append([code, name, price, section, f'{ws.title}!{i+1}'])
    return out, flags, hi

def classed(ws, sheet_label, name_col=1, first_price_col=2):
    """Institution table with one price per class column (room class / operation grade)."""
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    hi = next((i for i, r in enumerate(rows[:10]) if clean(r[0]) == 'م'), None)
    if hi is None: return tabular(ws, sheet_label)
    head = [clean(c) for c in rows[hi]]
    classes = [(j, h) for j, h in enumerate(head) if j >= first_price_col and h]
    out, flags = [], []
    for i, r in enumerate(rows[hi + 1:], start=hi + 1):
        name = clean(r[name_col]) if name_col < len(r) else ''
        if not name: continue
        for j, h in classes:
            raw = r[j] if j < len(r) else None
            if not clean(raw): continue
            price = num(raw)
            if price is None: flags.append(f'«{sheet_label}» row {i+1}: «{name[:40]} — {h}» — price «{clean(raw)}» not a single number')
            out.append(['', f'{name} — {h}', price, sheet_label, f'{ws.title}!{i+1}'])
    return out, flags, hi

PLAN = {
    'therapeutic-institution-2023.xlsx': {'خدمات الاقامة الخلية': classed, 'اجور العمليات': classed, 'الرعاية الطبية ': classed},
}

def main():
    OUT.mkdir(exist_ok=True)
    report = ['# Normalized price lists (2026-11-28)', '',
              'Generated by `scripts/normalize-price-lists.py`. Price = full (100%) column. Nothing was guessed: rows listed under «needs a human» have no price in the file and are imported without one (the import screen shows them as «محتاج قرار»).', '']
    for f in sorted(SRC.glob('*.xlsx')):
        wb = openpyxl.load_workbook(f, data_only=True)
        rows, flags, per = [], [], {}
        for ws in wb.worksheets:
            if ws.max_row < 2: continue
            label = clean(ws.title)
            fn = PLAN.get(f.name, {}).get(ws.title, tabular)
            got, fl, _ = fn(ws, label)
            rows += got; flags += fl
            for r in got: per[r[3]] = per.get(r[3], 0) + 1
        nb = openpyxl.Workbook(); sh = nb.active; sh.title = 'Services'
        sh.append(['كود الخدمة', 'اسم الخدمة', 'السعر', 'القسم', 'ملاحظة'])
        for r in rows: sh.append(r)
        nb.save(OUT / f.name)
        priced = sum(1 for r in rows if r[2] is not None)
        report += [f'## {f.name}', '', f'- rows: **{len(rows)}** (priced {priced}, no price {len(rows) - priced})', '', '| القسم | rows |', '|---|---|']
        report += [f'| {k} | {v} |' for k, v in per.items()]
        if flags: report += ['', '**needs a human:**', ''] + [f'- {x}' for x in flags]
        report.append('')
    (OUT / 'REPORT.md').write_text('\n'.join(report), encoding='utf-8')
    print('\n'.join(report[:4])); print('done')

if __name__ == '__main__':
    main()
