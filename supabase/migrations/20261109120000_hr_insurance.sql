-- HR social + medical insurance register and the accounting «دفع التأمينات» (phase 2 of offboarding/settlement; design: offboarding-design-20261109.md 6-ب).
-- HR side: per employee, per insurance type (اجتماعي / طبي): insurance number, amount deducted from the salary, the center's share (if any), status (active / stopped + date),
--          and the stop details (notification reference + the notification deadline, which is a MANUAL field filled by the responsible person — no legal days are computed here).
-- Accounting side: monthly total due to the authority (from the register), what payroll actually withheld, payments recorded + their status, and a payment RPC.
--          The payment is NOT a new posting path: it creates the EXISTING «statutory_payment» request (clinic_finance_business_command) on account 2143 «تأمينات عاملين مستحقة»,
--          so it is reviewed by a different person (maker-checker) and its journal entry (Dr 2143 / Cr cash or bank) is posted by the existing review step, capped by the recorded liability.
-- ADDITIVE ONLY: 2 new tables (RLS on, no direct grants), 1 sequence-less register, 6 new SECURITY DEFINER functions. No existing table, column or function is changed.
-- Rollback: supabase/rollbacks/20261109120000_hr_insurance.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_people.people') is null then raise exception 'جدول الموارد البشرية غير موجود'; end if;
  if to_regclass('clinic_people.audit') is null then raise exception 'سجل المراجعة للموارد البشرية غير موجود'; end if;
  if to_regclass('clinic_finance.business_requests') is null then raise exception 'جدول طلبات الحسابات غير موجود'; end if;
  if to_regprocedure('public.clinic_finance_business_command(text,jsonb,uuid)') is null then raise exception 'دالة طلبات الحسابات غير موجودة'; end if;
  if to_regclass('clinic_people.insurance_enrollments') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_people.insurance_enrollments(
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  person_id uuid not null references clinic_people.people(id),
  insurance_type text not null check (insurance_type in ('social', 'medical')),
  insurance_number text not null default '' check (length(insurance_number) <= 100),
  employee_deduction numeric(14, 2) not null default 0 check (employee_deduction >= 0 and employee_deduction < 100000000 and employee_deduction::text not in ('NaN', 'Infinity')),
  center_share numeric(14, 2) not null default 0 check (center_share >= 0 and center_share < 100000000 and center_share::text not in ('NaN', 'Infinity')),
  status text not null default 'active' check (status in ('active', 'stopped')),
  started_on date not null,
  stopped_on date,
  stop_reference text not null default '' check (length(stop_reference) <= 200),
  notification_deadline date,
  note text not null default '' check (length(note) <= 2000),
  revision integer not null default 1,
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'active' and stopped_on is null) or (status = 'stopped' and stopped_on is not null and stopped_on >= started_on))
);
create unique index insurance_enrollments_one_active on clinic_people.insurance_enrollments(person_id, insurance_type) where status = 'active';
create index insurance_enrollments_person on clinic_people.insurance_enrollments(person_id, started_on);

create table clinic_finance.insurance_payments(
  id uuid primary key default gen_random_uuid(),
  month date not null check (month = date_trunc('month', month)::date),
  amount numeric(14, 2) not null check (amount > 0),
  request_id uuid not null unique references clinic_finance.business_requests(id),
  reference text not null,
  note text not null default '',
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now()
);
create index insurance_payments_month on clinic_finance.insurance_payments(month);

alter table clinic_people.insurance_enrollments enable row level security;
alter table clinic_finance.insurance_payments enable row level security;
revoke all on clinic_people.insurance_enrollments from public, anon, authenticated;
revoke all on clinic_finance.insurance_payments from public, anon, authenticated;

create function clinic_people.insurance_view_all() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and (clinic_people.manage() or public.has_role('accountant') or public.has_role('financial_manager'))
$$;

-- HR writes: create / update / stop
create function public.hr_insurance_command(p_action text, p_payload jsonb) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  today date := (now() at time zone 'Africa/Cairo')::date;
  e clinic_people.insurance_enrollments%rowtype;
  v uuid := nullif(p_payload->>'id', '')::uuid;
  rid uuid := nullif(p_payload->>'request_id', '')::uuid;
  pid uuid := nullif(p_payload->>'person_id', '')::uuid;
  nt text := trim(coalesce(p_payload->>'note', ''));
  ded numeric; share numeric; d date; dl date;
  prior jsonb; afterj jsonb;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'سجل التأمينات لإدارة الموارد البشرية'; end if;
  if p_action not in ('create', 'update', 'stop') then raise exception 'إجراء غير متاح'; end if;

  if p_action = 'create' then
    if rid is not null then select id into v from clinic_people.insurance_enrollments where request_id = rid; if found then return v; end if; end if;
    if not exists(select 1 from clinic_people.people where id = pid and status <> 'ended') then raise exception 'اختر موظفًا مستمرًا في العمل'; end if;
    if coalesce(p_payload->>'insurance_type', '') not in ('social', 'medical') then raise exception 'اختر نوع التأمين'; end if;
    ded := coalesce(nullif(p_payload->>'employee_deduction', '')::numeric, 0); share := coalesce(nullif(p_payload->>'center_share', '')::numeric, 0);
    if ded < 0 or share < 0 or ded >= 100000000 or share >= 100000000 or ded::text in ('NaN', 'Infinity') or share::text in ('NaN', 'Infinity') or ded <> round(ded, 2) or share <> round(share, 2) then raise exception 'راجع قيمة الاستقطاع وحصة المركز'; end if;
    d := nullif(p_payload->>'started_on', '')::date; if d is null then raise exception 'اكتب تاريخ بدء الاشتراك'; end if;
    if exists(select 1 from clinic_people.insurance_enrollments where person_id = pid and insurance_type = p_payload->>'insurance_type' and status = 'active') then raise exception 'للموظف اشتراك قائم من نفس النوع؛ أوقفه أولًا'; end if;
    if exists(select 1 from clinic_people.insurance_enrollments x where x.person_id = pid and x.insurance_type = p_payload->>'insurance_type' and x.stopped_on >= d) then raise exception 'يتداخل مع اشتراك سابق من نفس النوع'; end if;
    insert into clinic_people.insurance_enrollments(request_id, person_id, insurance_type, insurance_number, employee_deduction, center_share, started_on, note, created_by)
      values (rid, pid, p_payload->>'insurance_type', trim(coalesce(p_payload->>'insurance_number', '')), ded, share, d, nt, me) returning id, to_jsonb(insurance_enrollments.*) into v, afterj;
    insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'insurance_create', v, null, afterj);
    return v;
  end if;

  if v is null then raise exception 'اختر الاشتراك'; end if;
  select * into e from clinic_people.insurance_enrollments where id = v for update;
  if not found then raise exception 'الاشتراك غير موجود'; end if;
  if e.revision <> coalesce((p_payload->>'revision')::int, 0) then raise exception 'الاشتراك تغير؛ أعد تحميله قبل الحفظ'; end if;
  prior := to_jsonb(e);

  if p_action = 'update' then
    dl := nullif(p_payload->>'notification_deadline', '')::date;
    if e.status = 'stopped' then
      -- a stopped enrollment keeps its amounts (they are history); only the notification details may be completed
      update clinic_people.insurance_enrollments set stop_reference = coalesce(p_payload->>'stop_reference', stop_reference), notification_deadline = dl,
        insurance_number = trim(coalesce(p_payload->>'insurance_number', insurance_number)), note = coalesce(p_payload->>'note', note), revision = revision + 1, updated_at = now() where id = v;
    else
      ded := coalesce(nullif(p_payload->>'employee_deduction', '')::numeric, 0); share := coalesce(nullif(p_payload->>'center_share', '')::numeric, 0);
      if ded < 0 or share < 0 or ded >= 100000000 or share >= 100000000 or ded::text in ('NaN', 'Infinity') or share::text in ('NaN', 'Infinity') or ded <> round(ded, 2) or share <> round(share, 2) then raise exception 'راجع قيمة الاستقطاع وحصة المركز'; end if;
      if (ded is distinct from e.employee_deduction or share is distinct from e.center_share) and length(trim(coalesce(p_payload->>'reason', ''))) < 3 then raise exception 'اكتب سبب تغيير المبلغ'; end if;
      update clinic_people.insurance_enrollments set insurance_number = trim(coalesce(p_payload->>'insurance_number', insurance_number)), employee_deduction = ded, center_share = share,
        note = coalesce(p_payload->>'note', note), revision = revision + 1, updated_at = now() where id = v;
    end if;
  else -- stop
    if e.status <> 'active' then raise exception 'الاشتراك موقوف بالفعل'; end if;
    d := nullif(p_payload->>'stopped_on', '')::date;
    if d is null or d < e.started_on then raise exception 'تاريخ الإيقاف قبل تاريخ البدء'; end if;
    if d > today + 31 then raise exception 'تاريخ الإيقاف بعيد جدًا عن اليوم'; end if;
    update clinic_people.insurance_enrollments set status = 'stopped', stopped_on = d, stop_reference = trim(coalesce(p_payload->>'stop_reference', '')),
      notification_deadline = nullif(p_payload->>'notification_deadline', '')::date, note = coalesce(nullif(nt, ''), note), revision = revision + 1, updated_at = now() where id = v;
  end if;
  select to_jsonb(x) into afterj from clinic_people.insurance_enrollments x where id = v;
  insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'insurance_' || p_action, v, prior, afterj);
  return v;
end $$;

-- the register as the caller may see it (HR + accounting roles: everything; everyone else: their own)
create function public.hr_insurance_workspace() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); allv boolean := clinic_people.insurance_view_all(); mine uuid;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  select id into mine from clinic_people.people where admin_id = me;
  return jsonb_build_object('can_manage', clinic_people.manage(), 'can_view_all', allv, 'today', (now() at time zone 'Africa/Cairo')::date,
    'items', (select coalesce(jsonb_agg(to_jsonb(i) - 'request_id' || jsonb_build_object('full_name', p.full_name, 'code', p.code, 'person_status', p.status) order by p.full_name, i.insurance_type, i.started_on desc), '[]'::jsonb)
      from clinic_people.insurance_enrollments i join clinic_people.people p on p.id = i.person_id where allv or (mine is not null and i.person_id = mine)),
    'people', case when clinic_people.manage() then (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'full_name', p.full_name) order by p.full_name), '[]'::jsonb) from clinic_people.people p where p.status <> 'ended') else '[]'::jsonb end);
end $$;

-- what the payroll form should read for one person and month (employee deduction only; active during any day of the month)
create function public.hr_insurance_deduction(p_person uuid, p_month date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if public.my_admin_id() is null then raise exception 'سجل الدخول'; end if;
  if not (clinic_people.manage() or clinic_finance.allowed('create') or clinic_finance.allowed('review')) then raise exception 'ليس لديك صلاحية لهذه العملية' using errcode = '42501'; end if;
  return jsonb_build_object('person_id', p_person, 'month', m,
    'insurance', (select coalesce(sum(employee_deduction), 0) from clinic_people.insurance_enrollments where person_id = p_person and started_on <= (m + interval '1 month - 1 day')::date and (stopped_on is null or stopped_on >= m)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('type', insurance_type, 'number', insurance_number, 'employee_deduction', employee_deduction, 'center_share', center_share) order by insurance_type), '[]'::jsonb)
      from clinic_people.insurance_enrollments where person_id = p_person and started_on <= (m + interval '1 month - 1 day')::date and (stopped_on is null or stopped_on >= m)));
end $$;

-- accounting: the month's picture
create function clinic_finance.insurance_month(p_month date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare m date := date_trunc('month', p_month)::date; me_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  emp numeric; ctr numeric; pap numeric; ppen numeric; liab numeric; withheld numeric;
begin
  if not (clinic_finance.allowed('create') or clinic_finance.allowed('review')) then raise exception 'ليس لديك صلاحية لهذه العملية المالية' using errcode = '42501'; end if;
  select coalesce(sum(employee_deduction), 0), coalesce(sum(center_share), 0) into emp, ctr from clinic_people.insurance_enrollments where started_on <= me_end and (stopped_on is null or stopped_on >= m);
  select coalesce(sum(case when b.status = 'approved' then p.amount end), 0), coalesce(sum(case when b.status = 'pending' then p.amount end), 0) into pap, ppen
    from clinic_finance.insurance_payments p join clinic_finance.business_requests b on b.id = p.request_id where p.month = m;
  select coalesce(sum(l.credit - l.debit), 0) into liab from clinic_finance.lines l where l.account = '2143';
  select coalesce(sum(amount), 0) into withheld from (select (payload->>'insurance')::numeric amount from clinic_finance.business_requests where kind = 'payroll' and status = 'approved' and payload->>'month' = m::text) x;
  return jsonb_build_object('month', m, 'employee_total', emp, 'center_total', ctr, 'total_due', emp + ctr, 'payroll_withheld', withheld,
    'paid_approved', pap, 'paid_pending', ppen, 'remaining', greatest(0, emp + ctr - pap - ppen), 'liability_balance', liab,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('person_id', p.id, 'code', p.code, 'full_name', p.full_name, 'insurance_type', i.insurance_type, 'insurance_number', i.insurance_number,
        'employee_deduction', i.employee_deduction, 'center_share', i.center_share, 'started_on', i.started_on, 'stopped_on', i.stopped_on) order by p.full_name, i.insurance_type), '[]'::jsonb)
      from clinic_people.insurance_enrollments i join clinic_people.people p on p.id = i.person_id where i.started_on <= me_end and (i.stopped_on is null or i.stopped_on >= m)),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'reference', p.reference, 'note', p.note, 'created_at', p.created_at, 'status', b.status, 'review_note', b.review_note) order by p.created_at desc), '[]'::jsonb)
      from clinic_finance.insurance_payments p join clinic_finance.business_requests b on b.id = p.request_id where p.month = m));
end $$;

create function public.clinic_finance_insurance_month(p_month date) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_finance.insurance_month(p_month)
$$;

-- accounting: record a payment to the insurance authority. Creates the existing statutory_payment request (Dr 2143 / Cr cash or bank on approval by ANOTHER person).
create function public.clinic_finance_insurance_pay(p_month date, p_amount numeric, p_method text, p_shift uuid, p_reference text, p_note text, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_finance.require_access('create'); m date := date_trunc('month', p_month)::date; v uuid; sm jsonb;
begin
  select b.id into v from clinic_finance.business_requests b where b.created_by = me and b.token = p_token and b.kind = 'statutory_payment';
  if found then if exists(select 1 from clinic_finance.insurance_payments where request_id = v) then return v; end if; end if;
  perform pg_advisory_xact_lock(712241109);
  if p_month is null or m > date_trunc('month', (now() at time zone 'Africa/Cairo')::date)::date then raise exception 'لا يُسجَّل سداد لشهر لم يبدأ'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount::text in ('NaN', 'Infinity') then raise exception 'المبلغ يجب أن يكون موجبًا بقرشين كحد أقصى'; end if;
  if coalesce(p_method, '') not in ('cash', 'bank') then raise exception 'اختر قناة الصرف'; end if;
  sm := clinic_finance.insurance_month(m);
  if p_amount > (sm->>'remaining')::numeric then raise exception 'المبلغ يتجاوز المتبقي المستحق للشهر (%).', sm->>'remaining'; end if;
  v := public.clinic_finance_business_command('request', jsonb_build_object('kind', 'statutory_payment', 'subject', 'تأمينات ' || to_char(m, 'YYYY-MM'), 'reference', trim(coalesce(p_reference, '')),
    'note', trim(coalesce(p_note, '')), 'amount', p_amount, 'method', p_method, 'shift_id', p_shift, 'account', '2143', 'month', m, 'source', 'hr_insurance'), p_token);
  insert into clinic_finance.insurance_payments(month, amount, request_id, reference, note, created_by) values (m, p_amount, v, trim(p_reference), trim(coalesce(p_note, '')), me) on conflict (request_id) do nothing;
  return v;
end $$;

revoke all on function clinic_people.insurance_view_all() from public, anon, authenticated;
revoke all on function clinic_finance.insurance_month(date) from public, anon, authenticated;
revoke all on function public.hr_insurance_command(text, jsonb), public.hr_insurance_workspace(), public.hr_insurance_deduction(uuid, date),
  public.clinic_finance_insurance_month(date), public.clinic_finance_insurance_pay(date, numeric, text, uuid, text, text, uuid) from public, anon;
grant execute on function public.hr_insurance_command(text, jsonb), public.hr_insurance_workspace(), public.hr_insurance_deduction(uuid, date),
  public.clinic_finance_insurance_month(date), public.clinic_finance_insurance_pay(date, numeric, text, uuid, text, text, uuid) to authenticated;

commit;
