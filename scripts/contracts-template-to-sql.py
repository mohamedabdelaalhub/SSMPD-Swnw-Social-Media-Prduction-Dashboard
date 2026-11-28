#!/usr/bin/env python3
"""Read the contracts sheet Mahmoud fills (docs/price-lists/20261128/contracts-sheet-sent-to-mahmoud.xlsx layout:
sheets «الشركات» and «أسعار خاصة») and write a REVIEW report plus a dry-run SQL file of public.contract_price_rules_command
calls. Nothing is written anywhere live: the SQL is BEGIN … ROLLBACK; the main chat runs it as the approving role and only
after the owner's «انشر» swaps the final ROLLBACK for COMMIT.

usage: python3 -I scripts/contracts-template-to-sql.py <filled.xlsx> <out-dir>

Per company row: reference list + year → the source of every group («سونو» = the center list). A group cell is a number
(−discount / +increase on that source), «لا تغطي» (no rule → the service is refused as «مش في العقد»), empty / «مش عارف»
(left out and listed as a question), or «<list> <year> <±n>» / «سونو <±n>» to use another source for that one group.
Optional columns read when present: «التقريب (جنيه)» (default 1), «الكاش باك %», «آجل/نقدي».
Admin fee: «5%» or «5 %» → percent; a bare number ≤ 100 is NOT guessed (amount or percent?) and is listed as a question.
Company / list names must match exactly one live row (the SQL raises a NOTICE and skips otherwise) — nothing is guessed.
"""
import sys, re, openpyxl
from pathlib import Path

GROUPS = [('الكشف %', 'consult'), ('المعمل %', 'lab'), ('الأشعة %', 'radiology'), ('العيادات (إجراءات) %', 'clinics'),
          ('الأسنان %', 'dental'), ('الطوارئ %', 'emergency'), ('العلاج الطبيعي %', 'physio')]
UNKNOWN = {'', 'مش عارف', 'غير معروف', '؟', '?'}
NOT_COVERED = {'لا تغطي', 'لا يغطي', 'مش مغطى', 'لا'}
DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩٫−', '0123456789.-')

def q(s): return "'" + str(s).replace("'", "''") + "'"
def txt(v): return str(v if v is not None else '').translate(DIGITS).strip()
def num(v):
    t = txt(v).replace('%', '').replace('+', '').strip()
    try: return float(t)
    except ValueError: return None

def contract_sql(company):
    return (f"(select k.id from public.contracting_entity_contracts k join public.contracting_entities e on e.id = k.entity_id "
            f"where e.name = {q(company)} and k.status in ('active','draft') order by k.start_date desc limit 1)")

def list_where(name, year):
    # hamza forms folded (live names are spelled both ways); must match exactly ONE list, else the rule is skipped
    f = lambda x: f"translate({x}, 'أإآ', 'ااا')"
    return (f"from clinic_prices.lists where deleted_at is null and {f('name')} ilike {f(q('%' + name + '%'))} "
            f"and name ~ {q('(^|[^0-9])' + str(year) + '([^0-9/]|$)')}")

def list_sql(name, year):
    if name == 'سونو': return None
    return f"(select id {list_where(name, year)})"

def main(src, out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.load_workbook(src, data_only=True)
    ws = wb['الشركات']; rows = list(ws.iter_rows(values_only=True)); head = [txt(h) for h in rows[0]]
    has = lambda n: n in head
    get = lambda r, n: r[head.index(n)] if has(n) else None
    sql = ['begin;', f'-- generated from {Path(src).name} — read REPORT.md first']
    rep = ['# جدول التعاقدات — مراجعة قبل التنفيذ', '', '| الشركة | المجموعة | المصدر | النسبة | ملاحظة |', '|---|---|---|---|---|']
    questions = []
    for r in rows[1:]:
        company = txt(get(r, 'اسم الشركة / الجهة'))
        if not company: continue
        ref, year = txt(get(r, 'اللايحة المرجعية')), txt(get(r, 'سنة اللايحة'))
        if not any(txt(get(r, g)) for g, _ in GROUPS) and not ref: continue  # untouched row
        rounding = num(get(r, 'التقريب (جنيه)')) or 1
        k = contract_sql(company)
        guard = lambda body: f"do $$ begin if {k} is null then raise notice 'skip: no contract for %', {q(company)}; else {body} end if; end $$;"
        fee = txt(get(r, 'المصاريف الإدارية (مبلغ أو %)'))
        if fee and fee not in UNKNOWN:
            if '%' in fee and num(fee) is not None:
                sql.append(guard(f"perform public.contract_price_rules_command('set_admin_fee', jsonb_build_object('contract_id', {k}, 'admin_fee_percent', {num(fee)}));"))
                rep.append(f'| {company} | المصاريف الإدارية | — | {num(fee):g}% | على: {txt(get(r, "المصاريف الإدارية بتتحسب على إيه")) or "؟"} |')
            else: questions.append(f'{company}: المصاريف الإدارية «{fee}» — مبلغ ولا نسبة؟ وبتتحسب على إيه؟')
        for col, g in GROUPS:
            cell = txt(get(r, col))
            if cell in UNKNOWN: questions.append(f'{company}: {col} فاضية / مش معروفة'); continue
            if cell in NOT_COVERED: rep.append(f'| {company} | {col} | — | — | لا تغطي → «مش في العقد» |'); continue
            m = re.fullmatch(r'(.+?)\s*(\d{4})?\s*([+-]?\d+(?:\.\d+)?)\s*%?', cell)
            if num(cell) is not None: s_name, s_year, pct = ref, year, num(cell)
            elif m and not m.group(1).replace('.', '').isdigit(): s_name, s_year, pct = m.group(1).strip(), m.group(2) or year, float(m.group(3))
            else: questions.append(f'{company}: {col} = «{cell}» مش مفهومة'); continue
            if not s_name or s_name in UNKNOWN: questions.append(f'{company}: اللايحة المرجعية ناقصة'); continue
            if s_name not in ('سونو',) and not s_year: questions.append(f'{company}: سنة لايحة «{s_name}» ناقصة'); continue
            lst = list_sql(s_name, s_year)
            if lst is None: payload = f"jsonb_build_object('contract_id', {k}, 'group_code', {q(g)}, 'source', 'center', 'adjust_percent', {pct}, 'rounding', {rounding})"
            else: payload = f"jsonb_build_object('contract_id', {k}, 'group_code', {q(g)}, 'source', 'list', 'source_list_id', {lst}, 'adjust_percent', {pct}, 'rounding', {rounding})"
            body = f"perform public.contract_price_rules_command('set_rule', {payload});"
            if lst is not None: body = f"if (select count(*) {list_where(s_name, s_year)}) <> 1 then raise notice 'skip: list % % — not exactly one match', {q(s_name)}, {q(s_year)}; else {body} end if;"
            sql.append(guard(body))
            rep.append(f'| {company} | {col} | {s_name} {s_year if s_name != "سونو" else ""} | {pct:+g}% | تقريب {rounding:g} |')
        for extra in ('الكاش باك %', 'آجل/نقدي', 'نسبة تحمّل المريض %', 'نسبة تحمّل الوالدين/الأسرة % (لو مختلفة)', 'شرايح؟ (تصاعدي/على الإجمالي/لا)', 'موافقة مسبقة؟', 'حد أقصى / عدد جلسات'):
            v = txt(get(r, extra))
            if v: rep.append(f'| {company} | {extra} | — | {v} | يتسجل على العقد يدوي (مش من السكريبت ده) |')
    if 'أسعار خاصة' in wb.sheetnames:
        n = 0
        for r in list(wb['أسعار خاصة'].iter_rows(values_only=True))[1:]:
            if txt(r[1]) and txt(r[3]) and num(r[4]) is not None:
                n += 1; rep.append(f'| {txt(r[1])} | سعر خاص | {txt(r[2]) or "—"} {txt(r[3])} | {num(r[4]):g} ج | يتضاف بند ثابت في لايحة الجهة (استيراد اللوايح) |')
        rep.append(f'\nأسعار خاصة: {n} سطر')
    rep += ['', '## أسئلة لمحمود', ''] + [f'- {x}' for x in questions or ['مفيش']]
    sql.append("rollback;  -- swap for COMMIT only after the owner's «انشر»")
    (out / 'contracts-dry-run.sql').write_text('\n'.join(sql) + '\n', encoding='utf-8')
    (out / 'REPORT.md').write_text('\n'.join(rep) + '\n', encoding='utf-8')
    print(f'{out}/contracts-dry-run.sql  {out}/REPORT.md  ({len(sql) - 3} statements, {len(questions)} questions)')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
