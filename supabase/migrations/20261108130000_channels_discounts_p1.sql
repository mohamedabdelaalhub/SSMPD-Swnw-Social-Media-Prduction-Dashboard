-- Phase 1: booking channels / platforms with patient discount + platform share, snapshotted on every invoice and deducted from the doctor base.
-- ADDITIVE: 2 new tables, 1 trigger, 3 new functions, 2 re-created functions (doctor_sync, clinic_finance_snapshot wrapper).
-- Existing invoices (no channel) compute EXACTLY as before: the new term in doctor_sync is 0 when an invoice has no channel row.
-- Rollback: supabase/rollbacks/20261108130000_channels_discounts_p1.rollback.sql
begin;

-- Safety: this migration replaces doctor_sync and wraps the snapshot. Refuse to run if the live definitions are not the ones this file was written against.
do $$ begin
  if to_regprocedure('clinic_finance.doctor_sync(uuid)') is null
     or position('greatest(0,a.original_base*revenue/i.amount-a.original_deduction)' in pg_get_functiondef('clinic_finance.doctor_sync(uuid)'::regprocedure)) = 0 then
    raise exception 'clinic_finance.doctor_sync غير مطابقة للمتوقع؛ لا تطبق هذا الملف قبل مراجعة الفرق';
  end if;
  if to_regprocedure('clinic_finance.doctor_snapshot_base(date,date,integer)') is null then
    raise exception 'غلاف لقطة الأطباء غير موجود؛ طبق migration عقود الأطباء أولًا';
  end if;
end $$;

-- Rules managed from the dashboard (no code). A change = a NEW version, approved by someone other than its creator (like price lists / doctor contracts).
create table clinic_finance.channel_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  version integer not null check (version > 0),
  name text not null check (length(trim(name)) between 2 and 120),
  kind text not null check (kind in ('external', 'internal', 'contracting')),
  applies_to text not null check (applies_to in ('consultation', 'all')),
  patient_discount_percent numeric(7,4) not null default 0 check (patient_discount_percent between 0 and 100),
  platform_share_percent numeric(7,4) not null default 0 check (platform_share_percent between 0 and 100),
  payable_kind text not null default 'none' check (payable_kind in ('none', 'commission', 'cashback')),
  payable_when text not null default '' check (length(payable_when) <= 200),
  source_codes text[] not null default '{}',
  valid_from date not null,
  valid_to date not null,
  notes text not null default '' check (length(notes) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'retired')),
  payload jsonb not null,
  created_by uuid not null references public.admins(id),
  token uuid not null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.admins(id),
  reviewed_at timestamptz,
  review_note text,
  unique (code, version),
  unique (created_by, token),
  check (valid_from <= valid_to),
  check (patient_discount_percent + platform_share_percent <= 100),
  check (kind <> 'internal' or payable_kind = 'none'),
  check (payable_kind = 'none' or platform_share_percent > 0)
);

-- Frozen copy of the rule that applied when the invoice was booked + the amounts it produced.
create table clinic_finance.channel_allocations (
  invoice_id uuid primary key references clinic_finance.invoices(id),
  rule_id uuid not null references clinic_finance.channel_rules(id),
  channel_code text not null,
  channel_name text not null,
  kind text not null,
  payable_kind text not null,
  rule jsonb not null,
  gross_consultation numeric(14,2) not null check (gross_consultation >= 0),
  gross_services numeric(14,2) not null check (gross_services >= 0),
  patient_discount numeric(14,2) not null check (patient_discount >= 0),
  platform_share numeric(14,2) not null check (platform_share >= 0),
  created_at timestamptz not null default now()
);
create index channel_alloc_rule on clinic_finance.channel_allocations (rule_id);

alter table clinic_finance.channel_rules enable row level security;
alter table clinic_finance.channel_allocations enable row level security;
revoke all on clinic_finance.channel_rules, clinic_finance.channel_allocations from public, anon, authenticated;

-- Runs inside the bill transaction right after the invoice row exists (and BEFORE the doctor allocation is created), only when the bill payload names a channel.
create function clinic_finance.channel_invoice_snapshot() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare r clinic_finance.channel_rules%rowtype; cons numeric; svc numeric; applicable numeric; disc numeric; share numeric; claimed numeric;
begin
  if new.bill_payload is null or nullif(new.bill_payload->>'channel_id', '') is null then return new; end if;
  select * into r from clinic_finance.channel_rules where id = (new.bill_payload->>'channel_id')::uuid and status = 'active'
     and (now() at time zone 'Africa/Cairo')::date between valid_from and valid_to;
  if not found then raise exception 'قاعدة القناة غير معتمدة أو خارج فترة سريانها'; end if;
  cons := coalesce(nullif(new.bill_payload->>'consultation_gross', '')::numeric, 0);
  svc := coalesce(nullif(new.bill_payload->>'services_gross', '')::numeric, 0);
  claimed := (new.bill_payload->>'service_amount')::numeric;
  if cons < 0 or svc < 0 or cons <> round(cons, 2) or svc <> round(svc, 2) or cons::text in ('NaN', 'Infinity') or svc::text in ('NaN', 'Infinity') or cons + svc <= 0 then
    raise exception 'راجع قيمة الكشف وقيمة الخدمات قبل الخصم';
  end if;
  if r.applies_to = 'consultation' and cons <= 0 then raise exception 'هذه القناة تسري على الكشف فقط؛ أدخل قيمة الكشف'; end if;
  applicable := case r.applies_to when 'consultation' then cons else cons + svc end;
  disc := round(applicable * r.patient_discount_percent / 100, 2);
  share := round(applicable * r.platform_share_percent / 100, 2);
  if round(cons + svc - disc, 2) is distinct from round(claimed, 2) then
    raise exception 'قيمة الخدمة لا تطابق قاعدة القناة بعد خصم المريض (المتوقع %)', round(cons + svc - disc, 2);
  end if;
  insert into clinic_finance.channel_allocations(invoice_id, rule_id, channel_code, channel_name, kind, payable_kind, rule, gross_consultation, gross_services, patient_discount, platform_share)
  values (new.id, r.id, r.code, r.name, r.kind, r.payable_kind, to_jsonb(r) - 'payload' - 'token', cons, svc, disc, share);
  return new;
end $$;
create trigger channel_invoice_snapshot after insert on clinic_finance.invoices for each row execute function clinic_finance.channel_invoice_snapshot();

-- Same revenue definition as doctor_sync (voids, approved refunds, contractual adjustments), reused by the payables report.
create function clinic_finance.invoice_revenue(p_invoice uuid) returns numeric language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare i clinic_finance.invoices%rowtype; refund numeric; adjustment numeric;
begin
  select * into i from clinic_finance.invoices where id = p_invoice;
  if not found or i.voided then return 0; end if;
  select coalesce(sum(amount), 0) into refund from clinic_finance.requests where invoice_id = i.id and kind = 'refund' and status = 'approved';
  select coalesce(sum(x.amount), 0) into adjustment from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id = x.claim_id where c.invoice_id = i.id and x.kind = 'contractual' and x.status = 'approved';
  return greatest(0, i.amount - refund - adjustment);
end $$;

-- doctor_sync: identical to 20261017010341 except for ONE extra term: the platform/internal share of the invoice (scaled with revenue like the base) is taken off the doctor base.
-- With no channel row the term is 0 and the result is bit-for-bit the old one.
create or replace function clinic_finance.doctor_sync(p_invoice uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare a clinic_finance.doctor_allocations%rowtype;i clinic_finance.invoices%rowtype;refund numeric;adjustment numeric;revenue numeric;collected numeric;target numeric;delta numeric;event_id uuid;channel_share numeric;
begin
 select * into a from clinic_finance.doctor_allocations where invoice_id=p_invoice for update;if not found then return;end if;select * into i from clinic_finance.invoices where id=p_invoice;
 select coalesce(sum(amount),0) into refund from clinic_finance.requests where invoice_id=i.id and kind='refund' and status='approved';
 select coalesce(sum(x.amount),0) into adjustment from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id=x.claim_id where c.invoice_id=i.id and x.kind='contractual' and x.status='approved';
 select coalesce(sum(platform_share),0) into channel_share from clinic_finance.channel_allocations where invoice_id=i.id;
 revenue:=case when i.voided then 0 else greatest(0,i.amount-refund-adjustment) end;
 collected:=greatest(0,coalesce((select sum(amount) from clinic_finance.payments where invoice_id=i.id),0)-refund+coalesce((select sum(x.amount) from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id=x.claim_id where c.invoice_id=i.id and x.kind='payment' and x.status='approved'),0));
 target:=greatest(0,a.original_base*revenue/i.amount-a.original_deduction-channel_share*revenue/i.amount)*(a.terms->>'rate')::numeric/100;
 if a.terms->>'basis'='collected' then target:=case when revenue>0 then target*least(1,collected/revenue) else 0 end;end if;
 target:=round(target,2);delta:=target-a.earned;
 if delta<>0 then insert into clinic_finance.doctor_accruals(invoice_id,doctor_key,delta) values(i.id,a.doctor_key,delta) returning id into event_id;
 perform clinic_finance.post('doctor_accrual',event_id,'استحقاق أو تسوية أتعاب '||a.doctor_name||' — '||i.reference,null,case when delta>0 then '5111' else '2120' end,case when delta>0 then '2120' else '5111' end,abs(delta));update clinic_finance.doctor_allocations set earned=target where invoice_id=i.id;end if;
end $$;

-- Rule management. Same maker-checker shape as doctor contracts: creator cannot approve; approval needs a written reason; overlap with an active version of the same code is refused.
create function public.clinic_finance_channel_command(p_action text, p_payload jsonb, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; v_id uuid; r clinic_finance.channel_rules%rowtype; approval boolean; vers integer; d numeric; s numeric; codes text[];
begin
  perform pg_advisory_xact_lock(712241109);
  if p_action = 'create' then
    me := clinic_finance.require_access('create');
    select * into r from clinic_finance.channel_rules where created_by = me and token = p_token;
    if found then if r.payload is distinct from p_payload then raise exception 'مفتاح طلب مختلف'; end if; return r.id; end if;
    d := coalesce(nullif(p_payload->>'patient_discount_percent', '')::numeric, 0); s := coalesce(nullif(p_payload->>'platform_share_percent', '')::numeric, 0);
    if d::text in ('NaN', 'Infinity', '-Infinity') or s::text in ('NaN', 'Infinity', '-Infinity') or d < 0 or s < 0 or d + s > 100 then raise exception 'راجع نسبة خصم المريض ونسبة المنصة (المجموع لا يتجاوز 100%%)'; end if;
    select coalesce(array_agg(distinct lower(trim(x))), '{}') into codes from jsonb_array_elements_text(coalesce(p_payload->'source_codes', '[]')) x where length(trim(x)) > 0;
    select coalesce(max(version), 0) + 1 into vers from clinic_finance.channel_rules where code = p_payload->>'code';
    insert into clinic_finance.channel_rules(code, version, name, kind, applies_to, patient_discount_percent, platform_share_percent, payable_kind, payable_when, source_codes, valid_from, valid_to, notes, payload, created_by, token)
    values (trim(p_payload->>'code'), vers, trim(p_payload->>'name'), p_payload->>'kind', p_payload->>'applies_to', d, s, coalesce(nullif(p_payload->>'payable_kind', ''), 'none'), coalesce(trim(p_payload->>'payable_when'), ''), codes,
            (p_payload->>'valid_from')::date, (p_payload->>'valid_to')::date, coalesce(trim(p_payload->>'notes'), ''), p_payload, me, p_token) returning id into v_id;
  elsif p_action = 'review' then
    me := clinic_finance.require_access('review');
    select * into r from clinic_finance.channel_rules where id = (p_payload->>'id')::uuid for update;
    approval := (p_payload->>'approve')::boolean;
    if not found or r.created_by = me or r.status <> 'pending' or approval is null or length(trim(coalesce(p_payload->>'note', ''))) < 3 then raise exception 'القاعدة غير متاحة أو لا يمكنك اعتماد قاعدتك'; end if;
    if approval and exists (select 1 from clinic_finance.channel_rules where code = r.code and id <> r.id and status = 'active' and valid_from <= r.valid_to and valid_to >= r.valid_from) then
      raise exception 'فترة القاعدة تتداخل مع إصدار معتمد لنفس القناة؛ أنهِ القديم أو عدّل التواريخ';
    end if;
    update clinic_finance.channel_rules set status = case when approval then 'active' else 'rejected' end, reviewed_by = me, reviewed_at = now(), review_note = p_payload->>'note' where id = r.id; v_id := r.id;
  elsif p_action = 'retire' then
    me := clinic_finance.require_access('review');
    select * into r from clinic_finance.channel_rules where id = (p_payload->>'id')::uuid for update;
    if not found or r.status <> 'active' or length(trim(coalesce(p_payload->>'note', ''))) < 3 then raise exception 'اكتب سبب إنهاء قاعدة معتمدة'; end if;
    update clinic_finance.channel_rules set status = 'retired', review_note = coalesce(review_note, '') || ' / إنهاء: ' || (p_payload->>'note') where id = r.id; v_id := r.id;
  else
    raise exception 'إجراء غير معروف';
  end if;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'channel_' || p_action, v_id, jsonb_build_object('note', p_payload->>'note'));
  return v_id;
end $$;

-- The snapshot gains three keys. The previous public snapshot (the doctor wrapper) is moved, not copied: same technique as 20261017010341.
do $$ begin
  if to_regprocedure('clinic_finance.channels_snapshot_base(date,date,integer)') is null then
    alter function public.clinic_finance_snapshot(date, date, integer) set schema clinic_finance;
    alter function clinic_finance.clinic_finance_snapshot(date, date, integer) rename to channels_snapshot_base;
  end if;
end $$;
create or replace function public.clinic_finance_snapshot(p_from date, p_to date, p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb := clinic_finance.channels_snapshot_base(p_from, p_to, p_offset); me uuid := public.my_admin_id(); reviewer boolean := clinic_finance.allowed('review');
begin
  return v || jsonb_build_object(
    'channel_rules', (select coalesce(jsonb_agg(x), '[]') from (select to_jsonb(c) - 'payload' - 'token' x from clinic_finance.channel_rules c where reviewer or c.created_by = me or c.status = 'active' order by c.code, c.version desc limit 500) t),
    'channel_allocations', (select coalesce(jsonb_agg(x), '[]') from (select to_jsonb(a) - 'rule' || jsonb_build_object('invoice_reference', i.reference, 'invoice_amount', i.amount, 'voided', i.voided) x
        from clinic_finance.channel_allocations a join clinic_finance.invoices i on i.id = a.invoice_id
        where (reviewer or i.created_by = me) and (i.created_at at time zone 'Africa/Cairo')::date between p_from and p_to order by i.created_at desc, a.invoice_id desc limit 200 offset p_offset) t),
    'channel_payables', (select coalesce(jsonb_agg(x order by x->>'month' desc, x->>'channel_code'), '[]') from (
        select jsonb_build_object('channel_code', a.channel_code, 'channel_name', a.channel_name, 'kind', a.kind, 'payable_kind', a.payable_kind,
               'month', date_trunc('month', i.created_at at time zone 'Africa/Cairo')::date, 'invoices', count(*),
               'gross', sum(a.gross_consultation + a.gross_services), 'patient_discount', sum(a.patient_discount),
               'share_due', sum(round(a.platform_share * clinic_finance.invoice_revenue(i.id) / i.amount, 2))) x
        from clinic_finance.channel_allocations a join clinic_finance.invoices i on i.id = a.invoice_id
        where (i.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
        group by a.channel_code, a.channel_name, a.kind, a.payable_kind, date_trunc('month', i.created_at at time zone 'Africa/Cairo')::date) t));
end $$;

revoke all on all functions in schema clinic_finance from public, anon, authenticated;
revoke all on function public.clinic_finance_channel_command(text, jsonb, uuid), public.clinic_finance_snapshot(date, date, integer) from public, anon;
grant execute on function public.clinic_finance_channel_command(text, jsonb, uuid), public.clinic_finance_snapshot(date, date, integer) to authenticated;

commit;
