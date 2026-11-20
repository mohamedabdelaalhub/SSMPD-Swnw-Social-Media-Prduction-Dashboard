-- «عايز الصرف وعايز الصافي يتحسب» (owner 2026-11-21). Payout receipts of Masa (GlTakingReceipt type 2 «صرف») are copied here beside the
-- collections already copied by 20261120170000, with the expense account of the journal entry that records each one, so finance can see
-- income, expenses and the net. Copy only: nothing is posted to clinic_finance shifts, entries or balances.
--   * op masa_payouts_import {date, source:'masa'|'old', generated_at, payouts:[{masa_payout_id, receipt_no, paid_at, cashier_user_id,
--       is_deleted, total, lines:[{payment_type_id, currency_id, amount, safe_id}], accounts:[{account_code, account_name, parent_name,
--       debit, credit}]}]}  -> upsert by masa_payout_id (old-database ids arrive prefixed 'old:'), lines/accounts replaced as a set, a void
--       is is_deleted = true. The expense account is the DEBIT line; the credit line is the safe.
--   * clinic_finance.masa_account_kinds: finance classifies each Masa account name as operating | advance | partner_draw | transfer | ignore.
--       Default when not classified: names starting «جارى/جاري شريك» = partner_draw, names starting «خزين/الخزين» = transfer (money moved
--       between safes, not spent), names containing «سلف» = advance, everything else = operating.
--   * public.clinic_finance_masa_net('report'|'classify'): income (copied receipts) minus payouts by kind, per month or day.
--       net_cash   = income - everything paid out except transfers/ignored.
--       net_operating = income - operating expenses only (partner draws, advances and transfers excluded).
-- Finance only (clinic_finance.allowed('view') to read, 'update' to classify). Rollback in supabase/rollbacks.
begin;

do $$ begin
  if to_regclass('clinic_finance.masa_receipts') is null or to_regprocedure('public.clinic_reception_fallback_api(text,jsonb)') is null
     or to_regprocedure('clinic_finance.masa_int(jsonb)') is null or to_regprocedure('clinic_finance.masa_local_ts(text)') is null
     or to_regprocedure('clinic_finance.allowed(text)') is null then raise exception 'مكونات تحصيل ماسا غير موجودة'; end if;
  if to_regclass('clinic_finance.masa_payouts') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_finance.masa_payouts(
  masa_payout_id text primary key check (length(masa_payout_id) between 1 and 40), source text not null default 'masa' check (source in ('masa', 'old')),
  receipt_no text, paid_at timestamptz, day date not null, cashier_user_id int, is_deleted boolean not null default false,
  total numeric(14,2) not null default 0, first_seen_at timestamptz not null default now(), synced_at timestamptz not null default now());
create index on clinic_finance.masa_payouts(day);

create table clinic_finance.masa_payout_lines(
  id bigint generated always as identity primary key,
  masa_payout_id text not null references clinic_finance.masa_payouts(masa_payout_id) on delete cascade,
  payment_type_id int, currency_id int, amount numeric(14,2) not null default 0, safe_id int);
create index on clinic_finance.masa_payout_lines(masa_payout_id);

create table clinic_finance.masa_payout_accounts(
  id bigint generated always as identity primary key,
  masa_payout_id text not null references clinic_finance.masa_payouts(masa_payout_id) on delete cascade,
  account_code text, account_name text, parent_name text, debit numeric(14,2) not null default 0, credit numeric(14,2) not null default 0);
create index on clinic_finance.masa_payout_accounts(masa_payout_id);
create index on clinic_finance.masa_payout_accounts(account_name);

create table clinic_finance.masa_account_kinds(
  account_name text primary key, kind text not null check (kind in ('operating', 'advance', 'partner_draw', 'transfer', 'ignore')), category text,
  set_by uuid references public.admins(id), set_at timestamptz not null default now());

alter table clinic_finance.masa_payouts enable row level security;
alter table clinic_finance.masa_payout_lines enable row level security;
alter table clinic_finance.masa_payout_accounts enable row level security;
alter table clinic_finance.masa_account_kinds enable row level security;
revoke all on clinic_finance.masa_payouts, clinic_finance.masa_payout_lines, clinic_finance.masa_payout_accounts, clinic_finance.masa_account_kinds
  from public, anon, authenticated;

create function clinic_finance.masa_account_kind(p_name text) returns text language sql stable as $$
  select coalesce((select k.kind from clinic_finance.masa_account_kinds k where k.account_name = p_name),
    case when coalesce(p_name, '') ~ '^جار[يى] +شريك' then 'partner_draw'
         when coalesce(p_name, '') ~ '^(ال)?خزين' then 'transfer'
         when coalesce(p_name, '') like '%سلف%' then 'advance'
         else 'operating' end)
$$;

create function clinic_finance.masa_payouts_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare d date; src text; po jsonb; l jsonb; a jsonb; pid text; n int := 0; sk int := 0;
begin
  if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'payload_required'); end if;
  d := case when coalesce(p->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'date')::date end;
  if d is null then return jsonb_build_object('ok', false, 'error', 'date_required'); end if;
  src := case when p->>'source' = 'old' then 'old' else 'masa' end;
  if coalesce(jsonb_typeof(p->'payouts'), '') <> 'array' then return jsonb_build_object('ok', false, 'error', 'payouts_required'); end if;
  if jsonb_array_length(p->'payouts') > 3000 then return jsonb_build_object('ok', false, 'error', 'too_many_items'); end if;
  for po in select value from jsonb_array_elements(p->'payouts') loop
    pid := left(nullif(trim(po->>'masa_payout_id'), ''), 40);
    if pid is null or jsonb_typeof(coalesce(po->'lines', '[]')) <> 'array' or jsonb_typeof(coalesce(po->'accounts', '[]')) <> 'array' then sk := sk + 1; continue; end if;
    insert into clinic_finance.masa_payouts as x(masa_payout_id, source, receipt_no, paid_at, day, cashier_user_id, is_deleted, total)
      values (pid, src, left(po->>'receipt_no', 40), clinic_finance.masa_local_ts(po->>'paid_at'),
        coalesce((clinic_finance.masa_local_ts(po->>'paid_at') at time zone 'Africa/Cairo')::date, d), clinic_finance.masa_int(po->'cashier_user_id'),
        coalesce((po->>'is_deleted')::boolean, false), coalesce(clinic_finance.masa_num(po->'total'), 0))
      on conflict (masa_payout_id) do update set source = excluded.source, receipt_no = excluded.receipt_no, paid_at = excluded.paid_at, day = excluded.day,
        cashier_user_id = excluded.cashier_user_id, is_deleted = excluded.is_deleted, total = excluded.total, synced_at = now();
    delete from clinic_finance.masa_payout_lines where masa_payout_id = pid;
    delete from clinic_finance.masa_payout_accounts where masa_payout_id = pid;
    for l in select value from jsonb_array_elements(coalesce(po->'lines', '[]')) loop
      insert into clinic_finance.masa_payout_lines(masa_payout_id, payment_type_id, currency_id, amount, safe_id)
        values (pid, clinic_finance.masa_int(l->'payment_type_id'), clinic_finance.masa_int(l->'currency_id'), coalesce(clinic_finance.masa_num(l->'amount'), 0),
          clinic_finance.masa_int(l->'safe_id'));
    end loop;
    for a in select value from jsonb_array_elements(coalesce(po->'accounts', '[]')) loop
      insert into clinic_finance.masa_payout_accounts(masa_payout_id, account_code, account_name, parent_name, debit, credit)
        values (pid, left(a->>'account_code', 40), left(nullif(trim(a->>'account_name'), ''), 200), left(nullif(trim(a->>'parent_name'), ''), 200),
          coalesce(clinic_finance.masa_num(a->'debit'), 0), coalesce(clinic_finance.masa_num(a->'credit'), 0));
    end loop;
    update clinic_finance.masa_payouts set total = coalesce((select sum(amount) from clinic_finance.masa_payout_lines where masa_payout_id = pid), 0)
      where masa_payout_id = pid and coalesce(total, 0) = 0;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'payouts_upserted', n, 'skipped', sk);
end $$;
revoke all on function clinic_finance.masa_payouts_import(jsonb) from public, anon, authenticated;

do $$ begin
  alter function public.clinic_reception_fallback_api(text, jsonb) rename to fallback_api_before_payouts;
  alter function public.fallback_api_before_payouts(text, jsonb) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.fallback_api_before_payouts(text, jsonb) from public, anon, authenticated;
create function public.clinic_reception_fallback_api(p_op text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_op = 'masa_payouts_import' then return clinic_finance.masa_payouts_import(coalesce(p_payload, '{}')); end if;
  return clinic_reception.fallback_api_before_payouts(p_op, p_payload);
end $$;
revoke all on function public.clinic_reception_fallback_api(text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.clinic_reception_fallback_api(text, jsonb) to service_role;
  end if;
end $$;

create function public.clinic_finance_masa_net(p_action text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare f date; t date; grp text; res jsonb; me uuid;
begin
  if p_action = 'report' then
    if not clinic_finance.allowed('view') then raise exception 'تقرير صافي ماسا للمالية بس' using errcode = '42501'; end if;
    t := coalesce(nullif(p->>'to', '')::date, (now() at time zone 'Africa/Cairo')::date);
    f := coalesce(nullif(p->>'from', '')::date, date_trunc('month', t)::date);
    if t < f or t - f > 1100 then raise exception 'اختر فترة حتى ٣ سنين'; end if;
    grp := case when p->>'group_by' = 'day' then 'day' else 'month' end;
    with inc as (
      select r.day, sum(l.amount) as amt from clinic_finance.masa_receipts r join clinic_finance.masa_receipt_lines l using (masa_receipt_id)
      where r.day between f and t and not r.is_deleted group by r.day),
    ex as (
      select p2.day, a.debit as amt, clinic_finance.masa_account_kind(a.account_name) as kind, a.account_name
      from clinic_finance.masa_payouts p2 join clinic_finance.masa_payout_accounts a on a.masa_payout_id = p2.masa_payout_id and a.debit > 0
      where p2.day between f and t and not p2.is_deleted
      union all
      select p2.day, p2.total, 'unclassified', null from clinic_finance.masa_payouts p2
      where p2.day between f and t and not p2.is_deleted and p2.total > 0
        and not exists (select 1 from clinic_finance.masa_payout_accounts a where a.masa_payout_id = p2.masa_payout_id and a.debit > 0)),
    bydate as (
      select to_char(d.day, case when grp = 'day' then 'YYYY-MM-DD' else 'YYYY-MM' end) as period,
        coalesce((select sum(amt) from inc where inc.day = d.day), 0) as income
      from (select day from inc union select day from ex) d),
    income_p as (select period, sum(income) as income from bydate group by period),
    exp_p as (
      select to_char(day, case when grp = 'day' then 'YYYY-MM-DD' else 'YYYY-MM' end) as period,
        sum(amt) filter (where kind = 'operating') as operating, sum(amt) filter (where kind = 'advance') as advance,
        sum(amt) filter (where kind = 'partner_draw') as partner_draw, sum(amt) filter (where kind = 'transfer') as transfer,
        sum(amt) filter (where kind = 'ignore') as ignored, sum(amt) filter (where kind = 'unclassified') as unclassified
      from ex group by 1),
    periods as (select period from income_p union select period from exp_p)
    select jsonb_build_object('from', f, 'to', t, 'group_by', grp,
      'synced_at', (select max(synced_at) from clinic_finance.masa_payouts),
      'totals', (select jsonb_build_object(
          'income', coalesce((select sum(amt) from inc), 0),
          'operating', coalesce((select sum(amt) from ex where kind = 'operating'), 0),
          'advance', coalesce((select sum(amt) from ex where kind = 'advance'), 0),
          'partner_draw', coalesce((select sum(amt) from ex where kind = 'partner_draw'), 0),
          'transfer', coalesce((select sum(amt) from ex where kind = 'transfer'), 0),
          'ignored', coalesce((select sum(amt) from ex where kind = 'ignore'), 0),
          'unclassified', coalesce((select sum(amt) from ex where kind = 'unclassified'), 0),
          'net_cash', coalesce((select sum(amt) from inc), 0) - coalesce((select sum(amt) from ex where kind not in ('transfer', 'ignore')), 0),
          'net_operating', coalesce((select sum(amt) from inc), 0) - coalesce((select sum(amt) from ex where kind in ('operating', 'unclassified')), 0))),
      'by_period', coalesce((select jsonb_agg(jsonb_build_object('period', pr.period, 'income', coalesce(ip.income, 0),
          'operating', coalesce(ep.operating, 0) + coalesce(ep.unclassified, 0), 'advance', coalesce(ep.advance, 0),
          'partner_draw', coalesce(ep.partner_draw, 0), 'transfer', coalesce(ep.transfer, 0),
          'net_cash', coalesce(ip.income, 0) - coalesce(ep.operating, 0) - coalesce(ep.unclassified, 0) - coalesce(ep.advance, 0) - coalesce(ep.partner_draw, 0),
          'net_operating', coalesce(ip.income, 0) - coalesce(ep.operating, 0) - coalesce(ep.unclassified, 0)) order by pr.period)
        from periods pr left join income_p ip on ip.period = pr.period left join exp_p ep on ep.period = pr.period), '[]'),
      'top_accounts', coalesce((select jsonb_agg(jsonb_build_object('account', account_name, 'kind', kind, 'amount', a, 'payouts', n) order by a desc)
        from (select account_name, kind, sum(amt) a, count(*) n from ex where account_name is not null group by account_name, kind order by sum(amt) desc limit 60) q), '[]')
    ) into res;
    return res;
  elsif p_action = 'classify' then
    if not clinic_finance.allowed('update') then raise exception 'تصنيف حسابات ماسا للمالية بس' using errcode = '42501'; end if;
    if nullif(trim(p->>'account_name'), '') is null or coalesce(p->>'kind', '') not in ('operating', 'advance', 'partner_draw', 'transfer', 'ignore') then
      raise exception 'اسم الحساب والنوع مطلوبين'; end if;
    me := public.my_admin_id();
    insert into clinic_finance.masa_account_kinds(account_name, kind, category, set_by) values (trim(p->>'account_name'), p->>'kind', left(nullif(trim(p->>'category'), ''), 80), me)
      on conflict (account_name) do update set kind = excluded.kind, category = excluded.category, set_by = excluded.set_by, set_at = now();
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_masa_net(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_masa_net(text, jsonb) to authenticated;

commit;
