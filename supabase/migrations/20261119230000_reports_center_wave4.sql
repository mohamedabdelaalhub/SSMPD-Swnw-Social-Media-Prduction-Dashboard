-- Reports center — wave 4 (owner request 2026-11-19): financial statements from the single general ledger.
-- Source: clinic_finance.entries/lines (live reception postings are mirrored there by clinic_reception.post; trial
-- workspaces never reach it). Every report also counts live reception journal rows that have no finance entry
-- («غير مُرحّل») so a gap can never hide silently.
-- Branch: an entry belongs to a branch when it comes from a reception journal row (source 'reception_%') of that
-- branch's live workspace. With a branch selected, entries without a branch are reported apart as «غير موزّع على فرع».
-- Account grouping by code prefix (chart of accounts): 4 income · 51 cost of services · 52 general & administrative ·
-- other 5 other expenses · 111 cash and banks · 12 fixed assets · 214 / 1143 taxes.
begin;

insert into public.report_registry(code, title, area, sort, sensitive) values
  ('branch_pnl',      'قائمة الدخل للفرع',                'statements', 100, false),
  ('balance_sheet',   'الميزانية العمومية',                'statements', 105, false),
  ('gna_expenses',    'المصروفات الإدارية والعمومية',      'statements', 110, false),
  ('cash_flow',       'التدفقات النقدية',                  'statements', 115, false),
  ('fixed_assets',    'الأصول الثابتة والإهلاك',           'statements', 120, false),
  ('tax_position',    'الموقف الضريبي',                    'statements', 125, false);

insert into public.report_access(report_code, role)
select r, x from (values
  ('branch_pnl','general_manager'), ('branch_pnl','financial_manager'), ('branch_pnl','accountant'),
  ('balance_sheet','general_manager'), ('balance_sheet','financial_manager'), ('balance_sheet','accountant'),
  ('gna_expenses','general_manager'), ('gna_expenses','financial_manager'), ('gna_expenses','accountant'),
  ('cash_flow','general_manager'), ('cash_flow','financial_manager'), ('cash_flow','accountant'),
  ('fixed_assets','general_manager'), ('fixed_assets','financial_manager'), ('fixed_assets','accountant'),
  ('tax_position','general_manager'), ('tax_position','financial_manager'), ('tax_position','accountant')) v(r, x);

-- GL lines with account metadata and branch attribution. Internal helper (not granted).
create function public.report_gl(p_branch uuid)
returns table(entry_id uuid, day date, account text, account_name text, kind text, parent_code text, parent_name text,
              debit numeric, credit numeric, in_branch boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with eb as (
    select e.id, e.business_date, w.branch_id
      from clinic_finance.entries e
      left join clinic_reception.journal j on e.source like 'reception\_%' and j.id = e.source_id and j.finance_entry_id = e.id
      left join clinic_reception.workspaces w on w.id = j.workspace_id and w.mode = 'live')
  select l.entry_id, eb.business_date, l.account, a.name, a.kind, cfg.parent_code, pa.name, l.debit, l.credit,
         (p_branch is null or coalesce(eb.branch_id = p_branch, false))
    from clinic_finance.lines l
    join eb on eb.id = l.entry_id
    join clinic_finance.accounts a on a.code = l.account
    left join clinic_finance.account_config cfg on cfg.code = l.account
    left join clinic_finance.accounts pa on pa.code = cfg.parent_code
$$;
revoke all on function public.report_gl(uuid) from public, anon, authenticated;

create function public.report_gl_health(p_branch uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'unposted', (select count(*) from clinic_reception.journal j join public.report_workspaces(p_branch) w on w.workspace_id = j.workspace_id
                  where j.finance_entry_id is null),
    'branch_scope', case when p_branch is null then 'all' else 'branch' end)
$$;
revoke all on function public.report_gl_health(uuid) from public, anon, authenticated;

create function public.report_section(p_code text, p_kind text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case when p_kind = 'income' then 'revenue'
              when p_code like '51%' then 'cost_of_services'
              when p_code like '52%' then 'gna'
              when p_kind = 'expense' then 'other_expense'
              else p_kind end
$$;
revoke all on function public.report_section(text, text) from public, anon, authenticated;

-- ── Branch P&L with the previous period of the same length ─────────────────────────────────────────────
create function public.report_branch_pnl(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb; prev_from date := p_from - (p_to - p_from + 1); prev_to date := p_from - 1;
begin
  perform public.report_require('branch_pnl');
  perform public.report_check_period(p_from, p_to);
  with g as (
    select account, account_name, kind, parent_name, public.report_section(account, kind) section, in_branch,
           sum(case when kind = 'income' then credit - debit else debit - credit end) filter (where day between p_from and p_to) cur,
           sum(case when kind = 'income' then credit - debit else debit - credit end) filter (where day between prev_from and prev_to) prev
      from public.report_gl(p_branch) where kind in ('income', 'expense') and day between prev_from and p_to
     group by account, account_name, kind, parent_name, in_branch),
  b as (select * from g where in_branch),
  s as (select section, coalesce(sum(cur), 0) cur, coalesce(sum(prev), 0) prev from b group by section)
  select jsonb_build_object(
    'previous', jsonb_build_object('from', prev_from, 'to', prev_to),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('section', section, 'group', parent_name, 'account', account, 'name', account_name,
              'current', round(coalesce(cur, 0), 2), 'previous', round(coalesce(prev, 0), 2))
              order by case section when 'revenue' then 1 when 'cost_of_services' then 2 when 'gna' then 3 else 4 end, account)
              from b where coalesce(cur, 0) <> 0 or coalesce(prev, 0) <> 0), '[]'::jsonb),
    'totals', (select jsonb_build_object(
              'revenue', coalesce(sum(cur) filter (where section = 'revenue'), 0), 'revenue_prev', coalesce(sum(prev) filter (where section = 'revenue'), 0),
              'cost', coalesce(sum(cur) filter (where section = 'cost_of_services'), 0), 'cost_prev', coalesce(sum(prev) filter (where section = 'cost_of_services'), 0),
              'gna', coalesce(sum(cur) filter (where section = 'gna'), 0), 'gna_prev', coalesce(sum(prev) filter (where section = 'gna'), 0),
              'other', coalesce(sum(cur) filter (where section = 'other_expense'), 0), 'other_prev', coalesce(sum(prev) filter (where section = 'other_expense'), 0)) from s),
    'unallocated', case when p_branch is null then null else (select jsonb_build_object(
              'revenue', coalesce(sum(cur) filter (where kind = 'income'), 0), 'expense', coalesce(sum(cur) filter (where kind = 'expense'), 0))
              from g where not in_branch) end)
    || public.report_gl_health(p_branch)
    into v;
  v := jsonb_set(v, '{totals}', (v->'totals') || jsonb_build_object(
         'gross', (v->'totals'->>'revenue')::numeric - (v->'totals'->>'cost')::numeric,
         'gross_prev', (v->'totals'->>'revenue_prev')::numeric - (v->'totals'->>'cost_prev')::numeric,
         'net', (v->'totals'->>'revenue')::numeric - (v->'totals'->>'cost')::numeric - (v->'totals'->>'gna')::numeric - (v->'totals'->>'other')::numeric,
         'net_prev', (v->'totals'->>'revenue_prev')::numeric - (v->'totals'->>'cost_prev')::numeric - (v->'totals'->>'gna_prev')::numeric - (v->'totals'->>'other_prev')::numeric));
  return v;
end $$;

-- ── Balance sheet as of a date (company level; earnings to date shown as their own line) ───────────────
create function public.report_balance_sheet(p_as_of date default null, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_as_of, (now() at time zone 'Africa/Cairo')::date); v jsonb;
begin
  perform public.report_require('balance_sheet');
  with g as (
    select account, account_name, kind, parent_name,
           sum(case when kind in ('asset', 'expense') then debit - credit else credit - debit end) bal
      from public.report_gl(null) where day <= d group by account, account_name, kind, parent_name),
  t as (select coalesce(sum(bal) filter (where kind = 'asset'), 0) assets, coalesce(sum(bal) filter (where kind = 'liability'), 0) liabilities,
               coalesce(sum(bal) filter (where kind = 'equity'), 0) equity,
               coalesce(sum(bal) filter (where kind = 'income'), 0) - coalesce(sum(bal) filter (where kind = 'expense'), 0) earnings from g)
  select jsonb_build_object(
    'as_of', d, 'scope', 'company',
    'rows', coalesce((select jsonb_agg(jsonb_build_object('section', kind, 'group', parent_name, 'account', account, 'name', account_name, 'balance', round(bal, 2))
              order by case kind when 'asset' then 1 when 'liability' then 2 else 3 end, account)
              from g where kind in ('asset', 'liability', 'equity') and bal <> 0), '[]'::jsonb),
    'totals', (select jsonb_build_object('assets', assets, 'liabilities', liabilities, 'equity', equity, 'earnings', earnings,
              'liabilities_equity', liabilities + equity + earnings, 'difference', round(assets - (liabilities + equity + earnings), 2)) from t))
    || public.report_gl_health(null)
    into v;
  return v;
end $$;

-- ── General & administrative expenses by account (with previous period) ───────────────────────────────
create function public.report_gna_expenses(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb; prev_from date := p_from - (p_to - p_from + 1); prev_to date := p_from - 1;
begin
  perform public.report_require('gna_expenses');
  perform public.report_check_period(p_from, p_to);
  with g as (
    select account, account_name, parent_name,
           coalesce(sum(debit - credit) filter (where day between p_from and p_to), 0) cur,
           coalesce(sum(debit - credit) filter (where day between prev_from and prev_to), 0) prev
      from public.report_gl(p_branch)
     where kind = 'expense' and public.report_section(account, kind) in ('gna', 'other_expense') and in_branch and day between prev_from and p_to
     group by account, account_name, parent_name),
  tot as (select sum(cur) c from g)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('group', parent_name, 'account', account, 'name', account_name, 'current', round(cur, 2),
              'previous', round(prev, 2), 'change', round(cur - prev, 2),
              'share', case when (select c from tot) > 0 then round(100 * cur / (select c from tot), 1) end) order by cur desc, account)
              from g where cur <> 0 or prev <> 0), '[]'::jsonb),
    'totals', (select jsonb_build_object('current', coalesce(sum(cur), 0), 'previous', coalesce(sum(prev), 0), 'change', coalesce(sum(cur - prev), 0)) from g))
    || public.report_gl_health(p_branch)
    into v;
  return v;
end $$;

-- ── Cash flow (direct method on cash & bank accounts 111x; counter-account decides the activity) ──────
create function public.report_cash_flow(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('cash_flow');
  perform public.report_check_period(p_from, p_to);
  with gl as (select * from public.report_gl(p_branch) where in_branch),
  cash as (select entry_id, sum(debit - credit) net from gl where account like '111%' and day between p_from and p_to group by entry_id),
  other as (
    select g.entry_id, g.account, g.account_name, g.kind, (g.credit - g.debit) amt
      from gl g join cash c on c.entry_id = g.entry_id where g.account not like '111%'),
  w as (select entry_id, sum(abs(amt)) total from other group by entry_id),
  alloc as (
    select o.account, o.account_name,
           case when o.account like '12%' then 'investing' when o.kind = 'equity' or o.account like '22%' then 'financing' else 'operating' end activity,
           c.net * abs(o.amt) / nullif(w.total, 0) amount
      from other o join cash c on c.entry_id = o.entry_id join w on w.entry_id = o.entry_id
     where sign(o.amt) = sign(c.net)),
  g as (select activity, account, account_name, sum(amount) filter (where amount > 0) inflow, -sum(amount) filter (where amount < 0) outflow
          from alloc group by activity, account, account_name),
  bal as (select coalesce(sum(debit - credit) filter (where day < p_from), 0) opening, coalesce(sum(debit - credit) filter (where day <= p_to), 0) closing
            from gl where account like '111%')
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('activity', activity, 'account', account, 'name', account_name,
              'inflow', round(coalesce(inflow, 0), 2), 'outflow', round(coalesce(outflow, 0), 2), 'net', round(coalesce(inflow, 0) - coalesce(outflow, 0), 2))
              order by case activity when 'operating' then 1 when 'investing' then 2 else 3 end, account) from g), '[]'::jsonb),
    'by_account', coalesce((select jsonb_agg(jsonb_build_object('account', account, 'name', account_name, 'opening', round(opening, 2), 'closing', round(closing, 2)) order by account)
              from (select account, account_name, coalesce(sum(debit - credit) filter (where day < p_from), 0) opening,
                           coalesce(sum(debit - credit) filter (where day <= p_to), 0) closing
                      from gl where account like '111%' group by account, account_name) x), '[]'::jsonb),
    'totals', (select jsonb_build_object('opening', round(opening, 2), 'closing', round(closing, 2),
              'operating', coalesce((select round(sum(amount), 2) from alloc where activity = 'operating'), 0),
              'investing', coalesce((select round(sum(amount), 2) from alloc where activity = 'investing'), 0),
              'financing', coalesce((select round(sum(amount), 2) from alloc where activity = 'financing'), 0),
              'net', round(closing - opening, 2)) from bal))
    || public.report_gl_health(p_branch)
    into v;
  return v;
end $$;

-- ── Fixed assets: cost, accumulated depreciation, depreciation expense, net book value ─────────────────
create function public.report_fixed_assets(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('fixed_assets');
  perform public.report_check_period(p_from, p_to);
  with gl as (select * from public.report_gl(null) where account like '12%' or account = '5221'),
  g as (
    select account, account_name,
           coalesce(sum(debit - credit) filter (where day < p_from), 0) opening,
           coalesce(sum(debit) filter (where day between p_from and p_to), 0) additions,
           coalesce(sum(credit) filter (where day between p_from and p_to), 0) reductions,
           coalesce(sum(debit - credit) filter (where day <= p_to), 0) closing
      from gl where account like '12%' group by account, account_name)
  select jsonb_build_object(
    'scope', 'company',
    'rows', coalesce((select jsonb_agg(jsonb_build_object('account', account, 'name', account_name, 'opening', round(opening, 2), 'additions', round(additions, 2),
              'reductions', round(reductions, 2), 'closing', round(closing, 2)) order by account) from g where opening <> 0 or additions <> 0 or reductions <> 0), '[]'::jsonb),
    'totals', jsonb_build_object(
              'cost', coalesce((select sum(closing) from g where account not like '129%'), 0),
              'accumulated', coalesce((select -sum(closing) from g where account like '129%'), 0),
              'net_book_value', coalesce((select sum(closing) from g), 0),
              'additions', coalesce((select sum(additions) from g where account not like '129%'), 0),
              'depreciation', coalesce((select sum(debit - credit) from gl where account = '5221' and day between p_from and p_to), 0)))
    || public.report_gl_health(null)
    into v;
  return v;
end $$;

-- ── Tax position: each tax liability / recoverable account, accrued vs paid (no e-invoice link) ────────
create function public.report_tax_position(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('tax_position');
  perform public.report_check_period(p_from, p_to);
  with gl as (select * from public.report_gl(null) where account like '214%' or account = '1143'),
  g as (
    select gl.account, gl.account_name, (gl.account = '1143') recoverable,
           (select string_agg(t.name, '، ') from clinic_finance.tax_types t where t.liability_account = gl.account) tax_types,
           coalesce(sum(case when gl.account = '1143' then debit - credit else credit - debit end) filter (where day < p_from), 0) opening,
           coalesce(sum(case when gl.account = '1143' then debit else credit end) filter (where day between p_from and p_to), 0) accrued,
           coalesce(sum(case when gl.account = '1143' then credit else debit end) filter (where day between p_from and p_to), 0) settled,
           coalesce(sum(case when gl.account = '1143' then debit - credit else credit - debit end) filter (where day <= p_to), 0) closing
      from gl group by gl.account, gl.account_name)
  select jsonb_build_object(
    'scope', 'company', 'e_invoice', false,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('account', account, 'name', account_name, 'tax_types', tax_types, 'recoverable', recoverable,
              'opening', round(opening, 2), 'accrued', round(accrued, 2), 'settled', round(settled, 2), 'closing', round(closing, 2)) order by recoverable, account)
              from g where opening <> 0 or accrued <> 0 or settled <> 0 or closing <> 0), '[]'::jsonb),
    'totals', (select jsonb_build_object('payable', coalesce(sum(closing) filter (where not recoverable), 0), 'recoverable', coalesce(sum(closing) filter (where recoverable), 0),
              'accrued', coalesce(sum(accrued) filter (where not recoverable), 0), 'settled', coalesce(sum(settled) filter (where not recoverable), 0),
              'net_due', coalesce(sum(closing) filter (where not recoverable), 0) - coalesce(sum(closing) filter (where recoverable), 0)) from g))
    || public.report_gl_health(null)
    into v;
  return v;
end $$;

revoke all on function public.report_branch_pnl(date, date, uuid), public.report_balance_sheet(date, uuid), public.report_gna_expenses(date, date, uuid),
  public.report_cash_flow(date, date, uuid), public.report_fixed_assets(date, date, uuid), public.report_tax_position(date, date, uuid) from public, anon;
grant execute on function public.report_branch_pnl(date, date, uuid), public.report_balance_sheet(date, uuid), public.report_gna_expenses(date, date, uuid),
  public.report_cash_flow(date, date, uuid), public.report_fixed_assets(date, date, uuid), public.report_tax_position(date, date, uuid) to authenticated;

commit;
