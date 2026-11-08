-- Dental contracts: an OPTIONAL external cost (e.g. the dental-lab invoice) per service line, subtracted from the line's base BEFORE the doctor's rate.
--   implants:  fee = rate * (amount - lab invoice)         (rate 30%)
--   ortho:     basis 'collected': fee = rate * (total - lab) * collected/total  (the lab is spread pro-rata over the payments; see docs/DENTAL-EXTERNAL-COST.md)
-- The lab is an external invoice, not a stock item, so contract.deduction='cost' (bill_items cost) cannot express it. This adds the smallest ADDITIVE hook:
--   * 2 new columns on the NEW table clinic_finance.doctor_allocation_lines (external_cost, external_ref). Nothing else existing is altered.
--   * public.clinic_finance_bill is moved to clinic_finance.bill_before_external and wrapped. Without `external_cost` on any service line it delegates unchanged.
--   * with it: the line's line_deduction grows by external_cost, the allocation's original_deduction is re-summed, doctor_sync is re-run.
--   * doctor_sync is NOT touched: it already subtracts SUM(line_deduction) per contract before the rate (floored at 0), for 'performed' and, proportionally to collected/revenue, for 'collected'.
-- external_cost is stored apart (external_cost) so reports can tell it from stock cost; external_ref (the lab invoice number) is mandatory when external_cost > 0.
-- ORTHODONTICS (owner decision): optional `external_mode:'first_payment'` on the single service line of an invoice whose contract is basis 'collected':
--   cumulative fee = rate * max(0, collected - lab), i.e. the lab cost is taken from the FIRST payment(s) and every later installment earns the full rate (capped at rate*(revenue-lab)).
--   The first payment must cover the lab cost: clinic_finance_collect refuses a first payment smaller than external_cost (message tells the cashier). No accrual special-casing for the shortfall.
--   doctor_sync is wrapped once more (only invoices with a first_payment line take the new branch; everything else delegates unchanged).
-- ORDER: after 20261108231000_doctor_service_lines.sql. Rollback: supabase/rollbacks/20261108260000_dental_external_cost.rollback.sql
begin;

do $$ declare d text; begin
  if to_regclass('clinic_finance.doctor_allocation_lines') is null or to_regprocedure('clinic_finance.bill_before_lines(jsonb,uuid)') is null then
    raise exception 'طبّق ملف توزيع الخدمات على السطور (20261108231000) أولًا';
  end if;
  if to_regprocedure('clinic_finance.bill_before_external(jsonb,uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema='clinic_finance' and table_name='doctor_allocation_lines' and column_name='external_cost') then
    raise exception 'تم تطبيق هذا الملف من قبل';
  end if;
  if to_regprocedure('public.clinic_finance_bill(jsonb,uuid)') is null or to_regprocedure('clinic_finance.doctor_sync(uuid)') is null then
    raise exception 'clinic_finance_bill أو doctor_sync غير موجودة';
  end if;
  d := pg_get_functiondef('public.clinic_finance_bill(jsonb,uuid)'::regprocedure);
  -- exact text of the wrapper created by 20261108231000, or (formatting-proof) a function that is that wrapper
  if md5(d) <> '868947f84f36c618fe684ffab9d5bb90' and not (position('bill_before_lines' in d) > 0 and position('doctor_allocation_lines' in d) > 0 and position('multi_rate' in d) > 0) then
    raise exception 'clinic_finance_bill ليست نسخة توزيع السطور المدقَّقة؛ راجع الفرق قبل التطبيق';
  end if;
  if to_regprocedure('public.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid)') is null or to_regprocedure('clinic_finance.doctor_sync_lines(uuid)') is not null then
    raise exception 'clinic_finance_collect غير موجودة أو doctor_sync_lines موجودة من قبل';
  end if;
  d := pg_get_functiondef('clinic_finance.doctor_sync(uuid)'::regprocedure);
  if position('doctor_allocation_lines' in d) = 0 or position('line_deduction' in d) = 0 or position('doctor_sync_base' in d) = 0 then
    raise exception 'doctor_sync ليست نسخة توزيع السطور (لا تخصم line_deduction)';
  end if;
end $$;

alter table clinic_finance.doctor_allocation_lines
  add column external_cost numeric(14,2) not null default 0,
  add column external_ref text,
  add column external_mode text not null default 'prorata' check (external_mode in ('prorata','first_payment'));
alter table clinic_finance.doctor_allocation_lines
  add constraint doctor_allocation_lines_external_cost_ck check (external_cost >= 0 and external_cost <= amount),
  add constraint doctor_allocation_lines_external_ref_ck check (external_cost = 0 or length(btrim(coalesce(external_ref, ''))) >= 3);

alter function public.clinic_finance_bill(jsonb, uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_bill(jsonb, uuid) rename to bill_before_external;
create function public.clinic_finance_bill(p_payload jsonb, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_lines jsonb; r record; v_id uuid; v_e numeric; v_ref text; v_any boolean := false; v_sum numeric; v_rows integer; v_mode text; v_fp boolean := false;
begin
 v_lines := p_payload->'service_lines';
 -- no per-line external cost anywhere: behave exactly like the wrapped function
 if v_lines is null or jsonb_typeof(v_lines) <> 'array'
    or not exists (select 1 from jsonb_array_elements(v_lines) x where jsonb_typeof(x) = 'object' and ((x ? 'external_cost' and jsonb_typeof(x->'external_cost') <> 'null') or (x ? 'external_mode' and jsonb_typeof(x->'external_mode') <> 'null'))) then
  if p_payload ? 'external_cost' and jsonb_typeof(p_payload->'external_cost') <> 'null' then raise exception 'التكلفة الخارجية تُسجَّل على سطر خدمة داخل service_lines'; end if;
  return clinic_finance.bill_before_external(p_payload, p_token);
 end if;
 for r in select x.value v, x.ordinality n from jsonb_array_elements(v_lines) with ordinality x where jsonb_typeof(x.value) = 'object' loop
  if r.v ? 'external_cost' and jsonb_typeof(r.v->'external_cost') <> 'null' then
   if nullif(btrim(r.v->>'external_cost'), '') is null then raise exception 'التكلفة الخارجية في السطر % فارغة', r.n; end if;
   v_e := (r.v->>'external_cost')::numeric;
   if v_e::text in ('NaN', 'Infinity', '-Infinity') or v_e < 0 or v_e <> round(v_e, 2) then raise exception 'التكلفة الخارجية في السطر % غير صالحة', r.n; end if;
   if v_e > 0 and length(btrim(coalesce(r.v->>'external_ref', ''))) < 3 then raise exception 'اكتب رقم فاتورة المعمل أو مرجعها للسطر % (3 أحرف على الأقل)', r.n; end if;
   if nullif(r.v->>'amount', '') is not null and v_e > (r.v->>'amount')::numeric then raise exception 'التكلفة الخارجية في السطر % أكبر من قيمة السطر', r.n; end if;
  end if;
  v_mode := coalesce(nullif(btrim(r.v->>'external_mode'), ''), 'prorata');
  if v_mode not in ('prorata', 'first_payment') then raise exception 'نمط التكلفة الخارجية في السطر % غير معروف', r.n; end if;
  if v_mode = 'first_payment' then
   v_fp := true;
   if jsonb_array_length(v_lines) <> 1 then raise exception 'خصم المعمل من الدفعة الأولى يُستخدم في فاتورة بسطر خدمة واحد'; end if;
   if coalesce((r.v->>'external_cost')::numeric, 0) <= 0 then raise exception 'خصم المعمل من الدفعة الأولى يحتاج تكلفة معمل أكبر من صفر'; end if;
  end if;
 end loop;
 v_id := clinic_finance.bill_before_external(p_payload, p_token);
 for r in select x.value v, x.ordinality n from jsonb_array_elements(v_lines) with ordinality x where jsonb_typeof(x.value) = 'object' loop
  v_e := coalesce(nullif(r.v->>'external_cost', '')::numeric, 0);
  v_ref := case when v_e > 0 then btrim(r.v->>'external_ref') else null end;
  -- absolute (not additive) so a replay of the same token cannot double the deduction
  update clinic_finance.doctor_allocation_lines
     set line_deduction = line_deduction - external_cost + v_e, external_cost = v_e, external_ref = v_ref,
         external_mode = coalesce(nullif(btrim(r.v->>'external_mode'), ''), 'prorata')
   where invoice_id = v_id and line_no = r.n and (external_cost <> v_e or external_ref is distinct from v_ref or external_mode <> coalesce(nullif(btrim(r.v->>'external_mode'), ''), 'prorata'));
  get diagnostics v_rows = row_count;
  if v_rows > 0 then v_any := true; end if;
 end loop;
 if v_fp then
  if not exists (select 1 from clinic_finance.doctor_allocations where invoice_id = v_id and terms->>'basis' = 'collected') then raise exception 'خصم المعمل من الدفعة الأولى يحتاج عقدًا بأساس التحصيل'; end if;
  if to_regclass('clinic_finance.channel_allocations') is not null then
   execute 'select count(*) from clinic_finance.channel_allocations where invoice_id = $1' into v_rows using v_id;
   if v_rows > 0 then raise exception 'خصم المعمل من الدفعة الأولى لا يُجمع مع قناة حجز'; end if;
  end if;
 end if;
 if v_any then
  select coalesce(sum(line_deduction), 0) into v_sum from clinic_finance.doctor_allocation_lines where invoice_id = v_id;
  update clinic_finance.doctor_allocations set original_deduction = round(v_sum, 2) where invoice_id = v_id;
  perform clinic_finance.doctor_sync(v_id);
 end if;
 return v_id;
end $$;

-- ---- doctor_sync: first_payment invoices take the new branch; everything else delegates to the lines version.
alter function clinic_finance.doctor_sync(uuid) rename to doctor_sync_lines;
create function clinic_finance.doctor_sync(p_invoice uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare a clinic_finance.doctor_allocations%rowtype; i clinic_finance.invoices%rowtype; l clinic_finance.doctor_allocation_lines%rowtype; refund numeric; adjustment numeric; revenue numeric; collected numeric; target numeric; delta numeric; event_id uuid;
begin
 select * into l from clinic_finance.doctor_allocation_lines where invoice_id = p_invoice and external_mode = 'first_payment' limit 1;
 if not found then perform clinic_finance.doctor_sync_lines(p_invoice); return; end if;
 select * into a from clinic_finance.doctor_allocations where invoice_id=p_invoice for update; if not found then return; end if; select * into i from clinic_finance.invoices where id=p_invoice;
 select coalesce(sum(amount),0) into refund from clinic_finance.requests where invoice_id=i.id and kind='refund' and status='approved';
 select coalesce(sum(x.amount),0) into adjustment from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id=x.claim_id where c.invoice_id=i.id and x.kind='contractual' and x.status='approved';
 revenue:=case when i.voided then 0 else greatest(0,i.amount-refund-adjustment) end;
 collected:=greatest(0,coalesce((select sum(amount) from clinic_finance.payments where invoice_id=i.id),0)-refund+coalesce((select sum(x.amount) from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id=x.claim_id where c.invoice_id=i.id and x.kind='payment' and x.status='approved'),0));
 -- the lab is taken from the first money collected; later money earns the full rate; never more than the rate on (revenue - lab)
 target:=round(least(greatest(0, collected - l.external_cost), greatest(0, revenue - l.external_cost)) * (l.terms->>'rate')::numeric / 100, 2);
 delta:=target-a.earned;
 if delta<>0 then insert into clinic_finance.doctor_accruals(invoice_id,doctor_key,delta) values(i.id,a.doctor_key,delta) returning id into event_id;
 perform clinic_finance.post('doctor_accrual',event_id,'استحقاق أو تسوية أتعاب '||a.doctor_name||' — '||i.reference,null,case when delta>0 then '5111' else '2120' end,case when delta>0 then '2120' else '5111' end,abs(delta)); update clinic_finance.doctor_allocations set earned=target where invoice_id=i.id; end if;
end $$;

-- ---- clinic_finance_collect: the first payment of a first_payment invoice must cover the lab cost.
alter function public.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid) rename to collect_before_external;
create function public.clinic_finance_collect(p_invoice uuid,p_shift uuid,p_method text,p_amount numeric,p_reference text,p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_lab numeric;
begin
 select external_cost into v_lab from clinic_finance.doctor_allocation_lines where invoice_id = p_invoice and external_mode = 'first_payment' limit 1;
 if v_lab is not null and not exists (select 1 from clinic_finance.payments where invoice_id = p_invoice) and p_amount < v_lab then
  raise exception 'الدفعة الأولى (%) أقل من تكلفة المعمل (%)؛ يجب أن تغطي الدفعة الأولى تكلفة المعمل', p_amount, v_lab;
 end if;
 return clinic_finance.collect_before_external(p_invoice,p_shift,p_method,p_amount,p_reference,p_token);
end $$;

-- exactly the privileges of the wrapped functions (see 20261108231000)
do $$ declare r record; w record;
begin
 for w in select * from (values ('public.clinic_finance_bill(jsonb,uuid)', 'clinic_finance.bill_before_external(jsonb,uuid)'), ('clinic_finance.doctor_sync(uuid)', 'clinic_finance.doctor_sync_lines(uuid)'), ('public.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid)', 'clinic_finance.collect_before_external(uuid,uuid,text,numeric,text,uuid)')) t(f, b) loop
  if (select proacl is not null from pg_proc where oid = w.b::regprocedure) then
   execute format('revoke all on function %s from public, anon, authenticated, service_role', w.f);
   for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(p.proacl) a where p.oid = w.b::regprocedure and a.grantee <> p.proowner loop
    execute format('grant %s on function %s to %s', r.privilege_type, w.f, case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
   end loop;
  end if;
 end loop;
end $$;

create function public.clinic_finance_external_cost_enabled() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$ select true $$;
revoke all on function public.clinic_finance_external_cost_enabled() from public, anon;
grant execute on function public.clinic_finance_external_cost_enabled() to authenticated;

commit;
