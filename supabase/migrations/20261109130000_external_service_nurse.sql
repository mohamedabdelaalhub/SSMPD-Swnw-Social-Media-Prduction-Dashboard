-- «خدمة خارجية» (extra amount added to the patient bill) + nursing performer options (owner decisions 2026-11-09).
--
-- (1) EXTERNAL SERVICE. Invoice payload gains  external_service:true  and  external_extra:<amount>  (no list of external codes). The extra is ADDED to the patient's bill:
--     service 500 + extra 250 -> invoice amount 750, revenue 4110 +250 (Dr 1122 / Cr 4110, source 'invoice_external'). The payload (bill_payload) keeps both keys, and
--     clinic_finance.invoice_external(invoice_id, external_extra, performer_mode, nurse_key) records it, so rules can see it.
--     Doctors' fees are computed on the SERVICE lines (the extra is not part of a doctor's base); only a "nurse alone" invoice includes the extra in the base (owner: 20% of the amount COLLECTED).
-- (2) NURSE PERFORMER. Invoice payload gains  performer_mode: 'doctor' (default) | 'nurse_alone' | 'nurse_with_doctor'  and  nurse_key (HR code, e.g. EMP-000007).
--     The nurse's terms live in ordinary maker-checker CONTRACTS whose scope is a fixed pseudo-service (so no list of service codes is needed):
--       scope 'تمريض:وحده'     (percent, owner: 20%, basis collected, base_scope service, deduction none)  -> nurse alone: the nurse is the PRIMARY performer of the invoice;
--                               base = service + external extra, supplies/medications are excluded (base_scope service).
--       scope 'تمريض:مع طبيب'  (fixed 100)                                                                 -> nurse with a doctor: the nurse is an EXTRA performer (doctor_extra_*), ONE flat amount per
--                               invoice (never per line, never a percentage), added on top of the doctor's share (it does not reduce it). Needs the doctor's service_lines.
-- ADDITIVE: 1 new table, 1 new function, doctor_extra_sync re-created (same text + the once-per-invoice rule for nursing contracts), clinic_finance_bill wrapped (moved, not edited).
-- ORDER: after 20261108290000_doctor_fixed_fee.sql. Rollback: supabase/rollbacks/20261109130000_external_service_nurse.rollback.sql
begin;

do $$ declare d text; begin
  if not exists (select 1 from information_schema.columns where table_schema='clinic_finance' and table_name='doctor_contracts' and column_name='fee_kind')
     or to_regprocedure('clinic_finance.bill_before_fixed(jsonb,uuid)') is null or to_regprocedure('clinic_finance.doctor_extra_sync(uuid)') is null then
    raise exception 'طبّق ملف المبلغ الثابت (20261108290000_doctor_fixed_fee) أولًا';
  end if;
  if to_regclass('clinic_finance.invoice_external') is not null or to_regprocedure('clinic_finance.bill_before_external_service(jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل';
  end if;
  d := pg_get_functiondef('clinic_finance.doctor_extra_sync(uuid)'::regprocedure);
  if position('sum(least(k.fixed_amount, l.amount)) fixed' in d) = 0 or position('g.kind = ''fixed''' in d) = 0 then raise exception 'doctor_extra_sync ليست نسخة المبلغ الثابت المتوقعة؛ راجع الفرق قبل التطبيق'; end if;
  d := pg_get_functiondef('public.clinic_finance_bill(jsonb,uuid)'::regprocedure);
  if position('bill_before_fixed' in d) = 0 then raise exception 'clinic_finance_bill ليست نسخة المبلغ الثابت المتوقعة؛ راجع الفرق قبل التطبيق'; end if;
end $$;

create table clinic_finance.invoice_external (
  invoice_id uuid primary key references clinic_finance.invoices(id),
  external_extra numeric(14,2) not null default 0 check (external_extra >= 0),
  performer_mode text not null default 'doctor' check (performer_mode in ('doctor', 'nurse_alone', 'nurse_with_doctor')),
  nurse_key text,
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  check ((performer_mode = 'doctor' and nurse_key is null) or (performer_mode <> 'doctor' and length(btrim(coalesce(nurse_key, ''))) >= 2))
);
alter table clinic_finance.invoice_external enable row level security;
revoke all on clinic_finance.invoice_external from public, anon, authenticated;

-- extra performers: a nursing "with a doctor" contract pays its fixed amount ONCE per invoice (least(amount, sum of the lines)); every other fixed contract keeps the per-line rule.
create or replace function clinic_finance.doctor_extra_sync(p_invoice uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare x clinic_finance.doctor_extra_allocations%rowtype; i clinic_finance.invoices%rowtype; m record; g record; target numeric; delta numeric; event_id uuid;
begin
  select * into i from clinic_finance.invoices where id = p_invoice;
  select * into m from clinic_finance.doctor_invoice_money(p_invoice);
  for x in select * from clinic_finance.doctor_extra_allocations where invoice_id = p_invoice order by doctor_key for update loop
    target := 0;
    for g in
      select e.contract_id, max(k.fee_kind) kind, max((e.terms->>'rate')::numeric) rate,
             case when max(k.service_scope) like 'تمريض:%' then least(max(k.fixed_amount), sum(l.amount)) else sum(least(k.fixed_amount, l.amount)) end fixed,
             count(*) n, sum(l.amount) base, sum(e.line_deduction) ded
      from clinic_finance.doctor_extra_lines e join clinic_finance.doctor_allocation_lines l on l.invoice_id = e.invoice_id and l.line_no = e.line_no
           join clinic_finance.doctor_contracts k on k.id = e.contract_id
      where e.invoice_id = p_invoice and e.doctor_key = x.doctor_key group by e.contract_id
    loop
      if g.kind = 'fixed' then target := target + g.fixed * m.revenue / m.amount;   -- g.fixed = per-line sum of least(fixed amount, line price); nursing contracts: one amount per invoice
      else target := target + greatest(0, g.base * m.revenue / m.amount - g.ded) * g.rate / 100; end if;
    end loop;
    if x.basis = 'collected' then target := case when m.revenue > 0 then target * least(1, m.collected / m.revenue) else 0 end; end if;
    target := round(target, 2); delta := target - x.earned;
    if delta <> 0 then
      insert into clinic_finance.doctor_accruals(invoice_id, doctor_key, delta) values (p_invoice, x.doctor_key, delta) returning id into event_id;
      perform clinic_finance.post('doctor_accrual', event_id, 'استحقاق أو تسوية أتعاب '||x.doctor_name||' — '||i.reference, null, case when delta > 0 then '5111' else '2120' end, case when delta > 0 then '2120' else '5111' end, abs(delta));
      update clinic_finance.doctor_extra_allocations set earned = target where invoice_id = p_invoice and doctor_key = x.doctor_key;
    end if;
  end loop;
end $$;

-- ===== bill wrapper =====
alter function public.clinic_finance_bill(jsonb, uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_bill(jsonb, uuid) rename to bill_before_external_service;
create function public.clinic_finance_bill(p_payload jsonb, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_mode text; v_ext boolean := false; v_extra numeric := 0; v_nurse text; v_id uuid; p jsonb := p_payload; c clinic_finance.doctor_contracts%rowtype; n integer;
        a clinic_finance.doctor_allocations%rowtype; l record; v_rows integer; v_me uuid; inv clinic_finance.invoices%rowtype; v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  v_mode := nullif(btrim(coalesce(p_payload->>'performer_mode', '')), '');
  if p_payload ? 'external_service' and jsonb_typeof(p_payload->'external_service') not in ('boolean', 'null') then raise exception 'خيار الخدمة الخارجية غير صالح'; end if;
  v_ext := coalesce((p_payload->'external_service') = 'true'::jsonb, false);
  if p_payload ? 'external_extra' and jsonb_typeof(p_payload->'external_extra') <> 'null' then
    if jsonb_typeof(p_payload->'external_extra') <> 'number' then raise exception 'المبلغ الإضافي للخدمة الخارجية يجب أن يكون رقمًا'; end if;
    v_extra := (p_payload->>'external_extra')::numeric;
    if v_extra <= 0 or v_extra > 1000000 or v_extra <> round(v_extra, 2) then raise exception 'المبلغ الإضافي للخدمة الخارجية غير صالح (أكبر من صفر، جنيه وقرشان)'; end if;
    if not v_ext then raise exception 'فعّل خيار الخدمة الخارجية لإضافة مبلغ إضافي'; end if;
  elsif v_ext then raise exception 'اكتب المبلغ الإضافي للخدمة الخارجية'; end if;
  if v_mode is not null and v_mode not in ('doctor', 'nurse_alone', 'nurse_with_doctor') then raise exception 'نوع المنفّذ غير معروف'; end if;
  if v_mode = 'doctor' then v_mode := null; end if;
  v_nurse := nullif(btrim(coalesce(p_payload->>'nurse_key', '')), '');
  if v_mode is null and v_extra = 0 then
    if v_nurse is not null then raise exception 'كود الممرض بدون اختيار ممرض وحده أو مع طبيب'; end if;
    return clinic_finance.bill_before_external_service(p_payload, p_token);
  end if;
  v_me := public.my_admin_id();
  -- replay of the same token: the stored invoice already carries everything (the stored payload differs from the sent one only by the contract id we resolved)
  select * into inv from clinic_finance.invoices where created_by = v_me and token = p_token;
  if found then
    if exists (select 1 from clinic_finance.invoice_external where invoice_id = inv.id) and (inv.bill_payload - 'doctor_contract_id') is not distinct from (p_payload - 'doctor_contract_id') then return inv.id; end if;
    raise exception 'مفتاح الطلب مستخدم لعملية مختلفة';
  end if;
  if v_mode is not null then
    if v_nurse is null or length(v_nurse) < 2 then raise exception 'حدد كود الممرض'; end if;
    if p_payload ? 'extra_performers' and jsonb_typeof(p_payload->'extra_performers') <> 'null' then raise exception 'اختيار الممرض يغني عن المشاركين في الأداء'; end if;
  elsif v_nurse is not null then raise exception 'كود الممرض بدون اختيار ممرض وحده أو مع طبيب';
  end if;
  if v_mode = 'nurse_alone' then
    if nullif(p_payload->>'doctor_contract_id', '') is not null or (p_payload->'service_lines') is not null and jsonb_typeof(p_payload->'service_lines') <> 'null'
       or nullif(btrim(coalesce(p_payload->>'doctor_key', '')), '') is not null then
      raise exception 'ممرض وحده: لا تختر طبيبًا ولا عقدًا ولا سطور خدمات؛ العقد يُحدَّد من عقد التمريض';
    end if;
    select count(*) into n from clinic_finance.doctor_contracts k where k.doctor_key = v_nurse and k.service_scope = 'تمريض:وحده' and k.status = 'active' and v_today between k.valid_from and k.valid_to;
    if n = 0 then raise exception 'لا يوجد عقد تمريض (ممرض وحده) معتمد وساري للكود %', v_nurse; end if;
    if n > 1 then raise exception 'يوجد أكثر من عقد تمريض (ممرض وحده) ساري للكود %', v_nurse; end if;
    select * into c from clinic_finance.doctor_contracts k where k.doctor_key = v_nurse and k.service_scope = 'تمريض:وحده' and k.status = 'active' and v_today between k.valid_from and k.valid_to;
    if c.base_scope <> 'service' then raise exception 'عقد التمريض (ممرض وحده) يجب أن يكون على الخدمة دون المستلزمات'; end if;
    if c.fee_kind <> 'percent' then raise exception 'عقد التمريض (ممرض وحده) يجب أن يكون نسبة'; end if;
    p := p_payload || jsonb_build_object('doctor_contract_id', c.id);
  elsif v_mode = 'nurse_with_doctor' then
    if nullif(btrim(coalesce(p_payload->>'doctor_key', '')), '') is null or p_payload->'service_lines' is null or jsonb_typeof(p_payload->'service_lines') <> 'array' then
      raise exception 'ممرض مع طبيب: حدد الطبيب ووزّع الخدمات على سطور (service_lines)';
    end if;
    if v_nurse = btrim(p_payload->>'doctor_key') then raise exception 'الممرض هو الطبيب الأساسي نفسه'; end if;
    if nullif(p_payload->>'channel_id', '') is not null then raise exception 'ممرض مع طبيب لا يُجمع مع قناة حجز'; end if;
    select count(*) into n from clinic_finance.doctor_contracts k where k.doctor_key = v_nurse and k.service_scope = 'تمريض:مع طبيب' and k.status = 'active' and v_today between k.valid_from and k.valid_to;
    if n = 0 then raise exception 'لا يوجد عقد تمريض (مع طبيب) معتمد وساري للكود %', v_nurse; end if;
    if n > 1 then raise exception 'يوجد أكثر من عقد تمريض (مع طبيب) ساري للكود %', v_nurse; end if;
    select * into c from clinic_finance.doctor_contracts k where k.doctor_key = v_nurse and k.service_scope = 'تمريض:مع طبيب' and k.status = 'active' and v_today between k.valid_from and k.valid_to;
    if c.fee_kind <> 'fixed' then raise exception 'عقد التمريض (مع طبيب) يجب أن يكون مبلغًا ثابتًا'; end if;
  end if;
  v_id := clinic_finance.bill_before_external_service(p, p_token);
  select * into inv from clinic_finance.invoices where id = v_id;
  if v_mode = 'nurse_alone' then
    -- the nurse's base is the service PLUS the external extra (owner: 20% of the amount collected, after supplies)
    update clinic_finance.doctor_allocations set original_base = original_base + v_extra where invoice_id = v_id;
  elsif v_mode = 'nurse_with_doctor' then
    select * into a from clinic_finance.doctor_allocations where invoice_id = v_id;
    if not found then raise exception 'لا يوجد طبيب أساسي للفاتورة'; end if;
    insert into clinic_finance.doctor_extra_allocations(invoice_id, doctor_key, doctor_name, basis) values (v_id, v_nurse, c.doctor_name, c.basis);
    for l in select line_no from clinic_finance.doctor_allocation_lines where invoice_id = v_id order by line_no loop
      insert into clinic_finance.doctor_extra_lines(invoice_id, doctor_key, line_no, contract_id, terms, line_deduction) values (v_id, v_nurse, l.line_no, c.id, to_jsonb(c), 0);
    end loop;
  end if;
  if v_extra > 0 then
    update clinic_finance.invoices set amount = amount + v_extra where id = v_id;
    perform clinic_finance.post('invoice_external', v_id, 'خدمة خارجية (مبلغ إضافي) '||inv.reference, null, '1122', '4110', v_extra);
  end if;
  insert into clinic_finance.invoice_external(invoice_id, external_extra, performer_mode, nurse_key, created_by) values (v_id, v_extra, coalesce(v_mode, 'doctor'), v_nurse, v_me);
  perform clinic_finance.doctor_sync(v_id);
  return v_id;
end $$;

-- the wrapper gets exactly the privileges of the function it wraps
do $$ declare r record;
begin
  if (select proacl is not null from pg_proc where oid = 'clinic_finance.bill_before_external_service(jsonb,uuid)'::regprocedure) then
    revoke all on function public.clinic_finance_bill(jsonb, uuid) from public, anon, authenticated, service_role;
    for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(p.proacl) a where p.oid = 'clinic_finance.bill_before_external_service(jsonb,uuid)'::regprocedure and a.grantee <> p.proowner loop
      execute format('grant %s on function public.clinic_finance_bill(jsonb, uuid) to %s', r.privilege_type, case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
    end loop;
  end if;
end $$;

create function public.clinic_finance_external_service_enabled() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$ select true $$;
revoke all on function public.clinic_finance_external_service_enabled() from public, anon;
grant execute on function public.clinic_finance_external_service_enabled() to authenticated;

commit;
