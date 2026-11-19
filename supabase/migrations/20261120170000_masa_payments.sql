-- «تحصيل خارجي من ماسة» (owner 2026-11-19 «ابدأ تحصيل ماسا», mockup approved «موافق علي الباقي»; patient data on payments:
-- «انا عايز بيانات المريض كلها تتسجل علي الداشبورد»). Receipts and invoices collected on Masa are copied here for finance to
-- follow and reconcile. They are NEVER posted to clinic_finance shifts, entries or balances.
-- Feed: the WhatsApp agent calls booking-fallback op 'masa_payments_import' once per Cairo day (every 5 minutes for today-2..today,
-- nightly for 31 days). Contract (agent chat, 2026-11-19):
--   { date, generated_at, receipts:[{masa_receipt_id, receipt_no, paid_at, total_paid, receipt_type_id, official_booking_id,
--     masa_invoice_id, cashier_user_id, is_deleted, patient?, lines:[{payment_type_id, currency_id, amount, net_amount,
--     exchange_rate, safe_id, paid_at}]}],
--     invoices:[{masa_invoice_id, invoice_no, invoice_at, official_booking_id, masa_doctor_id, required_amount, discount, vat,
--     net_amount, paid_amount, remaining_amount, is_paid, is_deleted, is_insured, insurance_id, insurance_name?, cashier_user_id, patient?}],
--     payment_types:[{id, name, code, is_cash, is_credit_account, is_installment, is_active}] }
--   patient (optional): {masa_patient_id, name, phone, gender, birth_date, age_at_payment}. No raw national id is accepted.
-- Rules: upsert by Masa ids; a void/deletion is is_deleted = true (update, never delete); a receipt's lines are replaced as a set;
-- a receipt missing from a later payload is left alone; unknown or null official_booking_id is fine.
-- Finance only (clinic_finance.allowed('view') to read, 'update' to name a Masa cashier / safe). Rollback in supabase/rollbacks.
begin;

do $$ begin
  if to_regprocedure('clinic_finance.allowed(text)') is null or to_regprocedure('public.clinic_reception_fallback_api(text,jsonb)') is null
     or to_regclass('clinic_reception.masa_bookings') is null then raise exception 'مكونات الحسابات أو الحجز غير موجودة'; end if;
  if to_regclass('clinic_finance.masa_receipts') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_finance.masa_payment_types(
  id int primary key, name text not null, code text, is_cash boolean not null default false, is_credit_account boolean not null default false,
  is_installment boolean not null default false, is_active boolean not null default true,
  method text not null default 'other' check (method in ('cash','card','wallet','other')), updated_at timestamptz not null default now());
insert into clinic_finance.masa_payment_types(id, name, is_cash, method) values
  (147, 'نقدي', true, 'cash'), (148, 'فيزا', false, 'card'), (150, 'انستا باى', false, 'wallet'), (151, 'فودافون كاش', false, 'wallet');

create table clinic_finance.masa_invoices(
  masa_invoice_id text primary key check (length(masa_invoice_id) between 1 and 40), invoice_no text, invoice_at timestamptz, day date,
  official_booking_id text, masa_doctor_id int, required_amount numeric(14,2), discount numeric(14,2), vat numeric(14,2),
  net_amount numeric(14,2), paid_amount numeric(14,2), remaining_amount numeric(14,2), is_paid boolean, is_deleted boolean not null default false,
  is_insured boolean, insurance_id int, insurance_name text, cashier_user_id int,
  masa_patient_id text, patient_name text, phone text, gender text, birth_date date, age int,
  first_seen_at timestamptz not null default now(), synced_at timestamptz not null default now());
create index on clinic_finance.masa_invoices(day);
create index on clinic_finance.masa_invoices(official_booking_id);

create table clinic_finance.masa_receipts(
  masa_receipt_id text primary key check (length(masa_receipt_id) between 1 and 40), receipt_no text, paid_at timestamptz, day date not null,
  total_paid numeric(14,2) not null default 0, receipt_type_id int, official_booking_id text, masa_invoice_id text, cashier_user_id int,
  is_deleted boolean not null default false,
  masa_patient_id text, patient_name text, phone text, gender text, birth_date date, age int,
  first_seen_at timestamptz not null default now(), synced_at timestamptz not null default now());
create index on clinic_finance.masa_receipts(day);
create index on clinic_finance.masa_receipts(official_booking_id);

create table clinic_finance.masa_receipt_lines(
  id bigint generated always as identity primary key,
  masa_receipt_id text not null references clinic_finance.masa_receipts(masa_receipt_id) on delete cascade,
  payment_type_id int, currency_id int, amount numeric(14,2) not null default 0, net_amount numeric(14,2), exchange_rate numeric(14,6),
  safe_id int, paid_at timestamptz);
create index on clinic_finance.masa_receipt_lines(masa_receipt_id);

-- Masa user / safe ids → names, filled once by finance.
create table clinic_finance.masa_cashiers(cashier_user_id int primary key, admin_id uuid references public.admins(id), label text,
  set_by uuid references public.admins(id), set_at timestamptz not null default now());
create table clinic_finance.masa_safes(safe_id int primary key, label text not null, set_by uuid references public.admins(id),
  set_at timestamptz not null default now());
create table clinic_finance.masa_payments_sync(day date primary key, synced_at timestamptz not null default now(), generated_at timestamptz,
  receipts int not null default 0, invoices int not null default 0);

alter table clinic_finance.masa_payment_types enable row level security;
alter table clinic_finance.masa_invoices enable row level security;
alter table clinic_finance.masa_receipts enable row level security;
alter table clinic_finance.masa_receipt_lines enable row level security;
alter table clinic_finance.masa_cashiers enable row level security;
alter table clinic_finance.masa_safes enable row level security;
alter table clinic_finance.masa_payments_sync enable row level security;
revoke all on clinic_finance.masa_payment_types, clinic_finance.masa_invoices, clinic_finance.masa_receipts, clinic_finance.masa_receipt_lines,
  clinic_finance.masa_cashiers, clinic_finance.masa_safes, clinic_finance.masa_payments_sync from public, anon, authenticated;

create function clinic_finance.masa_local_ts(v text) returns timestamptz language sql stable as $$
  select case when coalesce(v, '') ~ '^\d{4}-\d{2}-\d{2}' then
    case when v ~ '(Z|[+-]\d{2}:?\d{2})$' then v::timestamptz else (replace(v, 'T', ' ')::timestamp at time zone 'Africa/Cairo') end end
$$;
create function clinic_finance.masa_num(v jsonb) returns numeric language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
              when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v #>> '{}')::numeric end
$$;
create function clinic_finance.masa_int(v jsonb) returns int language sql immutable as $$
  select case when coalesce(v #>> '{}', '') ~ '^-?[0-9]{1,9}$' then (v #>> '{}')::int end
$$;

-- The import (service role through booking-fallback). One call per Cairo day.
create function clinic_finance.masa_payments_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare d date; r jsonb; i jsonb; l jsonb; t jsonb; pt jsonb; rid text; iid text; nr int := 0; ni int := 0; sk int := 0; pat jsonb;
begin
  if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'payload_required'); end if;
  d := case when coalesce(p->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'date')::date end;
  if d is null then return jsonb_build_object('ok', false, 'error', 'date_required'); end if;
  if jsonb_typeof(coalesce(p->'receipts', '[]')) <> 'array' or jsonb_typeof(coalesce(p->'invoices', '[]')) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'arrays_required'); end if;
  if jsonb_array_length(coalesce(p->'receipts', '[]')) + jsonb_array_length(coalesce(p->'invoices', '[]')) > 5000 then
    return jsonb_build_object('ok', false, 'error', 'too_many_items'); end if;

  for t in select value from jsonb_array_elements(coalesce(p->'payment_types', '[]')) loop
    if clinic_finance.masa_int(t->'id') is null or nullif(trim(t->>'name'), '') is null then continue; end if;
    insert into clinic_finance.masa_payment_types(id, name, code, is_cash, is_credit_account, is_installment, is_active, method)
      values (clinic_finance.masa_int(t->'id'), left(trim(t->>'name'), 80), left(t->>'code', 40), coalesce((t->>'is_cash')::boolean, false),
        coalesce((t->>'is_credit_account')::boolean, false), coalesce((t->>'is_installment')::boolean, false), coalesce((t->>'is_active')::boolean, true),
        case when coalesce((t->>'is_cash')::boolean, false) then 'cash' else 'other' end)
      on conflict (id) do update set name = excluded.name, code = excluded.code, is_cash = excluded.is_cash, is_credit_account = excluded.is_credit_account,
        is_installment = excluded.is_installment, is_active = excluded.is_active,
        method = case when clinic_finance.masa_payment_types.method = 'other' then excluded.method else clinic_finance.masa_payment_types.method end,
        updated_at = now();
  end loop;

  for i in select value from jsonb_array_elements(coalesce(p->'invoices', '[]')) loop
    iid := left(nullif(trim(i->>'masa_invoice_id'), ''), 40);
    if iid is null then sk := sk + 1; continue; end if;
    pat := coalesce(i->'patient', '{}');
    insert into clinic_finance.masa_invoices as x(masa_invoice_id, invoice_no, invoice_at, day, official_booking_id, masa_doctor_id, required_amount,
        discount, vat, net_amount, paid_amount, remaining_amount, is_paid, is_deleted, is_insured, insurance_id, insurance_name, cashier_user_id,
        masa_patient_id, patient_name, phone, gender, birth_date, age)
      values (iid, left(i->>'invoice_no', 40), clinic_finance.masa_local_ts(i->>'invoice_at'),
        coalesce((clinic_finance.masa_local_ts(i->>'invoice_at') at time zone 'Africa/Cairo')::date, d),
        left(nullif(trim(i->>'official_booking_id'), ''), 80), clinic_finance.masa_int(i->'masa_doctor_id'),
        clinic_finance.masa_num(i->'required_amount'), clinic_finance.masa_num(i->'discount'), clinic_finance.masa_num(i->'vat'),
        clinic_finance.masa_num(i->'net_amount'), clinic_finance.masa_num(i->'paid_amount'), clinic_finance.masa_num(i->'remaining_amount'),
        (i->>'is_paid')::boolean, coalesce((i->>'is_deleted')::boolean, false), (i->>'is_insured')::boolean, clinic_finance.masa_int(i->'insurance_id'),
        left(nullif(trim(i->>'insurance_name'), ''), 120), clinic_finance.masa_int(i->'cashier_user_id'),
        left(nullif(trim(pat->>'masa_patient_id'), ''), 40), left(nullif(trim(pat->>'name'), ''), 180), left(nullif(trim(pat->>'phone'), ''), 40),
        left(nullif(trim(pat->>'gender'), ''), 20), case when coalesce(pat->>'birth_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (pat->>'birth_date')::date end,
        case when clinic_finance.masa_int(pat->'age_at_payment') between 0 and 130 then clinic_finance.masa_int(pat->'age_at_payment') end)
      on conflict (masa_invoice_id) do update set invoice_no = excluded.invoice_no, invoice_at = excluded.invoice_at, day = excluded.day,
        official_booking_id = excluded.official_booking_id, masa_doctor_id = excluded.masa_doctor_id, required_amount = excluded.required_amount,
        discount = excluded.discount, vat = excluded.vat, net_amount = excluded.net_amount, paid_amount = excluded.paid_amount,
        remaining_amount = excluded.remaining_amount, is_paid = excluded.is_paid, is_deleted = excluded.is_deleted, is_insured = excluded.is_insured,
        insurance_id = excluded.insurance_id, insurance_name = coalesce(excluded.insurance_name, x.insurance_name), cashier_user_id = excluded.cashier_user_id,
        masa_patient_id = coalesce(excluded.masa_patient_id, x.masa_patient_id), patient_name = coalesce(excluded.patient_name, x.patient_name),
        phone = coalesce(excluded.phone, x.phone), gender = coalesce(excluded.gender, x.gender), birth_date = coalesce(excluded.birth_date, x.birth_date),
        age = coalesce(excluded.age, x.age), synced_at = now();
    ni := ni + 1;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p->'receipts', '[]')) loop
    rid := left(nullif(trim(r->>'masa_receipt_id'), ''), 40);
    if rid is null or jsonb_typeof(coalesce(r->'lines', '[]')) <> 'array' then sk := sk + 1; continue; end if;
    pat := coalesce(r->'patient', '{}');
    insert into clinic_finance.masa_receipts as x(masa_receipt_id, receipt_no, paid_at, day, total_paid, receipt_type_id, official_booking_id, masa_invoice_id,
        cashier_user_id, is_deleted, masa_patient_id, patient_name, phone, gender, birth_date, age)
      values (rid, left(r->>'receipt_no', 40), clinic_finance.masa_local_ts(r->>'paid_at'),
        coalesce((clinic_finance.masa_local_ts(r->>'paid_at') at time zone 'Africa/Cairo')::date, d),
        coalesce(clinic_finance.masa_num(r->'total_paid'), 0), clinic_finance.masa_int(r->'receipt_type_id'),
        left(nullif(trim(r->>'official_booking_id'), ''), 80), left(nullif(trim(r->>'masa_invoice_id'), ''), 40), clinic_finance.masa_int(r->'cashier_user_id'),
        coalesce((r->>'is_deleted')::boolean, false),
        left(nullif(trim(pat->>'masa_patient_id'), ''), 40), left(nullif(trim(pat->>'name'), ''), 180), left(nullif(trim(pat->>'phone'), ''), 40),
        left(nullif(trim(pat->>'gender'), ''), 20), case when coalesce(pat->>'birth_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (pat->>'birth_date')::date end,
        case when clinic_finance.masa_int(pat->'age_at_payment') between 0 and 130 then clinic_finance.masa_int(pat->'age_at_payment') end)
      on conflict (masa_receipt_id) do update set receipt_no = excluded.receipt_no, paid_at = excluded.paid_at, day = excluded.day,
        total_paid = excluded.total_paid, receipt_type_id = excluded.receipt_type_id, official_booking_id = excluded.official_booking_id,
        masa_invoice_id = excluded.masa_invoice_id, cashier_user_id = excluded.cashier_user_id, is_deleted = excluded.is_deleted,
        masa_patient_id = coalesce(excluded.masa_patient_id, x.masa_patient_id), patient_name = coalesce(excluded.patient_name, x.patient_name),
        phone = coalesce(excluded.phone, x.phone), gender = coalesce(excluded.gender, x.gender), birth_date = coalesce(excluded.birth_date, x.birth_date),
        age = coalesce(excluded.age, x.age), synced_at = now();
    delete from clinic_finance.masa_receipt_lines where masa_receipt_id = rid;
    for l in select value from jsonb_array_elements(coalesce(r->'lines', '[]')) loop
      insert into clinic_finance.masa_receipt_lines(masa_receipt_id, payment_type_id, currency_id, amount, net_amount, exchange_rate, safe_id, paid_at)
        values (rid, clinic_finance.masa_int(l->'payment_type_id'), clinic_finance.masa_int(l->'currency_id'), coalesce(clinic_finance.masa_num(l->'amount'), 0),
          clinic_finance.masa_num(l->'net_amount'), clinic_finance.masa_num(l->'exchange_rate'), clinic_finance.masa_int(l->'safe_id'),
          clinic_finance.masa_local_ts(l->>'paid_at'));
    end loop;
    nr := nr + 1;
  end loop;

  insert into clinic_finance.masa_payments_sync(day, synced_at, generated_at, receipts, invoices)
    values (d, now(), clinic_finance.masa_local_ts(p->>'generated_at'), nr, ni)
    on conflict (day) do update set synced_at = now(), generated_at = excluded.generated_at, receipts = excluded.receipts, invoices = excluded.invoices;
  return jsonb_build_object('ok', true, 'receipts_upserted', nr, 'invoices_upserted', ni, 'skipped', sk);
end $$;
revoke all on function clinic_finance.masa_payments_import(jsonb) from public, anon, authenticated;

do $$ begin
  alter function public.clinic_reception_fallback_api(text, jsonb) rename to fallback_api_before_payments;
  alter function public.fallback_api_before_payments(text, jsonb) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.fallback_api_before_payments(text, jsonb) from public, anon, authenticated;
create function public.clinic_reception_fallback_api(p_op text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_op = 'masa_payments_import' then return clinic_finance.masa_payments_import(coalesce(p_payload, '{}')); end if;
  return clinic_reception.fallback_api_before_payments(p_op, p_payload);
end $$;
revoke all on function public.clinic_reception_fallback_api(text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.clinic_reception_fallback_api(text, jsonb) to service_role;
  end if;
end $$;

-- Finance report + naming. View: clinic_finance.allowed('view'); naming a Masa cashier/safe: allowed('update').
create function public.clinic_finance_masa_payments(p_action text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare f date; t date; me uuid; incl boolean; meth text; res jsonb;
begin
  if p_action = 'list' then
    if not clinic_finance.allowed('view') then raise exception 'تقرير تحصيل ماسا للمالية بس' using errcode = '42501'; end if;
    f := coalesce(nullif(p->>'from', '')::date, (now() at time zone 'Africa/Cairo')::date);
    t := coalesce(nullif(p->>'to', '')::date, f);
    if t < f or t - f > 92 then raise exception 'اختر فترة حتى ٩٣ يوم'; end if;
    incl := coalesce((p->>'include_deleted')::boolean, false);
    meth := nullif(p->>'method', '');
    with rc as (
      select r.*, coalesce(r.official_booking_id, iv.official_booking_id) as bid, iv.masa_doctor_id as inv_doctor, iv.is_insured, iv.insurance_name
      from clinic_finance.masa_receipts r left join clinic_finance.masa_invoices iv on iv.masa_invoice_id = r.masa_invoice_id
      where r.day between f and t and (incl or not r.is_deleted)),
    ln as (
      select l.masa_receipt_id, coalesce(pt.method, 'other') as method, coalesce(pt.name, 'طريقة #' || l.payment_type_id) as method_name, l.amount, l.safe_id
      from clinic_finance.masa_receipt_lines l left join clinic_finance.masa_payment_types pt on pt.id = l.payment_type_id
      where l.masa_receipt_id in (select masa_receipt_id from rc)),
    rx as (
      select rc.*, mb.patient_name as booking_patient, mb.phone as booking_phone,
        coalesce(pr.name, ml.masa_name) as doctor_name,
        coalesce(ca.label, ad.name) as cashier_name,
        (select string_agg(distinct ln.method_name, ' + ') from ln where ln.masa_receipt_id = rc.masa_receipt_id) as methods,
        (select min(ln.safe_id) from ln where ln.masa_receipt_id = rc.masa_receipt_id) as safe_id
      from rc
      left join clinic_reception.masa_bookings mb on mb.official_booking_id = rc.bid
      left join clinic_reception.masa_doctor_links ml on ml.masa_doctor_id = coalesce(rc.inv_doctor, mb.masa_doctor_id)
      left join clinic_reception.providers pr on pr.id = ml.provider_id
      left join clinic_finance.masa_cashiers ca on ca.cashier_user_id = rc.cashier_user_id
      left join public.admins ad on ad.id = ca.admin_id
      where meth is null or exists (select 1 from ln where ln.masa_receipt_id = rc.masa_receipt_id and ln.method = meth))
    select jsonb_build_object(
      'from', f, 'to', t,
      'synced_at', (select max(synced_at) from clinic_finance.masa_payments_sync),
      'totals', jsonb_build_object('all', coalesce((select sum(ln.amount) from ln join rx using (masa_receipt_id) where not rx.is_deleted), 0),
        'by_method', coalesce((select jsonb_object_agg(m, s) from (select ln.method m, sum(ln.amount) s from ln join rx using (masa_receipt_id)
          where not rx.is_deleted group by ln.method) q), '{}')),
      'by_cashier', coalesce((select jsonb_agg(jsonb_build_object('cashier_user_id', cashier_user_id, 'name', cashier_name, 'safe_id', safe_id,
          'safe', (select label from clinic_finance.masa_safes s where s.safe_id = q.safe_id), 'receipts', n, 'amount', a) order by a desc)
        from (select cashier_user_id, max(cashier_name) cashier_name, min(safe_id) safe_id, count(*) n, sum(total_paid) a from rx where not is_deleted
          group by cashier_user_id) q), '[]'),
      'by_doctor', coalesce((select jsonb_agg(jsonb_build_object('doctor', coalesce(doctor_name, 'بدون حجز مربوط'), 'receipts', n, 'insured', ins,
          'amount', a) order by a desc)
        from (select doctor_name, count(*) n, count(*) filter (where is_insured) ins, sum(total_paid) a from rx where not is_deleted group by doctor_name) q), '[]'),
      'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', masa_receipt_id, 'receipt_no', receipt_no, 'paid_at', paid_at,
          'patient', coalesce(patient_name, booking_patient), 'phone', coalesce(phone, booking_phone), 'booking', bid, 'doctor', doctor_name,
          'methods', methods, 'cashier', coalesce(cashier_name, case when cashier_user_id is not null then 'مستخدم ماسا #' || cashier_user_id end),
          'amount', total_paid, 'deleted', is_deleted, 'insured', coalesce(is_insured, false), 'insurance', insurance_name) order by paid_at)
        from (select * from rx order by paid_at limit 2000) z), '[]'),
      'admins', case when clinic_finance.allowed('update') then coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
        from public.admins where active), '[]') end) into res
    from (select 1) one;
    return res;
  elsif p_action in ('name_cashier', 'name_safe') then
    if not clinic_finance.allowed('update') then raise exception 'ربط أسماء ماسا للمالية بس' using errcode = '42501'; end if;
    me := public.my_admin_id();
    if p_action = 'name_cashier' then
      if clinic_finance.masa_int(p->'cashier_user_id') is null then raise exception 'رقم مستخدم ماسا مطلوب'; end if;
      if nullif(p->>'admin_id', '') is null and length(trim(coalesce(p->>'label', ''))) < 2 then raise exception 'اختار الموظف أو اكتب الاسم'; end if;
      insert into clinic_finance.masa_cashiers(cashier_user_id, admin_id, label, set_by) values (clinic_finance.masa_int(p->'cashier_user_id'),
          nullif(p->>'admin_id', '')::uuid, nullif(trim(p->>'label'), ''), me)
        on conflict (cashier_user_id) do update set admin_id = excluded.admin_id, label = excluded.label, set_by = me, set_at = now();
    else
      if clinic_finance.masa_int(p->'safe_id') is null or length(trim(coalesce(p->>'label', ''))) < 2 then raise exception 'رقم الخزنة والاسم مطلوبين'; end if;
      insert into clinic_finance.masa_safes(safe_id, label, set_by) values (clinic_finance.masa_int(p->'safe_id'), trim(p->>'label'), me)
        on conflict (safe_id) do update set label = excluded.label, set_by = me, set_at = now();
    end if;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_masa_payments(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_masa_payments(text, jsonb) to authenticated;

commit;
