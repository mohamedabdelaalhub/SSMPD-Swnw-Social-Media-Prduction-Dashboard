-- End of service and final settlement («إنهاء خدمة / مخالصة») — phase 4 of the offboarding work (design: offboarding-design-20261109.md, section 6-ب).
-- Flow:  HR opens a case (person, last day, reason)  ->  accountant prepares the settlement sheet (dues for him, dues on him, custody not returned, documents)
--        ->  financial manager approves (the creator of the case or of the sheet can NOT approve)  ->  printable settlement from a versioned template  ->  HR uploads the signed file
--        ->  «شهادة الخبرة» unlocks ONLY after the signed file (hard block; the only exception is the owner role with a recorded reason)  ->  «إيقاف التأمينات» step (date, reference, MANUAL deadline)
--        ->  completion: his doctor contracts end on the last day, his file is closed (status ended), his dashboard account is locked from the last day, and ordinary payouts to him are blocked.
-- Money: the sheet computes the net (for him minus on him) from the existing books; the actual payment of the net is recorded by reference (no new posting path is created here).
-- ADDITIVE ONLY: 4 new tables (RLS on, no direct grants), new SECURITY DEFINER functions, and 2 BEFORE INSERT guard triggers that only act for a person with an approved case. No existing function is replaced.
-- Rollback: supabase/rollbacks/20261109160000_hr_offboarding.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_people.people') is null then raise exception 'جدول الموارد البشرية غير موجود'; end if;
  if to_regclass('clinic_people.audit') is null then raise exception 'سجل المراجعة للموارد البشرية غير موجود'; end if;
  if to_regclass('clinic_people.custody_items') is null then raise exception 'طبّق ملف سجل العهد (20261109110000) أولًا'; end if;
  if to_regclass('clinic_people.insurance_enrollments') is null then raise exception 'طبّق ملف التأمينات (20261109120000) أولًا'; end if;
  if to_regclass('clinic_finance.doctor_contracts') is null or to_regclass('clinic_finance.doctor_payouts') is null or to_regclass('clinic_finance.business_requests') is null then raise exception 'جداول الحسابات غير موجودة'; end if;
  if to_regclass('clinic_people.offboarding_cases') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- versioned, editable texts (the lawyer will revise them): one published version per kind at a time
create table clinic_people.offboarding_templates(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('settlement', 'certificate')),
  version integer not null check (version > 0),
  body text not null check (length(trim(body)) between 20 and 20000),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  note text not null default '' check (length(note) <= 500),
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  published_by uuid references public.admins(id),
  published_at timestamptz,
  unique (kind, version)
);
create unique index offboarding_templates_one_published on clinic_people.offboarding_templates(kind) where status = 'published';

create table clinic_people.offboarding_cases(
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  person_id uuid not null references clinic_people.people(id),
  last_day date not null,
  reason text not null check (reason in ('resignation', 'termination', 'contract_end', 'other')),
  reason_note text not null default '' check (length(reason_note) <= 2000),
  status text not null default 'requested' check (status in ('requested', 'sheet_ready', 'approved', 'signed', 'completed', 'cancelled')),
  sheet_by uuid references public.admins(id),
  sheet_at timestamptz,
  return_note text not null default '' check (length(return_note) <= 1000),
  approved_by uuid references public.admins(id),
  approved_at timestamptz,
  net_to_him numeric(14, 2),
  net_on_him numeric(14, 2),
  net_amount numeric(14, 2),
  settlement_template_id uuid references clinic_people.offboarding_templates(id),
  signed_url text check (signed_url is null or signed_url ~ '^https://'),
  signed_by uuid references public.admins(id),
  signed_at timestamptz,
  cert_issued_at timestamptz,
  cert_issued_by uuid references public.admins(id),
  cert_template_id uuid references clinic_people.offboarding_templates(id),
  cert_override_reason text check (cert_override_reason is null or length(trim(cert_override_reason)) >= 5),
  cert_override_by uuid references public.admins(id),
  insurance_stopped_on date,
  insurance_reference text not null default '' check (length(insurance_reference) <= 200),
  insurance_deadline date,
  payment_reference text not null default '' check (length(payment_reference) <= 200),
  paid_on date,
  paid_by uuid references public.admins(id),
  completed_at timestamptz,
  completed_by uuid references public.admins(id),
  cancel_reason text not null default '' check (length(cancel_reason) <= 1000),
  revision integer not null default 1,
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index offboarding_cases_one_open on clinic_people.offboarding_cases(person_id) where status not in ('completed', 'cancelled');
create index offboarding_cases_person on clinic_people.offboarding_cases(person_id, created_at);

create table clinic_people.offboarding_lines(
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references clinic_people.offboarding_cases(id) on delete cascade,
  kind text not null check (kind in ('due_to_him', 'due_on_him', 'custody', 'document')),
  source text not null check (source in ('doctor_balance', 'payroll', 'advance', 'custody', 'manual')),
  label text not null check (length(trim(label)) between 2 and 300),
  amount numeric(14, 2) not null default 0 check (amount >= 0 and amount < 100000000 and amount::text not in ('NaN', 'Infinity')),
  ref_id uuid,
  resolution text not null default 'counted' check (resolution in ('counted', 'pending', 'returned', 'deducted', 'waived')),
  resolution_note text not null default '' check (length(resolution_note) <= 1000),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  check ((kind in ('due_to_him', 'due_on_him') and resolution = 'counted') or (kind in ('custody', 'document') and resolution <> 'counted'))
);
create index offboarding_lines_case on clinic_people.offboarding_lines(case_id);

alter table clinic_people.offboarding_templates enable row level security;
alter table clinic_people.offboarding_cases enable row level security;
alter table clinic_people.offboarding_lines enable row level security;
revoke all on clinic_people.offboarding_templates, clinic_people.offboarding_cases, clinic_people.offboarding_lines from public, anon, authenticated;

-- first versions (plain drafts for the lawyer to revise; placeholders in double braces are filled by the screen when printing)
insert into clinic_people.offboarding_templates(kind, version, body, status, note, published_at) values
('settlement', 1, E'مخالصة نهائية\nالتاريخ: {{date}}\nأقر أنا الموقع أدناه {{name}} ({{code}}) — {{job_title}} — بأنني أنهيت عملي لدى المركز بتاريخ {{last_day}} (السبب: {{reason}}).\nوأقر بأنني استلمت من المركز كامل مستحقاتي كما هو مبين في الكشف التالي، وبأنني سلمت ما كان في عهدتي من أجهزة ومستندات إلا ما ورد صراحة أدناه، وأنه لا يوجد لي أي حق أو مطالبة أخرى قبل المركز بعد استلام صافي المخالصة.\n\n{{lines}}\n\nإجمالي المستحق له: {{to_him}}\nإجمالي المستحق عليه: {{on_him}}\nالصافي: {{net}}\n\nمسودة أولية بانتظار مراجعة المستشار القانوني.\n\nالتوقيع: ______________    مسؤول الموارد البشرية: ______________    المحاسب: ______________', 'published', 'النص الأولي قبل مراجعة المحامي', now()),
('certificate', 1, E'شهادة خبرة\nتشهد إدارة المركز بأن السيد/ة {{name}} ({{code}}) عمل/ت لدينا بوظيفة {{job_title}} في الفترة من {{start_date}} إلى {{last_day}}.\nوقد أعطيت له/ا هذه الشهادة بناءً على طلبه/ا دون أدنى مسؤولية على المركز.\nالتاريخ: {{date}}\n\nمسودة أولية بانتظار مراجعة المستشار القانوني.\n\nالختم والتوقيع: ______________', 'published', 'النص الأولي قبل مراجعة المحامي', now());

create function clinic_people.offboarding_view() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and (clinic_people.manage() or clinic_finance.allowed('create') or clinic_finance.allowed('review'))
$$;

-- net of one case: for him minus on him (custody counted "on him" only when the accountant resolved it as deducted)
create function clinic_people.offboarding_net(p_case uuid) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('to_him', t.to_him, 'on_him', t.on_him, 'net', t.to_him - t.on_him)
  from (select coalesce(sum(amount) filter (where kind = 'due_to_him'), 0) to_him,
               coalesce(sum(amount) filter (where kind = 'due_on_him' or (kind = 'custody' and resolution = 'deducted')), 0) on_him
        from clinic_people.offboarding_lines where case_id = p_case) t
$$;

-- one place that decides if a person is in settlement (approved or later): used by the guard triggers below
create function clinic_people.in_settlement(p_person uuid) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from clinic_people.offboarding_cases where person_id = p_person and status in ('approved', 'signed', 'completed'))
$$;

-- ordinary payouts to a person in settlement are blocked: everything he is owed is paid through the settlement
create function clinic_finance.offboarding_guard_payout() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare pid uuid;
begin
  if coalesce(current_setting('swnw.offboarding_bypass', true), '') = 'on' then return new; end if;
  if tg_table_name = 'doctor_payouts' then
    select id into pid from clinic_people.people where doctor_key = new.doctor_key;
  elsif new.kind in ('payroll', 'salary_payment', 'advance') then
    select id into pid from clinic_people.people where finance_subject = new.subject;
  end if;
  if pid is not null and clinic_people.in_settlement(pid) then raise exception 'هذا الشخص في إجراءات إنهاء الخدمة؛ كل مستحقاته تُصرف من المخالصة وليس من الصرف العادي'; end if;
  return new;
end $$;
create trigger offboarding_guard_doctor_payout before insert on clinic_finance.doctor_payouts for each row execute function clinic_finance.offboarding_guard_payout();
create trigger offboarding_guard_business_request before insert on clinic_finance.business_requests for each row when (new.kind in ('payroll', 'salary_payment', 'advance')) execute function clinic_finance.offboarding_guard_payout();

-- lock the dashboard account of every completed case whose last day has arrived (idempotent; the screen calls it on load, a timer may call it too)
create function public.hr_offboarding_lock_due() returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare n integer := 0; c record; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if public.my_admin_id() is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.offboarding_view() then raise exception 'ليس لديك صلاحية لهذه العملية' using errcode = '42501'; end if;
  for c in select o.id, p.admin_id from clinic_people.offboarding_cases o join clinic_people.people p on p.id = o.person_id where o.status = 'completed' and o.last_day <= today and p.admin_id is not null loop
    if exists(select 1 from public.admins where id = c.admin_id and active) then
      update public.admins set active = false where id = c.admin_id;
      insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (public.my_admin_id(), 'offboarding_lock_account', c.id, jsonb_build_object('active', true), jsonb_build_object('active', false));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- templates: new text is always a new version; publishing retires the previous published one
create function public.hr_offboarding_template(p_action text, p_payload jsonb) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); k text := p_payload->>'kind'; t clinic_people.offboarding_templates%rowtype; v uuid; nv integer;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'نصوص المخالصة والشهادة لإدارة الموارد البشرية'; end if;
  if p_action = 'save' then
    if k not in ('settlement', 'certificate') then raise exception 'نوع النص غير معروف'; end if;
    if length(trim(coalesce(p_payload->>'body', ''))) < 20 then raise exception 'النص قصير جدًا'; end if;
    perform pg_advisory_xact_lock(712241140);
    select coalesce(max(version), 0) + 1 into nv from clinic_people.offboarding_templates where kind = k;
    insert into clinic_people.offboarding_templates(kind, version, body, note, created_by) values (k, nv, p_payload->>'body', trim(coalesce(p_payload->>'note', '')), me) returning id into v;
    insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'offboarding_template_save', v, null, jsonb_build_object('kind', k, 'version', nv));
    return v;
  elsif p_action = 'publish' then
    select * into t from clinic_people.offboarding_templates where id = nullif(p_payload->>'id', '')::uuid for update;
    if not found or t.status <> 'draft' then raise exception 'اختر نسخة مسودة للنشر'; end if;
    update clinic_people.offboarding_templates set status = 'retired' where kind = t.kind and status = 'published';
    update clinic_people.offboarding_templates set status = 'published', published_by = me, published_at = now() where id = t.id;
    insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'offboarding_template_publish', t.id, null, jsonb_build_object('kind', t.kind, 'version', t.version));
    return t.id;
  end if;
  raise exception 'إجراء غير متاح';
end $$;

-- the case state machine
create function public.hr_offboarding_command(p_action text, p_payload jsonb) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  today date := (now() at time zone 'Africa/Cairo')::date;
  c clinic_people.offboarding_cases%rowtype; p clinic_people.people%rowtype; l clinic_people.offboarding_lines%rowtype;
  v uuid := nullif(p_payload->>'id', '')::uuid; rid uuid := nullif(p_payload->>'request_id', '')::uuid;
  r text; d date; amt numeric; net jsonb; tid uuid; key text; n integer; bal numeric; due numeric; adv numeric; prior jsonb; afterj jsonb;
begin
  if me is null then raise exception 'سجل الدخول'; end if;

  if p_action = 'open' then
    if not clinic_people.manage() then raise exception 'فتح إنهاء الخدمة لإدارة الموارد البشرية'; end if;
    if rid is not null then select id into v from clinic_people.offboarding_cases where request_id = rid; if found then return v; end if; end if;
    select * into p from clinic_people.people where id = nullif(p_payload->>'person_id', '')::uuid for update;
    if not found or p.status = 'ended' then raise exception 'اختر موظفًا مستمرًا في العمل'; end if;
    if exists(select 1 from clinic_people.offboarding_cases where person_id = p.id and status not in ('completed', 'cancelled')) then raise exception 'يوجد إجراء إنهاء خدمة مفتوح لهذا الشخص'; end if;
    r := p_payload->>'reason'; if r not in ('resignation', 'termination', 'contract_end', 'other') then raise exception 'اختر سبب إنهاء الخدمة'; end if;
    d := nullif(p_payload->>'last_day', '')::date;
    if d is null or d < today - 60 or d > today + 365 then raise exception 'راجع آخر يوم عمل'; end if;
    insert into clinic_people.offboarding_cases(request_id, person_id, last_day, reason, reason_note, created_by) values (rid, p.id, d, r, trim(coalesce(p_payload->>'reason_note', '')), me) returning id, to_jsonb(offboarding_cases.*) into v, afterj;
    insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'offboarding_open', v, null, afterj);
    return v;
  end if;

  select * into c from clinic_people.offboarding_cases where id = v for update;
  if not found then raise exception 'الإجراء غير موجود'; end if;
  prior := to_jsonb(c);
  select * into p from clinic_people.people where id = c.person_id;

  if p_action = 'cancel' then
    if not clinic_people.manage() then raise exception 'إلغاء إنهاء الخدمة لإدارة الموارد البشرية'; end if;
    if c.status not in ('requested', 'sheet_ready') then raise exception 'لا يُلغى بعد اعتماد المخالصة'; end if;
    if length(trim(coalesce(p_payload->>'reason', ''))) < 3 then raise exception 'اكتب سبب الإلغاء'; end if;
    update clinic_people.offboarding_cases set status = 'cancelled', cancel_reason = trim(p_payload->>'reason'), revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'change_last_day' then
    if not clinic_people.manage() then raise exception 'تعديل آخر يوم لإدارة الموارد البشرية'; end if;
    if c.status not in ('requested', 'sheet_ready') then raise exception 'لا يُعدَّل آخر يوم بعد اعتماد المخالصة'; end if;
    d := nullif(p_payload->>'last_day', '')::date;
    if d is null or d < today - 60 or d > today + 365 then raise exception 'راجع آخر يوم عمل'; end if;
    update clinic_people.offboarding_cases set last_day = d, status = 'requested', revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'load_defaults' then
    perform clinic_finance.require_access('create');
    if c.status not in ('requested', 'sheet_ready') then raise exception 'الكشف مغلق للتعديل'; end if;
    -- replace only the lines the system generated; manual lines and resolutions of manual lines are kept
    delete from clinic_people.offboarding_lines where case_id = c.id and source <> 'manual';
    key := p.doctor_key;
    if key is not null then
      bal := greatest(0, coalesce(clinic_finance.doctor_balance(key), 0));
      if bal > 0 then insert into clinic_people.offboarding_lines(case_id, kind, source, label, amount, created_by) values (c.id, 'due_to_him', 'doctor_balance', 'رصيد الطبيب المستحق (حساب الطبيب)', bal, me); end if;
    end if;
    if p.finance_subject is not null then
      due := greatest(0, coalesce(clinic_finance.employee_due(p.finance_subject), 0));
      if due > 0 then insert into clinic_people.offboarding_lines(case_id, kind, source, label, amount, created_by) values (c.id, 'due_to_him', 'payroll', 'صافي مرتبات مستحقة لم تُصرف', due, me); end if;
      adv := greatest(0, coalesce(clinic_finance.employee_advance(p.finance_subject), 0));
      if adv > 0 then insert into clinic_people.offboarding_lines(case_id, kind, source, label, amount, created_by) values (c.id, 'due_on_him', 'advance', 'سلف غير مستردة', adv, me); end if;
    end if;
    insert into clinic_people.offboarding_lines(case_id, kind, source, label, amount, ref_id, resolution, created_by)
      select c.id, 'custody', 'custody', i.item_name || ' (' || i.code || ')' || case when i.status = 'with_holder' then '' when i.status = 'lost' then ' — مفقودة' else ' — تالفة' end, i.value, i.id, 'pending', me
      from clinic_people.custody_items i where i.holder_id = c.person_id and i.status in ('with_holder', 'lost', 'damaged');
    update clinic_people.offboarding_cases set status = 'requested', sheet_by = null, sheet_at = null, revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'add_line' then
    perform clinic_finance.require_access('create');
    if c.status not in ('requested', 'sheet_ready') then raise exception 'الكشف مغلق للتعديل'; end if;
    r := p_payload->>'kind'; if r not in ('due_to_him', 'due_on_him', 'custody', 'document') then raise exception 'نوع البند غير معروف'; end if;
    amt := coalesce(nullif(p_payload->>'amount', '')::numeric, 0);
    if amt < 0 or amt >= 100000000 or amt <> round(amt, 2) then raise exception 'راجع المبلغ'; end if;
    if length(trim(coalesce(p_payload->>'label', ''))) < 2 then raise exception 'اكتب وصف البند'; end if;
    if r = 'document' then amt := 0; end if;
    insert into clinic_people.offboarding_lines(case_id, kind, source, label, amount, resolution, created_by)
      values (c.id, r, 'manual', trim(p_payload->>'label'), amt, case when r in ('custody', 'document') then 'pending' else 'counted' end, me);
    update clinic_people.offboarding_cases set status = 'requested', sheet_by = null, sheet_at = null, revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'remove_line' then
    perform clinic_finance.require_access('create');
    if c.status not in ('requested', 'sheet_ready') then raise exception 'الكشف مغلق للتعديل'; end if;
    delete from clinic_people.offboarding_lines where id = nullif(p_payload->>'line_id', '')::uuid and case_id = c.id and source = 'manual';
    if not found then raise exception 'يُحذف البند اليدوي فقط؛ للبند التلقائي استخدم «تحميل البيانات» من جديد'; end if;
    update clinic_people.offboarding_cases set status = 'requested', sheet_by = null, sheet_at = null, revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'resolve_line' then
    perform clinic_finance.require_access('create');
    if c.status not in ('requested', 'sheet_ready') then raise exception 'الكشف مغلق للتعديل'; end if;
    select * into l from clinic_people.offboarding_lines where id = nullif(p_payload->>'line_id', '')::uuid and case_id = c.id for update;
    if not found or l.kind not in ('custody', 'document') then raise exception 'البند لا يحتاج معالجة'; end if;
    r := p_payload->>'resolution';
    if r not in ('returned', 'deducted', 'waived') or (r = 'deducted' and l.kind = 'document') then raise exception 'اختر معالجة صحيحة للبند'; end if;
    if r = 'deducted' and l.amount <= 0 then raise exception 'لا تُخصم عهدة بلا قيمة'; end if;
    if r = 'waived' and length(trim(coalesce(p_payload->>'note', ''))) < 3 then raise exception 'اكتب سبب التنازل'; end if;
    update clinic_people.offboarding_lines set resolution = r, resolution_note = trim(coalesce(p_payload->>'note', '')) where id = l.id;
    update clinic_people.offboarding_cases set status = 'requested', sheet_by = null, sheet_at = null, revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'submit_sheet' then
    perform clinic_finance.require_access('create');
    if c.status <> 'requested' then raise exception 'الكشف مرسل أو مغلق'; end if;
    if not exists(select 1 from clinic_people.offboarding_lines where case_id = c.id) then raise exception 'حمّل بيانات الكشف أو أضف بندًا قبل الإرسال'; end if;
    update clinic_people.offboarding_cases set status = 'sheet_ready', sheet_by = me, sheet_at = now(), return_note = '', revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'return_sheet' then
    perform clinic_finance.require_access('review');
    if c.status <> 'sheet_ready' then raise exception 'لا يوجد كشف بانتظار الاعتماد'; end if;
    if length(trim(coalesce(p_payload->>'note', ''))) < 3 then raise exception 'اكتب سبب إعادة الكشف'; end if;
    update clinic_people.offboarding_cases set status = 'requested', return_note = trim(p_payload->>'note'), sheet_by = null, sheet_at = null, revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'approve' then
    perform clinic_finance.require_access('review');
    if c.status <> 'sheet_ready' then raise exception 'لا يوجد كشف بانتظار الاعتماد'; end if;
    if c.revision <> coalesce((p_payload->>'revision')::int, 0) then raise exception 'الكشف تغير؛ أعد تحميله قبل الاعتماد'; end if;
    if me = c.created_by or me = c.sheet_by then raise exception 'لا يعتمد المخالصة من فتح الإجراء أو أعدّ الكشف'; end if;
    if exists(select 1 from clinic_people.offboarding_lines where case_id = c.id and resolution = 'pending') then raise exception 'عالج كل العهد والمستندات (تسليم أو خصم أو تنازل) قبل الاعتماد'; end if;
    select id into tid from clinic_people.offboarding_templates where kind = 'settlement' and status = 'published';
    if tid is null then raise exception 'لا يوجد نص منشور للمخالصة'; end if;
    net := clinic_people.offboarding_net(c.id);
    update clinic_people.offboarding_cases set status = 'approved', approved_by = me, approved_at = now(), net_to_him = (net->>'to_him')::numeric, net_on_him = (net->>'on_him')::numeric, net_amount = (net->>'net')::numeric,
      settlement_template_id = tid, revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'upload_signed' then
    if not clinic_people.manage() then raise exception 'رفع المخالصة الموقعة لإدارة الموارد البشرية'; end if;
    if c.status <> 'approved' then raise exception 'ارفع الملف بعد اعتماد المخالصة'; end if;
    if coalesce(p_payload->>'url', '') !~ '^https://' or length(p_payload->>'url') > 2000 then raise exception 'رابط الملف الموقع غير صحيح (يبدأ بـ https://)'; end if;
    update clinic_people.offboarding_cases set status = 'signed', signed_url = p_payload->>'url', signed_by = me, signed_at = now(), revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'record_payment' then
    perform clinic_finance.require_access('create');
    if c.status not in ('approved', 'signed') then raise exception 'سجّل الصرف بعد اعتماد المخالصة'; end if;
    if length(trim(coalesce(p_payload->>'reference', ''))) < 2 then raise exception 'اكتب مرجع صرف صافي المخالصة'; end if;
    d := coalesce(nullif(p_payload->>'paid_on', '')::date, today);
    update clinic_people.offboarding_cases set payment_reference = trim(p_payload->>'reference'), paid_on = d, paid_by = me, revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'issue_certificate' then
    if not clinic_people.manage() then raise exception 'شهادة الخبرة لإدارة الموارد البشرية'; end if;
    if c.status not in ('approved', 'signed', 'completed') then raise exception 'لا تصدر الشهادة قبل اعتماد المخالصة'; end if;
    if c.signed_url is null then
      -- HARD BLOCK: the certificate unlocks only after the signed settlement file; the single exception is the owner role with a recorded reason
      if not public.has_role('super_admin') then raise exception 'لا تصدر شهادة الخبرة قبل رفع المخالصة الموقعة'; end if;
      if length(trim(coalesce(p_payload->>'override_reason', ''))) < 5 then raise exception 'استثناء المالك يحتاج سببًا مكتوبًا'; end if;
    end if;
    select id into tid from clinic_people.offboarding_templates where kind = 'certificate' and status = 'published';
    if tid is null then raise exception 'لا يوجد نص منشور للشهادة'; end if;
    update clinic_people.offboarding_cases set cert_issued_at = coalesce(cert_issued_at, now()), cert_issued_by = coalesce(cert_issued_by, me), cert_template_id = tid,
      cert_override_reason = case when c.signed_url is null then trim(p_payload->>'override_reason') else cert_override_reason end,
      cert_override_by = case when c.signed_url is null then me else cert_override_by end, revision = revision + 1, updated_at = now() where id = c.id;

  elsif p_action = 'stop_insurance' then
    if not clinic_people.manage() then raise exception 'إيقاف التأمينات لإدارة الموارد البشرية'; end if;
    if c.status not in ('approved', 'signed', 'completed') then raise exception 'أوقف التأمينات بعد اعتماد المخالصة'; end if;
    d := nullif(p_payload->>'stopped_on', '')::date;
    if d is null or d > today + 31 then raise exception 'راجع تاريخ إيقاف التأمينات'; end if;
    update clinic_people.insurance_enrollments set status = 'stopped', stopped_on = greatest(d, started_on), stop_reference = trim(coalesce(p_payload->>'reference', '')),
      notification_deadline = nullif(p_payload->>'deadline', '')::date, revision = revision + 1, updated_at = now() where person_id = c.person_id and status = 'active';
    get diagnostics n = row_count;
    update clinic_people.offboarding_cases set insurance_stopped_on = d, insurance_reference = trim(coalesce(p_payload->>'reference', '')), insurance_deadline = nullif(p_payload->>'deadline', '')::date, revision = revision + 1, updated_at = now() where id = c.id;
    afterj := jsonb_build_object('stopped_enrollments', n);

  elsif p_action = 'complete' then
    if not clinic_people.manage() then raise exception 'إغلاق ملف الموظف لإدارة الموارد البشرية'; end if;
    if c.status not in ('approved', 'signed') then raise exception 'أغلق الملف بعد اعتماد المخالصة'; end if;
    if c.signed_url is null and c.cert_override_reason is null then raise exception 'ارفع المخالصة الموقعة أولًا (أو استثناء مسجّل من المالك)'; end if;
    if c.paid_on is null and coalesce(c.net_amount, 0) > 0 then raise exception 'سجّل صرف صافي المخالصة قبل إغلاق الملف'; end if;
    key := coalesce(p.doctor_key, p.code);
    update clinic_finance.doctor_contracts set valid_to = c.last_day where status = 'active' and doctor_key = key and valid_from <= c.last_day and valid_to > c.last_day;
    get diagnostics n = row_count;
    update clinic_people.insurance_enrollments set status = 'stopped', stopped_on = greatest(c.last_day, started_on), stop_reference = 'أُوقف عند إغلاق ملف الموظف', revision = revision + 1, updated_at = now() where person_id = c.person_id and status = 'active';
    update clinic_people.people set status = 'ended', end_date = c.last_day where id = c.person_id;
    update clinic_people.offboarding_cases set status = 'completed', completed_at = now(), completed_by = me, revision = revision + 1, updated_at = now() where id = c.id;
    afterj := jsonb_build_object('contracts_closed', n);
    if c.last_day <= today and p.admin_id is not null then
      update public.admins set active = false where id = p.admin_id;
      insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'offboarding_lock_account', c.id, jsonb_build_object('active', true), jsonb_build_object('active', false));
    end if;

  else
    raise exception 'إجراء غير متاح';
  end if;

  select to_jsonb(x) || coalesce(afterj, '{}'::jsonb) into afterj from clinic_people.offboarding_cases x where id = c.id;
  insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'offboarding_' || p_action, c.id, prior, afterj);
  return c.id;
end $$;

-- everything the two screens need (HR tab and accounting tab share it)
create function public.hr_offboarding_workspace() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.offboarding_view() then raise exception 'ليس لديك صلاحية لهذه العملية' using errcode = '42501'; end if;
  return jsonb_build_object(
    'me', me, 'today', (now() at time zone 'Africa/Cairo')::date,
    'can_manage', clinic_people.manage(), 'can_prepare', clinic_finance.allowed('create'), 'can_review', clinic_finance.allowed('review'), 'is_owner', public.has_role('super_admin'),
    'cases', (select coalesce(jsonb_agg(to_jsonb(o) - 'request_id' || jsonb_build_object(
        'full_name', p.full_name, 'code', p.code, 'job_title', p.job_title, 'start_date', p.start_date, 'net', clinic_people.offboarding_net(o.id),
        'lines', (select coalesce(jsonb_agg(to_jsonb(l) - 'created_by' order by l.kind, l.created_at), '[]'::jsonb) from clinic_people.offboarding_lines l where l.case_id = o.id))
        order by o.created_at desc), '[]'::jsonb)
      from clinic_people.offboarding_cases o join clinic_people.people p on p.id = o.person_id),
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'version', t.version, 'status', t.status, 'note', t.note, 'published_at', t.published_at,
        'body', t.body) order by t.kind, t.version desc), '[]'::jsonb) from clinic_people.offboarding_templates t),
    'people', case when clinic_people.manage() then (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'full_name', p.full_name) order by p.full_name), '[]'::jsonb)
      from clinic_people.people p where p.status <> 'ended' and not exists(select 1 from clinic_people.offboarding_cases o where o.person_id = p.id and o.status not in ('completed', 'cancelled'))) else '[]'::jsonb end);
end $$;

revoke all on function clinic_people.offboarding_view(), clinic_people.offboarding_net(uuid), clinic_people.in_settlement(uuid), clinic_finance.offboarding_guard_payout() from public, anon, authenticated;
revoke all on function public.hr_offboarding_lock_due(), public.hr_offboarding_template(text, jsonb), public.hr_offboarding_command(text, jsonb), public.hr_offboarding_workspace() from public, anon;
grant execute on function public.hr_offboarding_lock_due(), public.hr_offboarding_template(text, jsonb), public.hr_offboarding_command(text, jsonb), public.hr_offboarding_workspace() to authenticated;

commit;
