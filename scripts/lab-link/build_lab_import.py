#!/usr/bin/env python3
"""Builds the partner-lab import for staff review. NEVER run against production by this script: it only writes files.

  python3 -I scripts/lab-link/build_lab_import.py <lab_parsed.csv> <center_lab.json> <out_dir> [--lab "Dream Lab"] [--source "Dream 2024 Lab to Lab"]

Outputs (in <out_dir>, keep them OUT of git: they hold the partner lab's cost prices):
  lab_clean.csv      cleaned partner-lab rows (merged PDF rows split, stray numbers removed, flags set)
  lab_match_v2.csv   every lab row with confidence and the ranked candidates, for a quick human skim
  lab_import.sql     idempotent SQL for the Supabase SQL editor (after the migration is applied and the owner approves)
Nothing is ever written as 'confirmed': every row enters as 'suggested' and staff decide in the dashboard.
"""
import argparse
import csv
import json
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lab_match import Matcher, confidence, parse_lab_name  # noqa: E402

# PDF rows where two or more tests were glued together by the text extraction.
# key = exact parsed name; value = list of (name, turnaround, price) - None price/turnaround means "not in the PDF text".
SPLITS = {
    # exact parsed row text -> the test names inside it, in order. Numbers are NOT stored here: the turnaround/price written between two
    # names belong to the earlier test (parsed from the row text itself); the last test takes the row's own turnaround and price.
    'Albuminin Serum Urine Fluid 1 day 10 Alcohol in blood Plasma': ['Albuminin Serum Urine Fluid', 'Alcohol in blood Plasma'],
    'Anti Sperm Ab Serum Semen Fluid 10 days 240 Anti Thrombin III Plasma': ['Anti Sperm Ab Serum Semen Fluid', 'Anti Thrombin III Plasma'],
    'Blood Culture Media 70 Blood Film EDTA 1 day Blood Group EDTA': ['Blood Culture Media', 'Blood Film EDTA', 'Blood Group EDTA'],
    'Chloride Serum Urine Fluid 1 day 20 Cholesterol Fasting Serum': ['Chloride Serum Urine Fluid', 'Cholesterol Fasting Serum'],
    'Colony Count 30 Coombs Test (Direct) SerumEDTA': ['Colony Count', 'Coombs Test (Direct) SerumEDTA'],
    'Culture & Sensitivity (Aerobic) 3-5 days Culture & Sensitivity (Anaerobic)': ['Culture & Sensitivity (Aerobic)', 'Culture & Sensitivity (Anaerobic)'],
    'E-GFR Serum 1 day E3 (Unconjugatedestriol) Serum 1 day EBNA Serum': ['E-GFR Serum', 'E3 (Unconjugatedestriol) Serum', 'EBNA Serum'],
    'FUNGUS KOHPREPARATION Sample 1 day Factor V in plasma (5) Citrate Plasma': ['FUNGUS KOHPREPARATION Sample', 'Factor V in plasma (5) Citrate Plasma'],
    'Folic Acid (RBC) EDTA 1 day Free Androgen Index (FAI) Serum': ['Folic Acid (RBC) EDTA', 'Free Androgen Index (FAI) Serum'],
    'Hemoglobin Electrophoresis EDTA 5 days Hemoglobin Separation (HPLC) EDTA': ['Hemoglobin Electrophoresis EDTA', 'Hemoglobin Separation (HPLC) EDTA'],
    'Osmotic Fragility Heparine 25 PAPP Serum': ['Osmotic Fragility Heparine', 'PAPP Serum'],
    'Protein Electrophoresis Serum 7 days Protein in 24Hr urine. SerumUrine': ['Protein Electrophoresis Serum', 'Protein in 24Hr urine. SerumUrine'],
    'Sputum C/S Sputum 3-5 days Stone Analysis (Calculi) Stone': ['Sputum C/S Sputum', 'Stone Analysis (Calculi) Stone'],
    'Stool C/S Stool 3-5 days Stool Examination Stool': ['Stool C/S Stool', 'Stool Examination Stool'],
    'TB Ab 110 TB - DNA By PCR By Taqman Probe 700 TB Culture 150 TB Film (Z.N) Urine Pus Sputum 1 day 30 TBG (Thyroid Binding Globulin) Serum': [
        'TB Ab', 'TB - DNA By PCR By Taqman Probe', 'TB Culture', 'TB Film (Z.N) Urine Pus Sputum', 'TBG (Thyroid Binding Globulin) Serum'],
    'Uric acid Pleural Urine Serum 1 day 10 Urine Analysis Urine': ['Uric acid Pleural Urine Serum', 'Urine Analysis Urine'],
}
STRAY = re.compile(r'^((?:\d+\s+)+)(?=[A-Za-z])')


def clean_rows(rows):
    out = []
    for n, r in enumerate(rows, start=2):  # n = csv line number, used as source_row
        name, turn, price = r['name'].strip(), (r['turnaround'] or '').strip() or None, r['price'].strip()
        price = float(price) if price else None
        if name in SPLITS:
            names, rest = SPLITS[name], name
            for k, nm in enumerate(names):
                assert rest.startswith(nm), (nm, rest)
                rest = rest[len(nm):].strip()
                if k == len(names) - 1:
                    tn, pr = turn, price
                else:
                    nxt = rest.find(names[k + 1])
                    seg, rest = rest[:nxt], rest[nxt:]
                    tm = re.search(r'\d+(?:-\d+)?\s+days?', seg)
                    tn = tm.group(0) if tm else None
                    left = seg.replace(tm.group(0), '') if tm else seg
                    pm = re.search(r'\d+(?:\.\d+)?', left)
                    pr = float(pm.group(0)) if pm else None
                flag = 'split_from_merged_pdf_row'
                if pr is None:
                    flag += ';price_missing'
                if tn is None:
                    flag += ';turnaround_missing'
                out.append((n * 10 + k, nm, tn, pr, flag))
            continue
        flag = ''
        m = STRAY.match(name)
        if m:
            name = name[m.end():]
            flag = 'stray_numbers_removed:' + m.group(1).strip()
        out.append((n * 10, name, turn, price, flag))
    return out


def sql_str(v):
    return 'null' if v is None else "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('parsed'), ap.add_argument('center'), ap.add_argument('out')
    ap.add_argument('--lab', default='Dream Lab'), ap.add_argument('--source', default='Dream 2024 Lab to Lab')
    ap.add_argument('--version', type=int, default=1)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rows = list(csv.DictReader(open(a.parsed, encoding='utf-8')))
    services = [s for s in json.load(open(a.center, encoding='utf-8'))]
    cleaned = clean_rows(rows)
    m = Matcher(services)
    price = {s['id']: float(s['base_price']) for s in services}

    version_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f'swnw/partner-lab/{a.lab}/{a.version}'))
    items, links, review = [], [], []
    for src, name, turn, cost, flag in cleaned:
        core, sample_text, groups = parse_lab_name(name)
        cands, _, _ = m.candidates(name)
        conf = confidence(cands)
        items.append((src, core, sample_text, turn, cost, flag))
        for rank, c in enumerate(cands, start=1):
            note = 'تعارض نوع العينة' if c['sample_conflict'] else ('نفس العينة' if c['sample_match'] else ('العينة غير محددة في اسم خدمة المركز' if c['sample_unspecified'] else ''))
            cconf = conf if rank == 1 else ('medium' if c['score'] >= 0.75 and not c['sample_conflict'] else 'low')
            links.append((src, c['service_id'], cconf, c['score'], rank, note))
        review.append([src, name, sample_text, turn or '', '' if cost is None else cost, flag, conf] + [
            f"{c['name']} [{c['score']}{' CONFLICT' if c['sample_conflict'] else ''}] {price.get(c['service_id'], '')}" for c in cands[:3]])

    with open(os.path.join(a.out, 'lab_clean.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['source_row', 'test_name', 'sample', 'turnaround', 'cost', 'import_flag'])
        w.writerows(items)
    with open(os.path.join(a.out, 'lab_match_v2.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['source_row', 'lab_name', 'sample', 'turnaround', 'cost', 'flag', 'confidence', 'cand1', 'cand2', 'cand3'])
        w.writerows(review)

    L = ['-- GENERATED by scripts/lab-link/build_lab_import.py. Contains partner cost prices: do NOT commit.',
         '-- Apply ONLY after the migration 20261108120000_partner_lab_links.sql is live and the owner approves.',
         '-- Idempotent: re-running adds nothing twice. Every link enters as "suggested"; staff confirm in the dashboard.',
         'begin;',
         "insert into clinic_labs.price_versions(id,lab_name,source_name,version,note) values (%s,%s,%s,%d,%s) on conflict do nothing;" % (
             sql_str(version_id), sql_str(a.lab), sql_str(a.source), a.version, sql_str('imported from the owner PDF; cost = what the partner lab charges the center'))]
    L.append('insert into clinic_labs.price_items(version_id,source_row,test_name,sample,turnaround,cost,import_flag) values')
    L.append(',\n'.join("(%s,%d,%s,%s,%s,%s,%s)" % (sql_str(version_id), s, sql_str(n), sql_str(sm or None), sql_str(t),
                                                        'null' if c is None else repr(c), sql_str(fl or None)) for s, n, sm, t, c, fl in items))
    L.append('on conflict (version_id,source_row) do nothing;')
    L.append('insert into clinic_labs.item_links(item_id,service_id,status,confidence,score,rank,suggested_by,match_note)')
    L.append("select i.id,s.id,'suggested',v.conf,v.score,v.rank,'matcher-v2',nullif(v.note,'') from (values")
    L.append(',\n'.join("(%d,%s::uuid,%s,%s::numeric,%d,%s)" % (s, sql_str(sid), sql_str(cf), sc, rk, sql_str(nt)) for s, sid, cf, sc, rk, nt in links))
    L.append(") as v(source_row,service_id,conf,score,rank,note)")
    L.append("join clinic_labs.price_items i on i.version_id=%s and i.source_row=v.source_row" % sql_str(version_id))
    L.append("join public.pricing_services s on s.id=v.service_id on conflict do nothing;")
    L.append('commit;')
    open(os.path.join(a.out, 'lab_import.sql'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')

    from collections import Counter
    c = Counter(r[6] for r in review)
    print(f'lab rows in: {len(rows)}  cleaned items: {len(items)}  links: {len(links)}  confidence: {dict(c)}')
    print('flagged:', sum(1 for i in items if i[5]), ' price missing:', sum(1 for i in items if i[4] is None))


if __name__ == '__main__':
    main()
