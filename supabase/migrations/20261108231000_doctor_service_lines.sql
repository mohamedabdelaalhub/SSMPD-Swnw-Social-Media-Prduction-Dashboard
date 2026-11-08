-- Per-service-line doctor fee allocation: one invoice can carry SEVERAL services for the same doctor, each paid at the rate of the contract that applies to THAT service
-- (exact service contract first, then the department contract; same doctor, active, inside its dates). The invoice's doctor fee is the sum of the lines' shares.
--
-- WHY A NEW TABLE: until now an invoice stored one total (clinic_finance.invoices.amount) and ONE doctor contract (doctor_allocations.contract_id, one rate for the whole invoice).
-- No per-service detail was kept, so a 30% service and a 40% service on one invoice could not both be honoured. This migration adds the minimal additive store: doctor_allocation_lines.
--
-- ADDITIVE and rollback-safe:
--   * 1 new table (clinic_finance.doctor_allocation_lines); no column added to an existing table.
--   * public.clinic_finance_bill is moved to clinic_finance.bill_before_lines and wrapped. Without `service_lines` in the payload it delegates unchanged (byte-identical behaviour).
--   * clinic_finance.doctor_sync is moved to clinic_finance.doctor_sync_base and wrapped. An invoice with no lines delegates to the base function untouched, so every existing invoice,
--     refund, returned_deduction and channel_share case computes exactly as before. Only invoices that HAVE lines use the per-line formula below.
-- ORDER: apply AFTER 20261108230000_department_contracts.sql and, if it is going to be applied, AFTER 20261108130000_channels_discounts_p1.sql (the wrapper wraps whatever doctor_sync exists;
--   applying channels afterwards would replace the wrapper and its guard would refuse to run on it).
-- BEFORE ANY ROLLBACK snapshot doctor_allocations (earned) and doctor_allocation_lines: after a rollback the invoices that were split by lines are recomputed with the single first-line contract.
-- Rollback: supabase/rollbacks/20261108231000_doctor_service_lines.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_finance.doctor_contract_for_service(text,text,text,text,date)') is null then
    raise exception 'طبّق ملف عقود الأقسام (20261108230000) أولًا';
  end if;
  if to_regprocedure('clinic_finance.doctor_sync(uuid)') is null
     or to_regprocedure('clinic_finance.doctor_sync_base(uuid)') is not null
     or to_regprocedure('clinic_finance.bill_before_lines(jsonb,uuid)') is not null then
    raise exception 'doctor_sync غير موجودة أو تم تطبيق هذا الملف من قبل';
  end if;
  -- exact production text (md5 of pg_get_functiondef), or doctor_sync as replaced by the channels migration (20261108130000: has the channel_share term and the channel tables)
  if md5(pg_get_functiondef('clinic_finance.doctor_sync(uuid)'::regprocedure)) <> 'e0d8058554453f61b8e2c11a0839e98c'
     and not (to_regclass('clinic_finance.channel_allocations') is not null
              and position('channel_share' in pg_get_functiondef('clinic_finance.doctor_sync(uuid)'::regprocedure)) > 0
              and position('a.original_base*revenue/i.amount' in pg_get_functiondef('clinic_finance.doctor_sync(uuid)'::regprocedure)) > 0
              and position('a.returned_deduction' in pg_get_functiondef('clinic_finance.doctor_sync(uuid)'::regprocedure)) > 0) then
    raise exception 'doctor_sync ليست نسخة الإنتاج المدقَّقة ولا نسخة القنوات؛ راجع الفرق قبل التطبيق';
  end if;
  if to_regprocedure('public.clinic_finance_bill(jsonb,uuid)') is null or to_regprocedure('clinic_finance.doctor_bill_base(jsonb,uuid)') is null then
    raise exception 'سلسلة فاتورة الأطباء غير مكتملة (clinic_finance_bill / doctor_bill_base)';
  end if;
  if md5(pg_get_functiondef('public.clinic_finance_bill(jsonb,uuid)'::regprocedure)) <> 'a8aeb2de4795afda4424863bf9170352'
     or md5(pg_get_functiondef('clinic_finance.doctor_bill_base(jsonb,uuid)'::regprocedure)) <> '2661fea092b3a191e0099e5b4f2745b9' then
    raise exception 'clinic_finance_bill أو doctor_bill_base ليست نسخة الإنتاج المدقَّقة؛ راجع الفرق قبل التطبيق';
  end if;
  if to_regclass('clinic_reception.services') is null then raise exception 'جدول خدمات الاستقبال غير موجود'; end if;
end $$;

create table clinic_finance.doctor_allocation_lines (
  invoice_id uuid not null references clinic_finance.doctor_allocations(invoice_id),
  line_no integer not null check (line_no > 0),
  service_code text not null check (length(service_code) between 1 and 120),
  service_name text,
  department text,
  is_consultation boolean not null default false,
  amount numeric(14,2) not null check (amount > 0),
  contract_id uuid not null references clinic_finance.doctor_contracts(id),
  terms jsonb not null,
  line_deduction numeric(18,8) not null default 0 check (line_deduction >= 0),
  created_at timestamptz not null default now(),
  primary key (invoice_id, line_no)
);
create index doctor_allocation_lines_contract on clinic_finance.doctor_allocation_lines (contract_id);
alter table clinic_finance.doctor_allocation_lines enable row level security;
revoke all on clinic_finance.doctor_allocation_lines from public, anon, authenticated;

-- ---- doctor_sync: the existing function becomes the base; the wrapper only changes invoices that have service lines.
alter function clinic_finance.doctor_sync(uuid) rename to doctor_sync_base;
create function clinic_finance.doctor_sync(p_invoice uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare a clinic_finance.doctor_allocations%rowtype;i clinic_finance.invoices%rowtype;refund numeric;adjustment numeric;revenue numeric;collected numeric;target numeric;delta numeric;event_id uuid;channel_share numeric:=0;g record;
begin
 if not exists (select 1 from clinic_finance.doctor_allocation_lines where invoice_id = p_invoice) then
  perform clinic_finance.doctor_sync_base(p_invoice); return;
 end if;
 select * into a from clinic_finance.doctor_allocations where invoice_id=p_invoice for update;if not found then return;end if;select * into i from clinic_finance.invoices where id=p_invoice;
 select coalesce(sum(amount),0) into refund from clinic_finance.requests where invoice_id=i.id and kind='refund' and status='approved';
 select coalesce(sum(x.amount),0) into adjustment from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id=x.claim_id where c.invoice_id=i.id and x.kind='contractual' and x.status='approved';
 if to_regclass('clinic_finance.channel_allocations') is not null then
  execute 'select coalesce(sum(platform_share),0) from clinic_finance.channel_allocations where invoice_id=$1' into channel_share using i.id;
 end if;
 revenue:=case when i.voided then 0 else greatest(0,i.amount-refund-adjustment) end;
 collected:=greatest(0,coalesce((select sum(amount) from clinic_finance.payments where invoice_id=i.id),0)-refund+coalesce((select sum(x.amount) from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id=x.claim_id where c.invoice_id=i.id and x.kind='payment' and x.status='approved'),0));
 -- Per contract (= per rate): the SAME expression doctor_sync_base uses for one contract, applied to that contract's share of the invoice.
 -- The platform share goes to the consultation lines when there are any (it is a share of the consultation), otherwise it is spread over the lines by amount.
 target:=0;
 for g in
  with l as (select *, sum(amount) over () tot, sum(case when is_consultation then amount else 0 end) over () cons_tot from clinic_finance.doctor_allocation_lines where invoice_id=p_invoice)
  select contract_id, (max((terms->>'rate')::numeric)) rate, sum(amount) base, sum(line_deduction) ded,
         channel_share * case when max(cons_tot) > 0 then sum(case when is_consultation then amount else 0 end) / max(cons_tot) else sum(amount) / max(tot) end ch
  from l group by contract_id
 loop
  target:=target+greatest(0, g.base*revenue/i.amount
     - greatest(0, g.ded - case when a.original_deduction > 0 then a.returned_deduction * g.ded / a.original_deduction else 0 end)
     - g.ch*revenue/i.amount) * g.rate/100;
 end loop;
 if a.terms->>'basis'='collected' then target:=case when revenue>0 then target*least(1,collected/revenue) else 0 end;end if;
 target:=round(target,2);delta:=target-a.earned;
 if delta<>0 then insert into clinic_finance.doctor_accruals(invoice_id,doctor_key,delta) values(i.id,a.doctor_key,delta) returning id into event_id;
 perform clinic_finance.post('doctor_accrual',event_id,'استحقاق أو تسوية أتعاب '||a.doctor_name||' — '||i.reference,null,case when delta>0 then '5111' else '2120' end,case when delta>0 then '2120' else '5111' end,abs(delta));update clinic_finance.doctor_allocations set earned=target where invoice_id=i.id;end if;
end $$;

-- ---- clinic_finance_bill: the existing wrapper becomes the base; `service_lines` in the payload switches to the per-line allocation.
alter function public.clinic_finance_bill(jsonb, uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_bill(jsonb, uuid) rename to bill_before_lines;
create function public.clinic_finance_bill(p_payload jsonb, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; i clinic_finance.invoices%rowtype; c clinic_finance.doctor_contracts%rowtype; r record; v_doc text; v_lines jsonb; v_sales numeric; v_cost numeric; v_total numeric := 0; v_cnt integer;
        v_dep text; v_code text; v_amt numeric; v_basis text; v_ded numeric; v_tded numeric := 0; v_first boolean := true; v_dedkind text; v_cons numeric := 0; v_gc numeric; v_n integer := 0; v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
 if p_payload->'service_lines' is null or jsonb_typeof(p_payload->'service_lines') = 'null' then
  return clinic_finance.bill_before_lines(p_payload, p_token);
 end if;
 v_lines := p_payload->'service_lines';
 if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) not between 1 and 60 then raise exception 'سطور الخدمات يجب أن تكون قائمة من 1 إلى 60 سطرًا'; end if;
 v_doc := btrim(coalesce(p_payload->>'doctor_key', ''));
 if length(v_doc) < 2 then raise exception 'حدد الطبيب لتوزيع الخدمات على الفاتورة'; end if;
 if nullif(p_payload->>'doctor_contract_id', '') is not null then raise exception 'لا يمكن الجمع بين عقد واحد للفاتورة وتوزيع الخدمات على سطور'; end if;
 v_id := clinic_finance.bill_before_lines(p_payload, p_token);
 if exists (select 1 from clinic_finance.doctor_allocations where invoice_id = v_id) then return v_id; end if; -- same token replayed
 select * into i from clinic_finance.invoices where id = v_id;
 select coalesce(sum(round(quantity*sale_price,2)),0), coalesce(sum(cost_total),0) into v_sales, v_cost from clinic_finance.bill_items where invoice_id = v_id;
 -- pass 1: shape and total of the lines
 for r in select x.value v, x.ordinality n from jsonb_array_elements(v_lines) with ordinality x loop
  if jsonb_typeof(r.v) <> 'object' or length(btrim(coalesce(r.v->>'code', ''))) < 1 or nullif(r.v->>'amount', '') is null then raise exception 'السطر % يحتاج كود الخدمة وقيمتها', r.n; end if;
  v_amt := (r.v->>'amount')::numeric;
  if v_amt::text in ('NaN', 'Infinity', '-Infinity') or v_amt <= 0 or v_amt <> round(v_amt, 2) then raise exception 'قيمة السطر % غير صالحة', r.n; end if;
  v_total := v_total + v_amt;
 end loop;
 if v_total <> i.amount - v_sales then raise exception 'مجموع سطور الخدمات (%) يجب أن يساوي قيمة الخدمة دون المستلزمات (%)', v_total, i.amount - v_sales; end if;
 -- pass 2: resolve the contract of every line (exact service first, then department) and store the split
 for r in select x.value v, x.ordinality n from jsonb_array_elements(v_lines) with ordinality x loop
  v_code := btrim(r.v->>'code'); v_amt := (r.v->>'amount')::numeric;
  -- the department comes ONLY from the service catalog (a client-supplied department is ignored); an unknown service code is rejected
  if not exists (select 1 from clinic_reception.services s where s.code = v_code and s.active) then raise exception 'الخدمة % غير موجودة في كتالوج الخدمات؛ استخدم كود الخدمة', v_code; end if;
  v_dep := (select nullif(btrim(s.department), '') from clinic_reception.services s where s.code = v_code and s.active order by s.workspace_id limit 1);
  select count(*) into v_cnt from clinic_finance.doctor_contract_for_service(v_doc, v_code, nullif(btrim(coalesce(r.v->>'name', '')), ''), v_dep, v_today);
  if v_cnt = 0 then raise exception 'لا يوجد عقد معتمد للطبيب % للخدمة % (لا عقد خدمة ولا عقد قسم)', v_doc, v_code; end if;
  if v_cnt > 1 then raise exception 'يوجد أكثر من عقد معتمد للطبيب % للخدمة %؛ حدد عقدًا واحدًا', v_doc, v_code; end if;
  select * into c from clinic_finance.doctor_contract_for_service(v_doc, v_code, nullif(btrim(coalesce(r.v->>'name', '')), ''), v_dep, v_today) limit 1;
  if c.base_scope <> 'service' then raise exception 'عقد الخدمة % يجب أن يكون على الخدمة دون المستلزمات ليُستخدم في توزيع السطور', v_code; end if;
  if v_dedkind is null then v_dedkind := c.deduction; elsif v_dedkind <> c.deduction then raise exception 'عقود سطور الفاتورة يجب أن تتفق في نوع خصم المستلزمات'; end if;
  if v_basis is null then v_basis := c.basis; elsif v_basis <> c.basis then raise exception 'عقود سطور الفاتورة يجب أن تتفق في أساس الاستحقاق (عند التنفيذ أو حسب التحصيل)'; end if;
  v_ded := case c.deduction when 'cost' then v_cost * v_amt / v_total when 'sale' then v_sales * v_amt / v_total else 0 end;
  v_tded := v_tded + v_ded; v_n := v_n + 1;
  if (r.v->>'kind') = 'consultation' then v_cons := v_cons + v_amt; end if;
  if v_first then
   insert into clinic_finance.doctor_allocations(invoice_id, contract_id, doctor_key, doctor_name, terms, original_base, original_deduction)
   values (i.id, c.id, c.doctor_key, c.doctor_name, to_jsonb(c), v_total, 0);
   v_first := false;
  end if;
  insert into clinic_finance.doctor_allocation_lines(invoice_id, line_no, service_code, service_name, department, is_consultation, amount, contract_id, terms, line_deduction)
  values (i.id, r.n, v_code, nullif(btrim(coalesce(r.v->>'name', '')), ''), v_dep, coalesce((r.v->>'kind') = 'consultation', false), v_amt, c.id, to_jsonb(c), v_ded);
 end loop;
 -- when a channel applies, the lines flagged as consultation must add up to the consultation the channel was computed on
 if to_regclass('clinic_finance.channel_allocations') is not null then
  execute 'select gross_consultation from clinic_finance.channel_allocations where invoice_id = $1' into v_gc using i.id;
  if v_gc is not null and v_cons <> v_gc then raise exception 'مجموع سطور الكشف (%) يجب أن يساوي قيمة الكشف في القناة (%)', v_cons, v_gc; end if;
 end if;
 update clinic_finance.doctor_allocations set original_deduction = round(v_tded, 2), terms = terms || jsonb_build_object('multi_rate', true, 'line_count', v_n) where invoice_id = i.id;
 perform clinic_finance.doctor_sync(i.id);
 return v_id;
end $$;

-- The new wrappers get exactly the privileges of the functions they wrap (copied from the moved base functions), nothing broader.
-- (A base function with the default privileges leaves its wrapper with the default privileges too.)
do $$ declare r record; w record;
begin
 for w in select * from (values ('clinic_finance.doctor_sync(uuid)', 'clinic_finance.doctor_sync_base(uuid)'), ('public.clinic_finance_bill(jsonb,uuid)', 'clinic_finance.bill_before_lines(jsonb,uuid)')) t(f, b) loop
  if (select proacl is not null from pg_proc where oid = w.b::regprocedure) then
   -- Supabase's default privileges also grant new public functions to anon / authenticated / service_role: take everything away first, then give back exactly the base's grants
   execute format('revoke all on function %s from public, anon, authenticated, service_role', w.f);
   for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(p.proacl) a where p.oid = w.b::regprocedure and a.grantee <> p.proowner loop
    execute format('grant %s on function %s to %s', r.privilege_type, w.f, case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
   end loop;
  end if;
 end loop;
end $$;

-- Capability probe for the UI: it only shows the per-line block when this migration is deployed (otherwise the old bill would silently ignore service_lines).
create function public.clinic_finance_lines_enabled() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$ select true $$;
revoke all on function public.clinic_finance_lines_enabled() from public, anon;
grant execute on function public.clinic_finance_lines_enabled() to authenticated;

commit;
