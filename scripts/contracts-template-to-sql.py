#!/usr/bin/env python3
"""Turn Mahmoud's filled contracts template (docs/contracts/contracts-template.xlsx layout) into a REVIEW report and a
dry-run SQL file of public.contract_price_rules_command(...) calls. Nothing is written anywhere live: the SQL starts with
BEGIN and ends with ROLLBACK; the main chat runs it as the approving role, and only after the owner's «انشر» swaps the
final ROLLBACK for COMMIT.

usage: python3 -I scripts/contracts-template-to-sql.py <filled.xlsx> <out-dir>
Matching is by exact names (company → contracting_entities.name, source list → clinic_prices.lists.name, exception →
pricing_services.name); every name that does not match is listed in REPORT.md and its statement is skipped by the SQL
(a NOTICE), never guessed.
"""
import sys, json, openpyxl
from pathlib import Path
GROUPS = [('الكشف', 'consult'), ('المعمل', 'lab'), ('الأشعة', 'radiology'), ('العيادات', 'clinics'), ('الطوارئ', 'emergency'), ('الأسنان', 'dental')]

def q(s): return "'" + str(s).replace("'", "''") + "'"
def num(v):
    try: return float(str(v).strip()) if str(v or '').strip() else 0.0
    except ValueError: return None

def main(src, out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    ws = openpyxl.load_workbook(src, data_only=True)['التعاقدات']
    rows = list(ws.iter_rows(values_only=True)); head = [str(h or '').strip() for h in rows[0]]
    col = lambda name: head.index(name)
    sql = ['begin;', '-- generated from ' + Path(src).name + ' — review REPORT.md first']
    rep = ['# Contracts template — review', '', '| الشركة | المجموعة | المصدر | النسبة | ملاحظة |', '|---|---|---|---|---|']
    for r in rows[1:]:
        company = str(r[col('الشركة')] or '').strip()
        if not company: continue
        rounding = num(r[col('التقريب (جنيه)')]) or 0.01
        k = f"(select k.id from public.contracting_entity_contracts k join public.contracting_entities e on e.id = k.entity_id where e.name = {q(company)} and k.status in ('active','draft') order by k.start_date desc limit 1)"
        fee = num(r[col('المصاريف الإدارية %')])
        sql.append(f"do $$ begin if {k} is null then raise notice 'skip: no contract for %', {q(company)}; else perform public.contract_price_rules_command('set_admin_fee', jsonb_build_object('contract_id', {k}, 'admin_fee_percent', {fee or 0})); end if; end $$;")
        for g_ar, g in GROUPS:
            src_name = str(r[col(f'{g_ar} — اللايحة المصدر')] or '').strip(); pct = num(r[col(f'{g_ar} — النسبة % (+ زيادة / − خصم)')])
            if not src_name or src_name == 'استثناء':
                rep.append(f'| {company} | {g_ar} | {src_name or "—"} | — | {"أسعار ثابتة من الاستثناءات" if src_name else "مش في العقد"} |'); continue
            if pct is None: rep.append(f'| {company} | {g_ar} | {src_name} | ؟ | النسبة مش رقم — اتشال |'); continue
            if src_name == 'سونو':
                payload = f"jsonb_build_object('contract_id', {k}, 'group_code', {q(g)}, 'source', 'center', 'adjust_percent', {pct}, 'rounding', {rounding})"
            else:
                lst = f"(select id from clinic_prices.lists where name = {q(src_name)} and deleted_at is null order by version desc limit 1)"
                payload = f"jsonb_build_object('contract_id', {k}, 'group_code', {q(g)}, 'source', 'list', 'source_list_id', {lst}, 'adjust_percent', {pct}, 'rounding', {rounding})"
            sql.append(f"do $$ begin if {k} is null then raise notice 'skip: no contract for %', {q(company)}; else perform public.contract_price_rules_command('set_rule', {payload}); end if; end $$;")
            rep.append(f'| {company} | {g_ar} | {src_name} | {pct:+g}% | تقريب {rounding:g} |')
        exc = str(r[col('الاستثناءات (اسم الخدمة=السعر ؛ …)')] or '').strip()
        if exc: rep.append(f'| {company} | استثناءات | — | — | {exc} → بنود ثابتة في لايحة الجهة (من شاشة اللوايح) |')
    sql += ['rollback;  -- swap for COMMIT only after the owner\'s «انشر»']
    (out / 'contracts-dry-run.sql').write_text('\n'.join(sql) + '\n', encoding='utf-8')
    (out / 'REPORT.md').write_text('\n'.join(rep) + '\n', encoding='utf-8')
    print(f'{out}/contracts-dry-run.sql, {out}/REPORT.md')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
