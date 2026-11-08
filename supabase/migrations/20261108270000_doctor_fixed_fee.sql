-- FIXED-AMOUNT doctor fees + a second performer on one invoice (owner request 2026-11-08: nursing 100 EGP per home visit; doctors who ask a fixed amount per outside visit).
--
-- (1) FIXED FEE. doctor_contracts gains fee_kind ('percent' default | 'fixed') and fixed_amount. A fixed contract has rate = 0 and deduction = 'none' (CHECK), so every reader of `rate` sees a harmless 0.
--     Accrual: ONE fixed amount per performed SERVICE LINE of the invoice that resolves to that contract (an invoice without service lines: one amount per invoice).
--     It follows exactly the percent rules for the money side: refund / contractual discount shrink it in proportion (revenue/invoice amount), a voided invoice earns 0, and on a 'collected'
--     contract it is scaled by min(1, collected/revenue). Percent contracts, invoices and ledger postings are byte-for-byte unchanged (invoices with NO fixed contract delegate to the previous doctor_sync).
--     The overlap check of contract review is unchanged (same doctor + same scope + overlapping dates), so a doctor may hold a percent contract on one service and a fixed one on another.
--     contract_revise works as before: the revision payload may switch kind (percent <-> fixed). The payload of a fixed request is stored as sent (with rate forced to 0) and a BEFORE INSERT trigger
--     copies fee_kind / fixed_amount from it, so the PRODUCTION command function and the revisions patch are NOT edited.
-- (2) SECOND PERFORMER (doctor + nurse on ONE home-visit invoice). doctor_allocations keeps its PK(invoice_id): the PRIMARY doctor is unchanged. Extra performers live in two NEW tables
--     (doctor_extra_allocations PK(invoice_id, doctor_key), doctor_extra_lines) and accrue through the SAME doctor_accruals / journal posting with their own doctor_key, so doctor_balance, payouts and the
--     statement (by accrual) work without change. Payload: bill {..., service_lines:[...], extra_performers:[{doctor_key:'EMP-000007'}]}. For every service line the extra performer's own contract
--     (exact service first, then department; same resolver as the primary) decides the fee; lines he has no contract for earn him nothing; at least one line must match.
--     Not combined with a booking channel (the platform share is a doctor-consultation notion) and the returned-stock deduction applies to the primary only.
-- (3) GUARDS. A fixed contract cannot carry a lab/external cost or the first_payment mode (nothing to deduct from a fixed amount); a reception order agreement (clinic_reception.doctor_agreements)
--     cannot be linked to a fixed contract (that path copies the percent); doctor_held_fees (payout cap) and the statement line display learn about fixed fees / extra performers when those objects exist.
-- ADDITIVE: 2 columns + 1 CHECK on doctor_contracts (existing rows = 'percent', unchanged), 2 new tables, new functions, wrappers over bill / doctor_sync / clinic_finance_doctor_command (moved, not edited).
-- ORDER: after 20261108260000_dental_external_cost.sql and 20261108240000_contract_revisions.sql. Rollback: supabase/rollbacks/20261108270000_doctor_fixed_fee.rollback.sql
begin;

do $$ declare d text; begin
  if to_regprocedure('clinic_finance.doctor_sync_lines(uuid)') is null or to_regprocedure('clinic_finance.bill_before_external(jsonb,uuid)') is null then
    raise exception 'طبّق ملف التكلفة الخارجية (20261108260000_dental_external_cost) أولًا';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='clinic_finance' and table_name='doctor_contracts' and column_name='supersedes') then
    raise exception 'طبّق ملف تعديل العقود (20261108240000) أولًا';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='clinic_finance' and table_name='doctor_contracts' and column_name='fee_kind')
     or to_regprocedure('clinic_finance.bill_before_fixed(jsonb,uuid)') is not null or to_regprocedure('clinic_finance.doctor_sync_pre_fixed(uuid)') is not null
     or to_regprocedure('clinic_finance.doctor_command_before_fixed(text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل';
  end if;
  d := pg_get_functiondef('clinic_finance.doctor_sync(uuid)'::regprocedure);
  if position('doctor_sync_lines' in d) = 0 or position('first_payment' in d) = 0 then raise exception 'doctor_sync ليست نسخة التكلفة الخارجية المتوقعة؛ راجع الفرق قبل التطبيق'; end if;
  d := pg_get_functiondef('public.clinic_finance_bill(jsonb,uuid)'::regprocedure);
  if position('bill_before_external' in d) = 0 then raise exception 'clinic_finance_bill ليست نسخة التكلفة الخارجية المتوقعة؛ راجع الفرق قبل التطبيق'; end if;
  if to_regprocedure('public.clinic_finance_doctor_command(text,jsonb,uuid)') is null or to_regprocedure('clinic_finance.doctor_contract_for_service(text,text,text,text,date)') is null then
    raise exception 'clinic_finance_doctor_command أو doctor_contract_for_service غير موجودة';
  end if;
  d := pg_get_functiondef('public.clinic_finance_doctor_command(text,jsonb,uuid)'::regprocedure);
  if position('doctor_command_before' in d) = 0 then raise exception 'clinic_finance_doctor_command ليست نسخة الأقسام/الصرف المتوقعة؛ راجع الفرق قبل التطبيق'; end if;
end $$;

-- ===== (1) contracts =====
alter table clinic_finance.doctor_contracts
  add column fee_kind text not null default 'percent' check (fee_kind in ('percent', 'fixed')),
  add column fixed_amount numeric(12,2);
alter table clinic_finance.doctor_contracts
  add constraint doctor_contracts_fee_ck check ((fee_kind = 'percent' and fixed_amount is null) or (fee_kind = 'fixed' and fixed_amount > 0 and rate = 0 and deduction = 'none'));

create function clinic_finance.contract_fee_from_payload() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.payload->>'fee_kind' = 'fixed' then
    new.fee_kind := 'fixed';
    new.fixed_amount := round((new.payload->>'fixed_amount')::numeric, 2);
  end if;
  return new;
end $$;
revoke all on function clinic_finance.contract_fee_from_payload() from public, anon, authenticated, service_role;
create trigger doctor_contracts_fee_from_payload before insert on clinic_finance.doctor_contracts for each row execute function clinic_finance.contract_fee_from_payload();

-- the command: validate the fixed request, force rate 0, delegate everything else untouched
alter function public.clinic_finance_doctor_command(text, jsonb, uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_doctor_command(text, jsonb, uuid) rename to doctor_command_before_fixed;
create function public.clinic_finance_doctor_command(p_action text, p_payload jsonb, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare k text; amt numeric;
begin
  if p_action in ('contract', 'contract_batch', 'contract_revise') and jsonb_typeof(p_payload) = 'object' then
    k := coalesce(nullif(btrim(p_payload->>'fee_kind'), ''), 'percent');
    if k not in ('percent', 'fixed') then raise exception 'نوع الأتعاب غير معروف'; end if;
    if k = 'fixed' then
      if nullif(btrim(p_payload->>'fixed_amount'), '') is null then raise exception 'اكتب المبلغ الثابت'; end if;
      amt := (p_payload->>'fixed_amount')::numeric;
      if amt::text in ('NaN', 'Infinity', '-Infinity') or amt <= 0 or amt > 100000 or amt <> round(amt, 2) then raise exception 'المبلغ الثابت غير صالح (أكبر من صفر وحتى 100000 بكسرين عشريين)'; end if;
      if coalesce(p_payload->>'deduction', 'none') <> 'none' then raise exception 'العقد بمبلغ ثابت لا يخصم مستلزمات'; end if;
      p_payload := p_payload || jsonb_build_object('rate', 0, 'fee_kind', 'fixed', 'fixed_amount', amt);
    elsif nullif(btrim(coalesce(p_payload->>'fixed_amount', '')), '') is not null then
      raise exception 'المبلغ الثابت يُكتب مع نوع الأتعاب «مبلغ ثابت» فقط';
    end if;
  end if;
  return clinic_finance.doctor_command_before_fixed(p_action, p_payload, p_token);
end $$;

-- ===== helper: money of an invoice (same arithmetic as doctor_sync) =====
create function clinic_finance.doctor_invoice_money(p_invoice uuid, out amount numeric, out revenue numeric, out collected numeric) language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare i clinic_finance.invoices%rowtype; refund numeric; adjustment numeric;
begin
  select * into i from clinic_finance.invoices where id = p_invoice;
  select coalesce(sum(x.amount), 0) into refund from clinic_finance.requests x where x.invoice_id = i.id and x.kind = 'refund' and x.status = 'approved';
  select coalesce(sum(x.amount), 0) into adjustment from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id = x.claim_id where c.invoice_id = i.id and x.kind = 'contractual' and x.status = 'approved';
  amount := i.amount;
  revenue := case when i.voided then 0 else greatest(0, i.amount - refund - adjustment) end;
  collected := greatest(0, coalesce((select sum(p.amount) from clinic_finance.payments p where p.invoice_id = i.id), 0) - refund
    + coalesce((select sum(x.amount) from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id = x.claim_id where c.invoice_id = i.id and x.kind = 'payment' and x.status = 'approved'), 0));
end $$;

-- ===== (2) extra performers =====
create table clinic_finance.doctor_extra_allocations (
  invoice_id uuid not null references clinic_finance.doctor_allocations(invoice_id),
  doctor_key text not null check (length(btrim(doctor_key)) >= 2),
  doctor_name text not null,
  basis text not null check (basis in ('performed', 'collected')),
  original_deduction numeric(14,2) not null default 0 check (original_deduction >= 0),
  earned numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  primary key (invoice_id, doctor_key)
);
create table clinic_finance.doctor_extra_lines (
  invoice_id uuid not null,
  doctor_key text not null,
  line_no integer not null,
  contract_id uuid not null references clinic_finance.doctor_contracts(id),
  terms jsonb not null,
  line_deduction numeric(18,8) not null default 0 check (line_deduction >= 0),
  primary key (invoice_id, doctor_key, line_no),
  foreign key (invoice_id, doctor_key) references clinic_finance.doctor_extra_allocations(invoice_id, doctor_key),
  foreign key (invoice_id, line_no) references clinic_finance.doctor_allocation_lines(invoice_id, line_no)
);
create index doctor_extra_alloc_key on clinic_finance.doctor_extra_allocations (doctor_key);
alter table clinic_finance.doctor_extra_allocations enable row level security;
alter table clinic_finance.doctor_extra_lines enable row level security;
revoke all on clinic_finance.doctor_extra_allocations, clinic_finance.doctor_extra_lines from public, anon, authenticated;

-- accrual of the EXTRA performers of one invoice (same posting as the primary: 5111 / 2120 on the delta)
create function clinic_finance.doctor_extra_sync(p_invoice uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare x clinic_finance.doctor_extra_allocations%rowtype; i clinic_finance.invoices%rowtype; m record; g record; target numeric; delta numeric; event_id uuid;
begin
  select * into i from clinic_finance.invoices where id = p_invoice;
  select * into m from clinic_finance.doctor_invoice_money(p_invoice);
  for x in select * from clinic_finance.doctor_extra_allocations where invoice_id = p_invoice order by doctor_key for update loop
    target := 0;
    for g in
      select e.contract_id, max(k.fee_kind) kind, max((e.terms->>'rate')::numeric) rate, max(k.fixed_amount) fixed,
             count(*) n, sum(l.amount) base, sum(e.line_deduction) ded
      from clinic_finance.doctor_extra_lines e join clinic_finance.doctor_allocation_lines l on l.invoice_id = e.invoice_id and l.line_no = e.line_no
           join clinic_finance.doctor_contracts k on k.id = e.contract_id
      where e.invoice_id = p_invoice and e.doctor_key = x.doctor_key group by e.contract_id
    loop
      if g.kind = 'fixed' then target := target + g.fixed * g.n * m.revenue / m.amount;
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

-- ===== (1) accrual of the PRIMARY doctor when a fixed contract is involved =====
create function clinic_finance.doctor_sync_fixed(p_invoice uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare a clinic_finance.doctor_allocations%rowtype; i clinic_finance.invoices%rowtype; m record; target numeric := 0; delta numeric; event_id uuid; channel_share numeric := 0; g record;
begin
  select * into a from clinic_finance.doctor_allocations where invoice_id = p_invoice for update; if not found then return; end if;
  select * into i from clinic_finance.invoices where id = p_invoice;
  select * into m from clinic_finance.doctor_invoice_money(p_invoice);
  if to_regclass('clinic_finance.channel_allocations') is not null then
    execute 'select coalesce(sum(platform_share),0) from clinic_finance.channel_allocations where invoice_id=$1' into channel_share using i.id;
  end if;
  if exists (select 1 from clinic_finance.doctor_allocation_lines where invoice_id = p_invoice) then
    -- per contract: the percent formula of doctor_sync_lines, or (fixed) amount x number of lines of that contract x revenue/invoice amount
    for g in
      with l as (select x.*, k.fee_kind, k.fixed_amount, sum(x.amount) over () tot, sum(case when x.is_consultation then x.amount else 0 end) over () cons_tot
                 from clinic_finance.doctor_allocation_lines x join clinic_finance.doctor_contracts k on k.id = x.contract_id where x.invoice_id = p_invoice)
      select contract_id, max(fee_kind) kind, max((terms->>'rate')::numeric) rate, max(fixed_amount) fixed, count(*) n, sum(amount) base, sum(line_deduction) ded,
             channel_share * case when max(cons_tot) > 0 then sum(case when is_consultation then amount else 0 end) / max(cons_tot) else sum(amount) / max(tot) end ch
      from l group by contract_id
    loop
      if g.kind = 'fixed' then target := target + g.fixed * g.n * m.revenue / m.amount;
      else target := target + greatest(0, g.base * m.revenue / m.amount
          - greatest(0, g.ded - case when a.original_deduction > 0 then a.returned_deduction * g.ded / a.original_deduction else 0 end)
          - g.ch * m.revenue / m.amount) * g.rate / 100; end if;
    end loop;
  else
    target := (select k.fixed_amount from clinic_finance.doctor_contracts k where k.id = a.contract_id) * m.revenue / m.amount;   -- invoice without lines: one fixed amount per invoice
  end if;
  if a.terms->>'basis' = 'collected' then target := case when m.revenue > 0 then target * least(1, m.collected / m.revenue) else 0 end; end if;
  target := round(target, 2); delta := target - a.earned;
  if delta <> 0 then
    insert into clinic_finance.doctor_accruals(invoice_id, doctor_key, delta) values (i.id, a.doctor_key, delta) returning id into event_id;
    perform clinic_finance.post('doctor_accrual', event_id, 'استحقاق أو تسوية أتعاب '||a.doctor_name||' — '||i.reference, null, case when delta > 0 then '5111' else '2120' end, case when delta > 0 then '2120' else '5111' end, abs(delta));
    update clinic_finance.doctor_allocations set earned = target where invoice_id = i.id;
  end if;
end $$;

alter function clinic_finance.doctor_sync(uuid) rename to doctor_sync_pre_fixed;
create function clinic_finance.doctor_sync(p_invoice uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  -- fee kind is read from the CONTRACT row (by id), never from the terms snapshot: a session that compiled the older bill function before this migration snapshots contracts without the new columns
  if exists (select 1 from clinic_finance.doctor_allocation_lines l join clinic_finance.doctor_contracts k on k.id = l.contract_id where l.invoice_id = p_invoice and k.fee_kind = 'fixed')
     or exists (select 1 from clinic_finance.doctor_allocations a join clinic_finance.doctor_contracts k on k.id = a.contract_id where a.invoice_id = p_invoice and k.fee_kind = 'fixed'
                and not exists (select 1 from clinic_finance.doctor_allocation_lines l where l.invoice_id = a.invoice_id)) then
    perform clinic_finance.doctor_sync_fixed(p_invoice);
  else
    perform clinic_finance.doctor_sync_pre_fixed(p_invoice);
  end if;
  if exists (select 1 from clinic_finance.doctor_extra_allocations where invoice_id = p_invoice) then perform clinic_finance.doctor_extra_sync(p_invoice); end if;
end $$;

-- ===== bill: extra performers + guards on fixed lines =====
alter function public.clinic_finance_bill(jsonb, uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_bill(jsonb, uuid) rename to bill_before_fixed;
create function public.clinic_finance_bill(p_payload jsonb, p_token uuid) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_x jsonb; a clinic_finance.doctor_allocations%rowtype; e record; l record; c clinic_finance.doctor_contracts%rowtype; v_key text; v_cnt integer; v_sales numeric; v_cost numeric; v_total numeric;
        v_ded numeric; v_basis text; v_name text; v_n integer; v_keys text[] := '{}'; v_today date := (now() at time zone 'Africa/Cairo')::date; v_rows integer;
begin
  v_x := p_payload->'extra_performers';
  if v_x is null or jsonb_typeof(v_x) = 'null' then
    v_id := clinic_finance.bill_before_fixed(p_payload, p_token);
  else
    if jsonb_typeof(v_x) <> 'array' or jsonb_array_length(v_x) not between 1 and 3 then raise exception 'المشاركون في الأداء يجب أن يكونوا قائمة من 1 إلى 3'; end if;
    if p_payload->'service_lines' is null or jsonb_typeof(p_payload->'service_lines') <> 'array' then raise exception 'المشاركون في الأداء يحتاجون توزيع الخدمات على سطور (service_lines)'; end if;
    v_id := clinic_finance.bill_before_fixed(p_payload, p_token);
    if exists (select 1 from clinic_finance.doctor_extra_allocations where invoice_id = v_id) then return v_id; end if;   -- same token replayed
    select * into a from clinic_finance.doctor_allocations where invoice_id = v_id;
    if not found then raise exception 'لا يوجد طبيب أساسي للفاتورة'; end if;
    if to_regclass('clinic_finance.channel_allocations') is not null then
      execute 'select count(*) from clinic_finance.channel_allocations where invoice_id = $1' into v_rows using v_id;
      if v_rows > 0 then raise exception 'المشاركون في الأداء لا يُجمعون مع قناة حجز'; end if;
    end if;
    select coalesce(sum(round(quantity*sale_price,2)),0), coalesce(sum(cost_total),0) into v_sales, v_cost from clinic_finance.bill_items where invoice_id = v_id;
    select sum(amount) into v_total from clinic_finance.doctor_allocation_lines where invoice_id = v_id;
    for e in select x.value v, x.ordinality n from jsonb_array_elements(v_x) with ordinality x loop
      if jsonb_typeof(e.v) <> 'object' then raise exception 'بيانات المشارك % غير صالحة', e.n; end if;
      v_key := btrim(coalesce(e.v->>'doctor_key', ''));
      if length(v_key) < 2 then raise exception 'حدد كود المشارك %', e.n; end if;
      if v_key = a.doctor_key then raise exception 'المشارك % هو الطبيب الأساسي نفسه', v_key; end if;
      if v_key = any(v_keys) then raise exception 'المشارك % مكرر', v_key; end if;
      v_keys := v_keys || v_key; v_n := 0; v_basis := null;
      for l in select * from clinic_finance.doctor_allocation_lines where invoice_id = v_id order by line_no loop
        select count(*) into v_cnt from clinic_finance.doctor_contract_for_service(v_key, l.service_code, l.service_name, l.department, v_today);
        if v_cnt = 0 then continue; end if;
        if v_cnt > 1 then raise exception 'يوجد أكثر من عقد معتمد للمشارك % للخدمة %؛ حدد عقدًا واحدًا', v_key, l.service_code; end if;
        select * into c from clinic_finance.doctor_contract_for_service(v_key, l.service_code, l.service_name, l.department, v_today) limit 1;
        if c.base_scope <> 'service' then raise exception 'عقد المشارك % للخدمة % يجب أن يكون على الخدمة دون المستلزمات', v_key, l.service_code; end if;
        if v_basis is null then v_basis := c.basis; elsif v_basis <> c.basis then raise exception 'عقود المشارك % يجب أن تتفق في أساس الاستحقاق', v_key; end if;
        if v_n = 0 then
          v_name := c.doctor_name;
          insert into clinic_finance.doctor_extra_allocations(invoice_id, doctor_key, doctor_name, basis) values (v_id, v_key, c.doctor_name, c.basis);
        end if;
        v_ded := case c.deduction when 'cost' then v_cost * l.amount / v_total when 'sale' then v_sales * l.amount / v_total else 0 end;
        insert into clinic_finance.doctor_extra_lines(invoice_id, doctor_key, line_no, contract_id, terms, line_deduction) values (v_id, v_key, l.line_no, c.id, to_jsonb(c), v_ded);
        v_n := v_n + 1;
      end loop;
      if v_n = 0 then raise exception 'لا يوجد عقد معتمد للمشارك % لأي من خدمات الفاتورة', v_key; end if;
      update clinic_finance.doctor_extra_allocations set original_deduction = round((select sum(line_deduction) from clinic_finance.doctor_extra_lines where invoice_id = v_id and doctor_key = v_key), 2) where invoice_id = v_id and doctor_key = v_key;
    end loop;
    perform clinic_finance.doctor_sync(v_id);
  end if;
  -- a fixed amount has nothing to deduct a lab / external cost from, and the first-payment mode is for a percent over the collected money
  if exists (select 1 from clinic_finance.doctor_allocation_lines dl join clinic_finance.doctor_contracts k on k.id = dl.contract_id where dl.invoice_id = v_id and k.fee_kind = 'fixed' and (dl.external_cost > 0 or dl.external_mode <> 'prorata')) then
    raise exception 'عقد المبلغ الثابت لا يقبل تكلفة معمل/خارجية ولا خصم الدفعة الأولى';
  end if;
  return v_id;
end $$;

-- ===== guards / readers of the other modules (only when those objects exist) =====
do $mig$
declare f text; o text;
begin
  -- reception order agreements copy the PERCENT of a contract: refuse to link one to a fixed contract
  if to_regclass('clinic_reception.doctor_agreements') is not null then
    execute $f$create function clinic_reception.refuse_fixed_contract_link() returns trigger language plpgsql set search_path = pg_catalog, public as $t$
      begin
        if new.finance_contract_id is not null and exists (select 1 from clinic_finance.doctor_contracts c where c.id = new.finance_contract_id and c.fee_kind = 'fixed') then
          raise exception 'عقد المبلغ الثابت يُحسب من فاتورة الحسابات بسطور الخدمات، ولا يُربط باتفاقية أوردر الاستقبال';
        end if;
        return new;
      end $t$$f$;
    execute 'create trigger doctor_agreements_refuse_fixed before insert or update of finance_contract_id on clinic_reception.doctor_agreements for each row execute function clinic_reception.refuse_fixed_contract_link()';
  end if;
  -- statement: show the fixed amount instead of a 0% rate
  if to_regprocedure('clinic_finance.doctor_statement(text,date,date)') is not null then
    f := pg_get_functiondef('clinic_finance.doctor_statement(text,date,date)'::regprocedure);
    o := '''rate'', (l.terms->>''rate'')::numeric,';
    if (length(f) - length(replace(f, o, ''))) = length(o)
       and (length(f) - length(replace(f, '''fee_estimate'', round(greatest(0, l.amount - coalesce(l.line_deduction, 0)) * coalesce((l.terms->>''rate'')::numeric, 0) / 100, 2)', ''))) = length('''fee_estimate'', round(greatest(0, l.amount - coalesce(l.line_deduction, 0)) * coalesce((l.terms->>''rate'')::numeric, 0) / 100, 2)') then
      f := replace(f, o, o || ' ''fee_kind'', (select c.fee_kind from clinic_finance.doctor_contracts c where c.id = l.contract_id), ''fixed_amount'', (select c.fixed_amount from clinic_finance.doctor_contracts c where c.id = l.contract_id),');
      f := replace(f, '''fee_estimate'', round(greatest(0, l.amount - coalesce(l.line_deduction, 0)) * coalesce((l.terms->>''rate'')::numeric, 0) / 100, 2)',
        '''fee_estimate'', case when (select c.fee_kind from clinic_finance.doctor_contracts c where c.id = l.contract_id) = ''fixed'' then round((select c.fixed_amount from clinic_finance.doctor_contracts c where c.id = l.contract_id), 2) else round(greatest(0, l.amount - coalesce(l.line_deduction, 0)) * coalesce((l.terms->>''rate'')::numeric, 0) / 100, 2) end');
      execute f;
    else
      raise exception 'doctor_statement تغيّرت عن النص المتوقع؛ راجع الفرق قبل التطبيق';
    end if;
  end if;
  -- payout cap (phase 2): fees of extra performers on unpaid invoices are held like the primary's
  if to_regprocedure('clinic_finance.doctor_held_fees(text)') is not null then
    f := pg_get_functiondef('clinic_finance.doctor_held_fees(text)'::regprocedure);
    if position('from clinic_finance.doctor_allocations a' in f) = 0 or position('invoice_fully_paid' in f) = 0 then raise exception 'doctor_held_fees تغيّرت عن النص المتوقع؛ راجع الفرق قبل التطبيق'; end if;
    execute $q$create or replace function clinic_finance.doctor_held_fees(p_key text) returns numeric language sql stable security definer set search_path = pg_catalog, public as $b$
      select coalesce((select sum(a.earned) from clinic_finance.doctor_allocations a where a.doctor_key = p_key and a.earned > 0 and not clinic_finance.invoice_fully_paid(a.invoice_id)), 0)
           + coalesce((select sum(x.earned) from clinic_finance.doctor_extra_allocations x where x.doctor_key = p_key and x.earned > 0 and not clinic_finance.invoice_fully_paid(x.invoice_id)), 0)
    $b$$q$;
  end if;
end $mig$;

-- the new wrappers get exactly the privileges of the functions they wrap
do $$ declare r record; w record;
begin
 for w in select * from (values ('public.clinic_finance_bill(jsonb,uuid)', 'clinic_finance.bill_before_fixed(jsonb,uuid)'), ('clinic_finance.doctor_sync(uuid)', 'clinic_finance.doctor_sync_pre_fixed(uuid)'), ('public.clinic_finance_doctor_command(text,jsonb,uuid)', 'clinic_finance.doctor_command_before_fixed(text,jsonb,uuid)')) t(f, b) loop
  if (select proacl is not null from pg_proc where oid = w.b::regprocedure) then
   execute format('revoke all on function %s from public, anon, authenticated, service_role', w.f);
   for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(p.proacl) a where p.oid = w.b::regprocedure and a.grantee <> p.proowner loop
    execute format('grant %s on function %s to %s', r.privilege_type, w.f, case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
   end loop;
  end if;
 end loop;
end $$;
revoke all on function clinic_finance.doctor_extra_sync(uuid), clinic_finance.doctor_sync_fixed(uuid), clinic_finance.doctor_invoice_money(uuid) from public, anon, authenticated, service_role;

create function public.clinic_finance_fixed_fee_enabled() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$ select true $$;
revoke all on function public.clinic_finance_fixed_fee_enabled() from public, anon;
grant execute on function public.clinic_finance_fixed_fee_enabled() to authenticated;

commit;
