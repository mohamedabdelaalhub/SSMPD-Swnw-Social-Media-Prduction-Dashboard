-- Employee income tax on salaries («ضريبة كسب العمل على المرتبات») — phase 3 of offboarding/settlement work (design: offboarding-design-20261109.md 6-ب).
-- HR side: a monthly register per employee of the tax withheld from the salary (amount typed from the tax document, nothing is computed here).
-- Accounting side: per month, the total payable to the tax authority, what payroll withheld, payments recorded + status, and a payment RPC.
--          The payment reuses the EXISTING «statutory_payment» request on account 2142 «ضرائب أجور مستحقة» (maker-checker, posted by the existing review step, capped by the recorded liability).
-- EXTENSIBLE: every row carries a tax_type that points at clinic_finance.tax_types. Only «salary_income» exists now. Doctors' professional tax (ضريبة مهن غير تجارية) and the
--          center's taxes / stamp duties are NOT built: the owner will send details, and each will be one new row in tax_types (+ its own entry screen), not a schema change.
-- ADDITIVE ONLY: 3 new tables (RLS on, no direct grants) + 7 new SECURITY DEFINER functions. Nothing existing is changed.
-- Rollback: supabase/rollbacks/20261109130000_hr_income_tax.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_people.people') is null then raise exception 'جدول الموارد البشرية غير موجود'; end if;
  if to_regclass('clinic_people.audit') is null then raise exception 'سجل المراجعة للموارد البشرية غير موجود'; end if;
  if to_regclass('clinic_finance.business_requests') is null then raise exception 'جدول طلبات الحسابات غير موجود'; end if;
  if to_regprocedure('public.clinic_finance_business_command(text,jsonb,uuid)') is null then raise exception 'دالة طلبات الحسابات غير موجودة'; end if;
  if to_regprocedure('clinic_people.insurance_view_all()') is null then raise exception 'طبّق ملف التأمينات (20261109120000) أولًا'; end if;
  if to_regclass('clinic_finance.tax_types') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_finance.tax_types(
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  liability_account text not null check (liability_account in ('2141', '2142', '2143')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into clinic_finance.tax_types(code, name, liability_account) values ('salary_income', 'ضريبة كسب العمل على المرتبات', '2142');

create table clinic_people.tax_entries(
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  person_id uuid not null references clinic_people.people(id),
  month date not null check (month = date_trunc('month', month)::date),
  tax_type text not null default 'salary_income' references clinic_finance.tax_types(code),
  amount numeric(14, 2) not null check (amount >= 0 and amount < 100000000 and amount::text not in ('NaN', 'Infinity')),
  taxable_base numeric(14, 2) check (taxable_base is null or (taxable_base >= 0 and taxable_base < 100000000)),
  reference text not null default '' check (length(reference) <= 200),
  note text not null default '' check (length(note) <= 2000),
  revision integer not null default 1,
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, month, tax_type)
);
create index tax_entries_month on clinic_people.tax_entries(month, tax_type);

create table clinic_finance.tax_payments(
  id uuid primary key default gen_random_uuid(),
  month date not null check (month = date_trunc('month', month)::date),
  tax_type text not null references clinic_finance.tax_types(code),
  amount numeric(14, 2) not null check (amount > 0),
  request_id uuid not null unique references clinic_finance.business_requests(id),
  reference text not null,
  note text not null default '',
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now()
);
create index tax_payments_month on clinic_finance.tax_payments(month, tax_type);

alter table clinic_finance.tax_types enable row level security;
alter table clinic_people.tax_entries enable row level security;
alter table clinic_finance.tax_payments enable row level security;
revoke all on clinic_finance.tax_types, clinic_finance.tax_payments from public, anon, authenticated;
revoke all on clinic_people.tax_entries from public, anon, authenticated;

-- HR: set the withheld amount of one person for one month (create, or update with revision + reason)
create function public.hr_tax_command(p_action text, p_payload jsonb) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  cur date := date_trunc('month', (now() at time zone 'Africa/Cairo')::date)::date;
  e clinic_people.tax_entries%rowtype; p clinic_people.people%rowtype;
  v uuid := nullif(p_payload->>'id', '')::uuid; rid uuid := nullif(p_payload->>'request_id', '')::uuid; pid uuid := nullif(p_payload->>'person_id', '')::uuid;
  t text := coalesce(nullif(p_payload->>'tax_type', ''), 'salary_income'); m date; amt numeric; base numeric; prior jsonb; afterj jsonb;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'سجل الضريبة لإدارة الموارد البشرية'; end if;
  if p_action not in ('create', 'update') then raise exception 'إجراء غير متاح'; end if;
  if not exists(select 1 from clinic_finance.tax_types where code = t and active) then raise exception 'نوع الضريبة غير متاح'; end if;
  amt := coalesce(nullif(p_payload->>'amount', '')::numeric, -1);
  if amt < 0 or amt >= 100000000 or amt::text in ('NaN', 'Infinity') or amt <> round(amt, 2) then raise exception 'راجع مبلغ الضريبة المستقطعة'; end if;
  base := nullif(p_payload->>'taxable_base', '')::numeric;
  if base is not null and (base < 0 or base >= 100000000 or base <> round(base, 2)) then raise exception 'راجع الوعاء الخاضع'; end if;

  if p_action = 'create' then
    if rid is not null then select id into v from clinic_people.tax_entries where request_id = rid; if found then return v; end if; end if;
    select * into p from clinic_people.people where id = pid;
    if not found or p.status = 'ended' then raise exception 'اختر موظفًا مستمرًا في العمل'; end if;
    m := date_trunc('month', nullif(p_payload->>'month', '')::date)::date;
    if m is null or m > cur then raise exception 'اختر شهرًا لم يتجاوز الشهر الحالي'; end if;
    if exists(select 1 from clinic_people.tax_entries where person_id = pid and month = m and tax_type = t) then raise exception 'مسجل لهذا الموظف في هذا الشهر؛ عدّل السجل الموجود'; end if;
    if p.finance_subject is not null and exists(select 1 from clinic_finance.business_requests b where b.kind = 'payroll' and b.subject = p.finance_subject and b.payload->>'month' = m::text and b.status in ('pending', 'approved')) then
      raise exception 'يوجد استحقاق مرتب لهذا الشهر؛ الضريبة تُدخل قبل إرسال المرتب أو تُصحَّح بقيد تصحيح';
    end if;
    insert into clinic_people.tax_entries(request_id, person_id, month, tax_type, amount, taxable_base, reference, note, created_by)
      values (rid, pid, m, t, amt, base, trim(coalesce(p_payload->>'reference', '')), trim(coalesce(p_payload->>'note', '')), me) returning id, to_jsonb(tax_entries.*) into v, afterj;
    insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'tax_create', v, null, afterj);
    return v;
  end if;

  select * into e from clinic_people.tax_entries where id = v for update;
  if not found then raise exception 'السجل غير موجود'; end if;
  if e.revision <> coalesce((p_payload->>'revision')::int, 0) then raise exception 'السجل تغير؛ أعد تحميله قبل الحفظ'; end if;
  if amt is distinct from e.amount and length(trim(coalesce(p_payload->>'reason', ''))) < 3 then raise exception 'اكتب سبب تغيير المبلغ'; end if;
  select * into p from clinic_people.people where id = e.person_id;
  if p.finance_subject is not null and exists(select 1 from clinic_finance.business_requests b where b.kind = 'payroll' and b.subject = p.finance_subject and b.payload->>'month' = e.month::text and b.status in ('pending', 'approved')) then
    raise exception 'يوجد استحقاق مرتب لهذا الشهر؛ لا يُعدَّل المبلغ بعد إرسال المرتب';
  end if;
  prior := to_jsonb(e);
  update clinic_people.tax_entries set amount = amt, taxable_base = base, reference = trim(coalesce(p_payload->>'reference', reference)), note = trim(coalesce(p_payload->>'note', note)), revision = revision + 1, updated_at = now() where id = v;
  select to_jsonb(x) into afterj from clinic_people.tax_entries x where id = v;
  insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'tax_update', v, prior, afterj);
  return v;
end $$;

-- HR (and accounting read-only): the entries of one month
create function public.hr_tax_workspace(p_month date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); allv boolean := clinic_people.insurance_view_all(); mine uuid; m date := date_trunc('month', coalesce(p_month, (now() at time zone 'Africa/Cairo')::date))::date;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  select id into mine from clinic_people.people where admin_id = me;
  return jsonb_build_object('can_manage', clinic_people.manage(), 'can_view_all', allv, 'today', (now() at time zone 'Africa/Cairo')::date, 'month', m,
    'tax_types', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name) order by code), '[]'::jsonb) from clinic_finance.tax_types where active),
    'items', (select coalesce(jsonb_agg(to_jsonb(t) - 'request_id' || jsonb_build_object('full_name', p.full_name, 'code', p.code) order by p.full_name), '[]'::jsonb)
      from clinic_people.tax_entries t join clinic_people.people p on p.id = t.person_id where t.month = m and (allv or (mine is not null and t.person_id = mine))),
    'people', case when clinic_people.manage() then (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'full_name', p.full_name) order by p.full_name), '[]'::jsonb) from clinic_people.people p where p.status <> 'ended') else '[]'::jsonb end);
end $$;

-- the payroll form reads this
create function public.hr_tax_amount(p_person uuid, p_month date, p_tax_type text default 'salary_income') returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare m date := date_trunc('month', p_month)::date; e clinic_people.tax_entries%rowtype;
begin
  if public.my_admin_id() is null then raise exception 'سجل الدخول'; end if;
  if not (clinic_people.manage() or clinic_finance.allowed('create') or clinic_finance.allowed('review')) then raise exception 'ليس لديك صلاحية لهذه العملية' using errcode = '42501'; end if;
  select * into e from clinic_people.tax_entries where person_id = p_person and month = m and tax_type = p_tax_type;
  return jsonb_build_object('person_id', p_person, 'month', m, 'tax_type', p_tax_type, 'found', found, 'tax', coalesce(e.amount, 0), 'reference', coalesce(e.reference, ''));
end $$;

-- accounting: the month's picture for one tax type
create function clinic_finance.tax_month(p_month date, p_type text) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare m date := date_trunc('month', p_month)::date; tt clinic_finance.tax_types%rowtype; due numeric; pap numeric; ppen numeric; liab numeric; withheld numeric;
begin
  if not (clinic_finance.allowed('create') or clinic_finance.allowed('review')) then raise exception 'ليس لديك صلاحية لهذه العملية المالية' using errcode = '42501'; end if;
  select * into tt from clinic_finance.tax_types where code = p_type and active; if not found then raise exception 'نوع الضريبة غير متاح'; end if;
  select coalesce(sum(amount), 0) into due from clinic_people.tax_entries where month = m and tax_type = p_type;
  select coalesce(sum(case when b.status = 'approved' then p.amount end), 0), coalesce(sum(case when b.status = 'pending' then p.amount end), 0) into pap, ppen
    from clinic_finance.tax_payments p join clinic_finance.business_requests b on b.id = p.request_id where p.month = m and p.tax_type = p_type;
  select coalesce(sum(l.credit - l.debit), 0) into liab from clinic_finance.lines l where l.account = tt.liability_account;
  withheld := case when p_type = 'salary_income' then (select coalesce(sum((payload->>'tax')::numeric), 0) from clinic_finance.business_requests where kind = 'payroll' and status = 'approved' and payload->>'month' = m::text) else 0 end;
  return jsonb_build_object('month', m, 'tax_type', p_type, 'tax_name', tt.name, 'liability_account', tt.liability_account, 'total_due', due, 'payroll_withheld', withheld, 'paid_approved', pap, 'paid_pending', ppen,
    'remaining', greatest(0, due - pap - ppen), 'liability_balance', liab,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('person_id', p.id, 'code', p.code, 'full_name', p.full_name, 'amount', t.amount, 'taxable_base', t.taxable_base, 'reference', t.reference) order by p.full_name), '[]'::jsonb)
      from clinic_people.tax_entries t join clinic_people.people p on p.id = t.person_id where t.month = m and t.tax_type = p_type),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'reference', p.reference, 'note', p.note, 'created_at', p.created_at, 'status', b.status, 'review_note', b.review_note) order by p.created_at desc), '[]'::jsonb)
      from clinic_finance.tax_payments p join clinic_finance.business_requests b on b.id = p.request_id where p.month = m and p.tax_type = p_type));
end $$;

create function public.clinic_finance_tax_month(p_month date, p_type text default 'salary_income') returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_finance.tax_month(p_month, p_type)
$$;

create function public.clinic_finance_tax_pay(p_month date, p_type text, p_amount numeric, p_method text, p_shift uuid, p_reference text, p_note text, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_finance.require_access('create'); m date := date_trunc('month', p_month)::date; v uuid; sm jsonb;
begin
  select b.id into v from clinic_finance.business_requests b where b.created_by = me and b.token = p_token and b.kind = 'statutory_payment';
  if found then if exists(select 1 from clinic_finance.tax_payments where request_id = v) then return v; end if; end if;
  perform pg_advisory_xact_lock(712241110);
  if p_month is null or m > date_trunc('month', (now() at time zone 'Africa/Cairo')::date)::date then raise exception 'لا يُسجَّل سداد لشهر لم يبدأ'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount::text in ('NaN', 'Infinity') then raise exception 'المبلغ يجب أن يكون موجبًا بقرشين كحد أقصى'; end if;
  if coalesce(p_method, '') not in ('cash', 'bank') then raise exception 'اختر قناة الصرف'; end if;
  sm := clinic_finance.tax_month(m, p_type);
  if p_amount > (sm->>'remaining')::numeric then raise exception 'المبلغ يتجاوز المتبقي المستحق للشهر (%).', sm->>'remaining'; end if;
  v := public.clinic_finance_business_command('request', jsonb_build_object('kind', 'statutory_payment', 'subject', (sm->>'tax_name') || ' ' || to_char(m, 'YYYY-MM'), 'reference', trim(coalesce(p_reference, '')),
    'note', trim(coalesce(p_note, '')), 'amount', p_amount, 'method', p_method, 'shift_id', p_shift, 'account', sm->>'liability_account', 'month', m, 'tax_type', p_type, 'source', 'hr_tax'), p_token);
  insert into clinic_finance.tax_payments(month, tax_type, amount, request_id, reference, note, created_by) values (m, p_type, p_amount, v, trim(p_reference), trim(coalesce(p_note, '')), me) on conflict (request_id) do nothing;
  return v;
end $$;

revoke all on function clinic_finance.tax_month(date, text) from public, anon, authenticated;
revoke all on function public.hr_tax_command(text, jsonb), public.hr_tax_workspace(date), public.hr_tax_amount(uuid, date, text),
  public.clinic_finance_tax_month(date, text), public.clinic_finance_tax_pay(date, text, numeric, text, uuid, text, text, uuid) from public, anon;
grant execute on function public.hr_tax_command(text, jsonb), public.hr_tax_workspace(date), public.hr_tax_amount(uuid, date, text),
  public.clinic_finance_tax_month(date, text), public.clinic_finance_tax_pay(date, text, numeric, text, uuid, text, text, uuid) to authenticated;

commit;
