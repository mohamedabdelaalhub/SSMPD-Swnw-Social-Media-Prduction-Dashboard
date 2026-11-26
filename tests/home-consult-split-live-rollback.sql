-- Live rollback dry-run for 20261126060000_home_consult_split.sql + supabase/ops/20261126_home_consult_split.sql (rule 9).
-- ONE transaction ending in ROLLBACK, run as postgres; nothing is kept. The migration body (without its own begin / commit) and the
-- ops APPLY blocks are pasted between the markers below — if the migration is already applied on live, delete the pasted migration
-- block first; if the ops were already committed, delete the pasted ops blocks (both are written to be safe to re-run otherwise).
-- Steps: ops APPLY 1+2 (nursing fee 150, «كشف منزلي (شامل الانتقال)» 1500 + split row) → APPLY 3 (pending 50% contracts as the
-- maker) → BEFORE approval Mazen's execute of a home consult is refused (no department-contract fallback) → the financial manager
-- (another admin) approves the doctor's contract → fixture as postgres: two home-consult visits for that doctor (one «ممرض/ة مع طبيب»
-- with a nurse who has a reception provider, one doctor alone), each at a free slot ≥ 10 min from his other bookings → Mazen
-- (reception, f0891d2c-…) executes both → invoice 1500, doctor fee 750, nurse 100 on her provider / none, center 650 / 750.
-- If Mazen has no open cash shift right now, the (unrelated, already live) shift guard is stubbed inside this transaction and the
-- output says so. Prints step / expected / actual / ok (names of patients are not printed).
begin;
-- transaction guard: SAVEPOINT fails outside an explicit begin … rollback block, and then nothing in this file runs
savepoint hc_live_guard;
select set_config('hc_live.in_txn', 'yes', true);
-- >>> migration supabase/migrations/20261126060000_home_consult_split.sql (body, without begin / commit) — delete if already applied >>>
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'appointments' and column_name = 'performer_mode')
     or not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'appointments' and column_name = 'nurse_admin_id') then
    raise exception 'طبّق 20261120220000_reception_booking_nurse_performer الأول';
  end if;
  if to_regprocedure('clinic_finance.desk_rx_fees(text)') is null or to_regprocedure('clinic_reception.post(uuid,text,uuid,text,text,text,numeric,jsonb)') is null
     or to_regclass('clinic_reception.doctor_agreements') is null or to_regclass('clinic_finance.doctor_contracts') is null then
    raise exception 'مكونات أتعاب الاستقبال / صرف الحساب غير موجودة';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'invoices' and column_name = 'credit_amount')
     or not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'orders' and column_name = 'agreement_id') then
    raise exception 'أعمدة الاستقبال المتوقعة (credit_amount / agreement_id) غير موجودة';
  end if;
end $$;

create table clinic_reception.home_visit_split (
  service_code text primary key check (length(btrim(service_code)) >= 2),
  nurse_fee numeric(12,2) not null check (nurse_fee > 0 and nurse_fee <= 100000),
  exact_contract boolean not null default true,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table clinic_reception.home_visit_split enable row level security;
revoke all on clinic_reception.home_visit_split from public, anon, authenticated;

create table clinic_reception.home_nurse_issues (
  order_id uuid primary key references clinic_reception.orders(id) on delete cascade,
  workspace_id uuid not null references clinic_reception.workspaces(id),
  reason text not null,
  detail text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table clinic_reception.home_nurse_issues enable row level security;
revoke all on clinic_reception.home_nurse_issues from public, anon, authenticated;

-- the nurse's reception provider: doctor_key = her HR doctor_key or HR code (clinic_people.people), active first
create function clinic_reception.home_nurse_provider(p_workspace uuid, p_admin uuid, out provider_id uuid, out nurse_key text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare k1 text; k2 text;
begin
  if p_admin is null or to_regclass('clinic_people.people') is null then return; end if;
  execute 'select nullif(btrim(doctor_key), ''''), nullif(btrim(code), '''') from clinic_people.people where admin_id = $1' into k1, k2 using p_admin;
  nurse_key := coalesce(k1, k2);
  select p.id, p.doctor_key into provider_id, nurse_key from clinic_reception.providers p
   where p.workspace_id = p_workspace and p.doctor_key is not null and p.doctor_key in (k1, k2)
   order by p.active desc, (p.doctor_key = k1) desc, p.id limit 1;
  if provider_id is null then nurse_key := coalesce(k1, k2); end if;
end $$;

-- money already booked for the nurse on one order (fee + adjustments)
create function clinic_reception.home_nurse_booked(p_order uuid, out original numeric, out current_fee numeric, out dims jsonb)
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(l.credit) filter (where j.source = 'home_nurse_fee'), 0), coalesce(sum(l.credit - l.debit), 0),
         (array_agg(j.dimensions) filter (where j.source = 'home_nurse_fee'))[1]
    from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
   where j.source in ('home_nurse_fee', 'home_nurse_adjust') and nullif(j.dimensions->>'order_id', '')::uuid = p_order
$$;

-- keeps the nurse fee equal to its share of what the patient / insurer really owes; 0 for a cancelled (voided) order
create function clinic_reception.home_nurse_sync(p_order uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; i clinic_reception.invoices%rowtype; b record; target numeric; cut numeric;
begin
  select * into o from clinic_reception.orders where id = p_order;
  if not found then return; end if;
  select * into b from clinic_reception.home_nurse_booked(p_order);
  if b.original <= 0 then return; end if;
  if o.status = 'cancelled' then target := 0;
  else
    select * into i from clinic_reception.invoices where order_id = p_order order by created_at limit 1;
    if not found or i.amount <= 0 then return; end if;
    cut := coalesce(i.credit_amount, 0) + coalesce((select c.contractual from clinic_reception.claims c where c.invoice_id = i.id), 0);
    target := round(b.original * greatest(0, 1 - cut / i.amount), 2);
  end if;
  if b.current_fee > target then
    perform clinic_reception.post(o.workspace_id, 'home_nurse_adjust', gen_random_uuid(), 'رد أتعاب ممرض/ة الزيارة المنزلية (إشعار دائن / خصم تعاقدي / إلغاء)', '2120', '5111', b.current_fee - target, b.dims);
  elsif b.current_fee < target then
    perform clinic_reception.post(o.workspace_id, 'home_nurse_adjust', gen_random_uuid(), 'إعادة أتعاب ممرض/ة الزيارة المنزلية بعد تعديل الإشعار', '5111', '2120', target - b.current_fee, b.dims);
  end if;
end $$;

-- posts the nurse fee of one completed order (idempotent); never raises: problems are kept in home_nurse_issues
create function clinic_reception.home_nurse_try(p_order uuid) returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; cfg clinic_reception.home_visit_split%rowtype; ap record; np record; inv uuid; pat uuid; amt numeric; why text;
begin
  select * into o from clinic_reception.orders where id = p_order;
  if not found or o.status <> 'completed' then return 'skip'; end if;
  select * into cfg from clinic_reception.home_visit_split where service_code = o.snapshot->>'code' and active;
  if not found then return 'none'; end if;
  begin
    select a.performer_mode, a.nurse_admin_id into ap from clinic_reception.visits v join clinic_reception.appointments a on a.id = v.appointment_id where v.id = o.visit_id;
    if ap.performer_mode is distinct from 'nurse_with_doctor' or ap.nurse_admin_id is null then return 'no_nurse'; end if;
    if exists (select 1 from clinic_reception.journal where workspace_id = o.workspace_id and source = 'home_nurse_fee' and source_id = o.id) then
      update clinic_reception.home_nurse_issues set resolved_at = coalesce(resolved_at, now()) where order_id = o.id; return 'done';
    end if;
    select * into np from clinic_reception.home_nurse_provider(o.workspace_id, ap.nurse_admin_id);
    if np.provider_id is not null and np.provider_id = o.provider_id then return 'self'; end if;
    select id, patient_id into inv, pat from clinic_reception.invoices where order_id = o.id order by created_at limit 1;
    amt := least(cfg.nurse_fee, greatest(0, coalesce(o.net_revenue, 0) - coalesce(o.doctor_fee, 0)));
    why := case when np.provider_id is null then 'missing_provider' when inv is null then 'missing_invoice' when amt <= 0 then 'nothing_left' end;
    if why is not null then
      insert into clinic_reception.home_nurse_issues(order_id, workspace_id, reason, detail) values (o.id, o.workspace_id, why, coalesce(np.nurse_key, ap.nurse_admin_id::text))
        on conflict (order_id) do update set reason = excluded.reason, detail = excluded.detail, resolved_at = null;
      return why;
    end if;
    perform clinic_reception.post(o.workspace_id, 'home_nurse_fee', o.id, 'أتعاب ممرض/ة مع الطبيب — ' || coalesce(o.snapshot->>'name', 'زيارة منزلية'), '5111', '2120', amt,
      jsonb_build_object('patient_id', pat, 'visit_id', o.visit_id, 'order_id', o.id, 'provider_id', np.provider_id, 'invoice_id', inv,
                         'home_nurse', true, 'nurse_admin_id', ap.nurse_admin_id, 'doctor_provider_id', o.provider_id));
    perform clinic_reception.home_nurse_sync(o.id);
    update clinic_reception.home_nurse_issues set resolved_at = now() where order_id = o.id;
    return 'posted';
  exception when others then
    insert into clinic_reception.home_nurse_issues(order_id, workspace_id, reason, detail) values (o.id, o.workspace_id, 'error', left(sqlerrm, 500))
      on conflict (order_id) do update set reason = 'error', detail = excluded.detail, resolved_at = null;
    return 'error';
  end;
end $$;

-- (2) a split service runs only on the doctor's EXACT-code contract (live): the agreement the execution picked must come from it
create function clinic_reception.home_split_contract_guard() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare scope text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and exists (select 1 from clinic_reception.home_visit_split s where s.service_code = new.snapshot->>'code' and s.active and s.exact_contract)
     and exists (select 1 from clinic_reception.workspaces w where w.id = new.workspace_id and w.mode = 'live') then
    select c.service_scope into scope from clinic_reception.doctor_agreements g join clinic_finance.doctor_contracts c on c.id = g.finance_contract_id where g.id = new.agreement_id;
    if scope is distinct from new.snapshot->>'code' then
      raise exception 'عقد «%» للطبيب ده لسه ما اتعتمدش في الحسابات (عقد بكود الخدمة نفسه، مش عقد القسم) — كلّم المدير المالي', coalesce(new.snapshot->>'name', new.snapshot->>'code')
        using hint = 'home_split_contract';
    end if;
  end if;
  return new;
end $$;
create trigger home_split_contract_guard before update of status on clinic_reception.orders for each row execute function clinic_reception.home_split_contract_guard();

create function clinic_reception.home_nurse_on_order() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then perform clinic_reception.home_nurse_try(new.id);
  elsif new.status = 'cancelled' and old.status = 'completed' then
    begin perform clinic_reception.home_nurse_sync(new.id);
    exception when others then
      insert into clinic_reception.home_nurse_issues(order_id, workspace_id, reason, detail) values (new.id, new.workspace_id, 'sync_error', left(sqlerrm, 500))
        on conflict (order_id) do update set reason = 'sync_error', detail = excluded.detail, resolved_at = null;
    end;
  end if;
  return new;
end $$;
create trigger home_nurse_on_order after update of status on clinic_reception.orders for each row execute function clinic_reception.home_nurse_on_order();

-- credit notes / contractual cuts keep the nurse fee proportional (never blocks the underlying operation)
create function clinic_reception.home_nurse_follow_cut() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare inv uuid := case when tg_table_name = 'claims' then (to_jsonb(new)->>'invoice_id')::uuid else (to_jsonb(new)->>'id')::uuid end; ord uuid; ws uuid;
begin
  select order_id, workspace_id into ord, ws from clinic_reception.invoices where id = inv;
  if ord is null or not exists (select 1 from clinic_reception.journal j where j.source = 'home_nurse_fee' and j.source_id = ord) then return new; end if;
  begin
    perform clinic_reception.home_nurse_sync(ord);
  exception when others then
    insert into clinic_reception.home_nurse_issues(order_id, workspace_id, reason, detail) values (ord, ws, 'sync_error', left(sqlerrm, 500))
      on conflict (order_id) do update set reason = 'sync_error', detail = excluded.detail, resolved_at = null;
  end;
  return new;
end $$;
create trigger home_nurse_follow_credit after update of credit_amount on clinic_reception.invoices for each row
  when (new.credit_amount is distinct from old.credit_amount) execute function clinic_reception.home_nurse_follow_cut();
create trigger home_nurse_follow_contractual after insert or update of contractual on clinic_reception.claims for each row execute function clinic_reception.home_nurse_follow_cut();

-- retry waiting nurse fees when a provider row appears / gets its doctor_key
create function clinic_reception.home_nurse_retry_provider() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare x record;
begin
  if new.doctor_key is null then return new; end if;
  for x in select q.order_id from clinic_reception.home_nurse_issues q where q.resolved_at is null and q.workspace_id = new.workspace_id and q.reason = 'missing_provider' and q.detail = new.doctor_key loop
    perform clinic_reception.home_nurse_try(x.order_id);
  end loop;
  return new;
end $$;
create trigger home_nurse_retry_provider after insert or update of doctor_key on clinic_reception.providers for each row execute function clinic_reception.home_nurse_retry_provider();

revoke all on function clinic_reception.home_nurse_provider(uuid, uuid), clinic_reception.home_nurse_booked(uuid), clinic_reception.home_nurse_sync(uuid),
  clinic_reception.home_nurse_try(uuid), clinic_reception.home_split_contract_guard(), clinic_reception.home_nurse_on_order(),
  clinic_reception.home_nurse_follow_cut(), clinic_reception.home_nurse_retry_provider() from public, anon, authenticated;
-- <<< end of migration body <<<
-- >>> ops APPLY 1+2 (supabase/ops/20261126_home_consult_split.sql) >>>
do $$
declare ws uuid; n int; keep public.pricing_services%rowtype; old_dept text; old_min integer; old_codes text[]; moved text; sid uuid; hc public.pricing_services%rowtype; v_code text; svc record;
begin
  if to_regclass('clinic_reception.home_visit_split') is null then raise exception 'apply migration 20261126060000_home_consult_split.sql first'; end if;
  select count(*) into n from clinic_reception.workspaces where mode = 'live';
  if n <> 1 then raise exception 'expected exactly 1 live reception workspace, found %', n; end if;
  select id into ws from clinic_reception.workspaces where mode = 'live';

  -- (1) nursing visit fee: exactly one active 150 row; every other row of that name must be a 200 row (retired here)
  select count(*) into n from public.pricing_services where btrim(name) = 'خدمة تمريض منزلي - رسوم الزيارة' and active and base_price = 150;
  if n <> 1 then raise exception 'expected exactly 1 active «خدمة تمريض منزلي - رسوم الزيارة» row at 150, found %', n; end if;
  select * into keep from public.pricing_services where btrim(name) = 'خدمة تمريض منزلي - رسوم الزيارة' and active and base_price = 150;
  if exists (select 1 from public.pricing_services where name like 'خدمة تمريض منزلي - رسوم الزيارة%' and id <> keep.id and base_price <> 200) then
    raise exception 'another «خدمة تمريض منزلي - رسوم الزيارة…» row is neither 150 nor 200 — review P1 first'; end if;
  select array_agg(distinct btrim(booking_code)) filter (where nullif(btrim(booking_code), '') is not null) into old_codes
    from public.pricing_services where name like 'خدمة تمريض منزلي - رسوم الزيارة%' and id <> keep.id;
  if coalesce(cardinality(old_codes), 0) > 1 then raise exception 'the 200 rows carry % booking codes (%) — decide which one stays', cardinality(old_codes), old_codes; end if;
  moved := old_codes[1];
  select booking_department, booking_minutes into old_dept, old_min from public.pricing_services
   where name like 'خدمة تمريض منزلي - رسوم الزيارة%' and id <> keep.id and nullif(btrim(booking_department), '') is not null order by booking_enabled desc, id limit 1;
  update public.pricing_services set active = false, booking_enabled = false,
         booking_code = case when nullif(btrim(keep.booking_code), '') is null then null else booking_code end
   where name like 'خدمة تمريض منزلي - رسوم الزيارة%' and id <> keep.id;
  get diagnostics n = row_count;
  raise notice 'nursing fee: retired % row(s); the 150 row % takes code %', n, keep.id,
    coalesce(nullif(btrim(keep.booking_code), ''), moved, keep.canonical_code);
  update public.pricing_services set booking_enabled = true,
         booking_code = coalesce(nullif(btrim(keep.booking_code), ''), moved, keep.canonical_code),
         booking_department = coalesce(nullif(btrim(keep.booking_department), ''), old_dept),
         booking_minutes = coalesce(keep.booking_minutes, old_min)
   where id = keep.id;

  -- (2) home doctor consult: exactly one SVC-0001396 row at 1500
  select count(*) into n from public.pricing_services where canonical_code = 'SVC-0001396';
  if n <> 1 then raise exception 'expected exactly 1 pricing row SVC-0001396, found %', n; end if;
  select * into hc from public.pricing_services where canonical_code = 'SVC-0001396';
  if hc.base_price <> 1500 then raise exception 'SVC-0001396 base_price is %, expected 1500', hc.base_price; end if;
  v_code := coalesce(nullif(btrim(hc.booking_code), ''), hc.canonical_code);
  if exists (select 1 from public.pricing_services where booking_code = v_code and id <> hc.id) then raise exception 'booking code % is used by another pricing row', v_code; end if;
  update public.pricing_services set name = 'كشف منزلي (شامل الانتقال)', active = true, booking_enabled = true, booking_code = v_code,
         booking_department = 'خدمات الكشف', booking_minutes = coalesce(booking_minutes, 60)
   where id = hc.id;

  perform clinic_reception.sync_catalog(ws);

  -- after-state checks (reception side)
  select count(*) into n from clinic_reception.services where workspace_id = ws and pricing_service_id = keep.id and active;
  if n <> 1 then raise exception 'nursing fee 150: % active reception services (expected 1); catalog issue: %', n,
    (select string_agg(detail, ' | ') from clinic_reception.catalog_issues where workspace_id = ws and source_id = keep.id); end if;
  select id, code, price into svc from clinic_reception.services where workspace_id = ws and pricing_service_id = keep.id and active;
  if svc.price <> 150 then raise exception 'nursing fee reception price is % (expected 150) — check price lists / margin', svc.price; end if;
  update clinic_reception.services set is_home = true where id = svc.id;
  if exists (select 1 from clinic_reception.services s join public.pricing_services x on x.id = s.pricing_service_id
              where s.workspace_id = ws and s.active and x.name like 'خدمة تمريض منزلي - رسوم الزيارة%' and x.id <> keep.id) then
    raise exception 'a 200 nursing fee service is still active in reception'; end if;
  raise notice 'nursing fee bookable: % at %', svc.code, svc.price;

  select count(*) into n from clinic_reception.services where workspace_id = ws and pricing_service_id = hc.id and active;
  if n <> 1 then raise exception 'home consult: % active reception services (expected 1); catalog issue: %', n,
    (select string_agg(detail, ' | ') from clinic_reception.catalog_issues where workspace_id = ws and source_id = hc.id); end if;
  select id, code, name, department, price into svc from clinic_reception.services where workspace_id = ws and pricing_service_id = hc.id and active;
  if svc.price <> 1500 then raise exception 'home consult reception price is % (expected 1500)', svc.price; end if;
  if not clinic_reception.is_basic_service(svc.department, svc.name) then raise exception 'the home consult is not a basic service'; end if;
  update clinic_reception.services set is_home = true where id = svc.id;
  insert into clinic_reception.home_visit_split(service_code, nurse_fee, note) values (svc.code, 100, 'قرار المالك 2026-11-26: كشف منزلي 1500 = الطبيب 750 + الممرض/ة 100 لو مع الطبيب + الباقي للمركز')
    on conflict (service_code) do update set nurse_fee = 100, active = true, exact_contract = true, note = excluded.note;
  raise notice 'home consult bookable: % «%» at % (is_home, basic, nurse 100)', svc.code, svc.name, svc.price;
end $$;
-- <<< end of ops APPLY 1+2 <<<
create temp table hc_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; ws uuid; svc record; doc record; nurse record; fm_uid uuid; pat uuid;
  slot timestamptz; ap1 uuid; ap2 uuid; v1 uuid; v2 uuid; o1 uuid; o2 uuid; r jsonb; err text; g jsonb; stubbed boolean := false; ids jsonb; n int; x record; nf numeric;
begin
  if current_setting('hc_live.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction';
  end if;
  select id into ws from clinic_reception.workspaces where mode = 'live';
  select id into me from public.admins where user_id = mazen;
  select s.id, s.code, s.name, s.department, s.price, s.is_home into svc from clinic_reception.services s
   where s.workspace_id = ws and s.active and s.pricing_service_id = (select id from public.pricing_services where canonical_code = 'SVC-0001396');
  insert into hc_live(step, expected, actual, ok) values ('home consult service', '«كشف منزلي (شامل الانتقال)» 1500, خدمات الكشف, is_home',
    coalesce(svc.code || ' «' || svc.name || '» ' || svc.price || ' ' || svc.department || ' home=' || svc.is_home, 'missing'),
    svc.price = 1500 and svc.department = 'خدمات الكشف' and svc.is_home and svc.name = 'كشف منزلي (شامل الانتقال)');
  select count(*) into n from clinic_reception.services s join public.pricing_services p on p.id = s.pricing_service_id
   where s.workspace_id = ws and s.active and p.name like 'خدمة تمريض منزلي - رسوم الزيارة%';
  select string_agg(s.code || ' ' || s.price, ', ') into err from clinic_reception.services s join public.pricing_services p on p.id = s.pricing_service_id
   where s.workspace_id = ws and s.active and p.name like 'خدمة تمريض منزلي - رسوم الزيارة%';
  insert into hc_live(step, expected, actual, ok) values ('nursing visit fee', 'exactly one active, 150', coalesce(err, 'none'), n = 1 and err like '% 150.00');
  insert into hc_live(step, expected, actual, ok) values ('split row', 'nurse_fee 100 on the home consult code',
    coalesce((select service_code || ' ' || nurse_fee from clinic_reception.home_visit_split where service_code = svc.code), 'missing'),
    exists (select 1 from clinic_reception.home_visit_split where service_code = svc.code and nurse_fee = 100 and active));
end $$;
-- >>> ops APPLY 3 >>>
do $$
declare maker uuid := '3e1f9a1f-7789-4cf0-a756-93caa6d9cc73'; maker_uid uuid; v_code text; d record; n int := 0; skipped int := 0; v uuid;
  v_from date := (now() at time zone 'Africa/Cairo')::date; v_to date := date '2027-12-31';
begin
  select user_id into maker_uid from public.admins where id = maker and active;
  if maker_uid is null then raise exception 'maker admin % not found / inactive / no login', maker; end if;
  select booking_code into v_code from public.pricing_services where canonical_code = 'SVC-0001396' and booking_enabled and active;
  if v_code is null then raise exception 'run APPLY 1+2 first (SVC-0001396 is not bookable yet)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', maker_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', maker_uid::text, true);
  for d in
    with live as (select id from clinic_reception.workspaces where mode = 'live'),
    nurse_keys as (
      select k from (select nullif(btrim(pp.doctor_key), '') k, pp.admin_id from clinic_people.people pp union all select nullif(btrim(pp.code), ''), pp.admin_id from clinic_people.people pp) x
       where k is not null and clinic_reception.is_nurse(x.admin_id)
      union select doctor_key from clinic_finance.doctor_contracts where service_scope like 'تمريض:%' and status in ('pending', 'active'))
    select p.doctor_key, min(p.name) doctor_name
      from clinic_reception.providers p join live on live.id = p.workspace_id
     where p.active and nullif(btrim(p.doctor_key), '') is not null and p.department !~ 'تمريض' and p.doctor_key not in (select k from nurse_keys)
     group by p.doctor_key order by min(p.name)
  loop
    if exists (select 1 from clinic_finance.doctor_contracts k where k.doctor_key = d.doctor_key and k.service_scope = v_code and k.status in ('pending', 'active')
                and k.valid_from <= v_to and k.valid_to >= v_from) then
      skipped := skipped + 1; raise notice 'skip % (already has a pending/active contract on %)', d.doctor_name, v_code; continue;
    end if;
    v := public.clinic_finance_doctor_command('contract_batch', jsonb_build_object(
           'doctor_key', d.doctor_key, 'doctor_name', d.doctor_name, 'scopes', jsonb_build_array(v_code),
           'from', v_from, 'to', v_to, 'rate', 50, 'basis', 'performed', 'base_scope', 'service', 'deduction', 'none',
           'refund_policy', 'proportional_revenue', 'reference', 'قرار المالك 2026-11-26 — كشف منزلي 1500: الطبيب 750 (50%)'),
         md5('home-consult-50|' || d.doctor_key)::uuid);
    n := n + 1;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'home consult contracts: % pending created, % skipped', n, skipped;
end $$;
-- <<< end of ops APPLY 3 <<<
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; ws uuid; svc record; doc record; nurse record; fm uuid; fm_uid uuid; pat uuid;
  slot timestamptz; ap1 uuid; ap2 uuid; v1 uuid; v2 uuid; o1 uuid; o2 uuid; r jsonb; err text; g jsonb; stubbed boolean := false; ids jsonb; n int; x record; nf numeric; cid uuid;
begin
  if current_setting('hc_live.in_txn', true) is distinct from 'yes' then raise exception 'NOT inside begin … rollback'; end if;
  select id into ws from clinic_reception.workspaces where mode = 'live';
  select id into me from public.admins where user_id = mazen;
  select s.id, s.code, s.name, s.department, s.price into svc from clinic_reception.services s
   where s.workspace_id = ws and s.active and s.pricing_service_id = (select id from public.pricing_services where canonical_code = 'SVC-0001396');
  select count(*) into n from clinic_finance.doctor_contracts where service_scope = svc.code and status = 'pending' and rate = 50;
  insert into hc_live(step, expected, actual, ok) values ('APPLY 3 pending contracts', '≥ 1 pending 50% contract on the code', n::text, n >= 1);
  -- the doctor: the active provider (with a pending 50% contract) with the most completed orders in the last 90 days
  select p.id provider_id, p.doctor_key, p.name, k.id contract_id into doc from clinic_reception.providers p
    join clinic_finance.doctor_contracts k on k.doctor_key = p.doctor_key and k.service_scope = svc.code and k.status = 'pending'
   where p.workspace_id = ws and p.active
   order by (select count(*) from clinic_reception.orders o where o.provider_id = p.id and o.status = 'completed' and o.completed_at > now() - interval '90 days') desc, p.name
   limit 1;
  insert into hc_live(step, expected, actual, ok) values ('fixture doctor', 'an active doctor provider with a pending contract', coalesce(doc.name || ' ' || doc.doctor_key, 'none'), doc.provider_id is not null);
  -- a nurse who has a reception provider
  select a.id admin_id, np.provider_id, np.nurse_key into nurse from public.admins a
   cross join lateral clinic_reception.home_nurse_provider(ws, a.id) np
   where clinic_reception.is_nurse(a.id) and np.provider_id is not null order by np.nurse_key limit 1;
  insert into hc_live(step, expected, actual, ok) values ('fixture nurse', 'a nursing admin with a reception provider (HR code = doctor_key)', coalesce(nurse.nurse_key, 'none — every nurse fee would wait in home_nurse_issues'), nurse.provider_id is not null);
  select id into pat from clinic_reception.patients where workspace_id = ws order by created_at desc limit 1;
  -- two free 60-minute slots, ≥ 10 minutes from the doctor's other bookings, today/tomorrow
  select t into slot from generate_series(date_trunc('hour', now()) + interval '1 hour', date_trunc('hour', now()) + interval '36 hours', interval '5 minutes') t
   where not exists (select 1 from clinic_reception.appointments a where a.provider_id = doc.provider_id and a.status not in ('cancelled', 'no_show')
                      and a.starts_at < t + interval '130 minutes' and a.ends_at > t - interval '10 minutes')
     and not exists (select 1 from clinic_reception.appointments a where a.nurse_admin_id = nurse.admin_id and a.status in ('booked', 'arrived')
                      and a.starts_at < t + interval '60 minutes' and a.ends_at > t)
   order by t limit 1;
  insert into clinic_reception.appointments(workspace_id, patient_id, provider_id, service_id, starts_at, ends_at, status, created_by, arrived_at, performer_mode, nurse_admin_id)
    values (ws, pat, doc.provider_id, svc.id, slot, slot + interval '60 minutes', 'arrived', me, now(), 'nurse_with_doctor', nurse.admin_id) returning id into ap1;
  insert into clinic_reception.appointments(workspace_id, patient_id, provider_id, service_id, starts_at, ends_at, status, created_by, arrived_at)
    values (ws, pat, doc.provider_id, svc.id, slot + interval '70 minutes', slot + interval '130 minutes', 'arrived', me, now()) returning id into ap2;
  insert into clinic_reception.visits(workspace_id, appointment_id, patient_id, opened_by) values (ws, ap1, pat, me) returning id into v1;
  insert into clinic_reception.visits(workspace_id, appointment_id, patient_id, opened_by) values (ws, ap2, pat, me) returning id into v2;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select ws, v1, s.id, doc.provider_id, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc.id returning id into o1;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select ws, v2, s.id, doc.provider_id, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc.id returning id into o2;
  insert into hc_live(step, expected, actual, ok) values ('fixture visits', '2 arrived visits (with nurse / doctor alone)', to_char(slot at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'), o1 is not null and o2 is not null);

  -- as Mazen (reception)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  g := clinic_reception.shift_guard_state();
  if coalesce((g->>'locked')::boolean, false) then
    execute 'create or replace function clinic_reception.shift_guard_check(p_workspace uuid) returns void language plpgsql as $f$ begin return; end $f$';
    stubbed := true;
  end if;
  insert into hc_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'Mazen has an open shift, or stubbed in this txn', case when stubbed then 'stubbed (Mazen had no open shift)' else 'open shift' end, true);
  -- 1) before the financial manager approves: refused (never the department contract)
  begin r := public.clinic_reception_command(ws, 'execute', jsonb_build_object('id', o1), gen_random_uuid()); err := 'accepted';
  exception when others then err := sqlerrm; end;
  insert into hc_live(step, expected, actual, ok) values ('Mazen execute before approval', 'refused (contract not approved)', err,
    err like '%لسه ما اتعتمدش في الحسابات%' or err like '%حدد عقدًا واحدًا معتمدًا%');
  -- 2) the financial manager (not the maker) approves this doctor's contract
  select a.id, a.user_id into fm, fm_uid from public.admins a where a.active and a.role = 'financial_manager' and a.user_id is not null
     and a.id <> (select created_by from clinic_finance.doctor_contracts where id = doc.contract_id) order by a.id limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', fm_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', fm_uid::text, true);
  begin cid := public.clinic_finance_doctor_command('contract_review_batch', jsonb_build_object('ids', jsonb_build_array(doc.contract_id), 'approve', true, 'note', 'تجربة تراجع — اعتماد'), gen_random_uuid()); err := 'ok';
  exception when others then err := sqlerrm; end;
  insert into hc_live(step, expected, actual, ok) values ('FM approves the 50% contract', 'ok → active', err || ' · ' || (select status from clinic_finance.doctor_contracts where id = doc.contract_id),
    err = 'ok' and (select status from clinic_finance.doctor_contracts where id = doc.contract_id) = 'active');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  -- 3) execute both
  for x in select * from (values (o1, 'with nurse', 100::numeric, 650::numeric), (o2, 'doctor alone', 0::numeric, 750::numeric)) v(o, label, nurse_fee, center) loop
    begin r := public.clinic_reception_command(ws, 'execute', jsonb_build_object('id', x.o), gen_random_uuid()); err := 'ok';
    exception when others then err := sqlerrm; end;
    select coalesce(sum(l.credit - l.debit), 0) into nf from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
     where j.source like 'home_nurse%' and j.dimensions->>'order_id' = x.o::text and (j.dimensions->>'provider_id')::uuid is not distinct from nurse.provider_id;
    insert into hc_live(step, expected, actual, ok)
    select 'Mazen execute (' || x.label || ')', 'ok · invoice 1500 · doctor 750 · nurse ' || x.nurse_fee || ' · center ' || x.center,
      err || ' · invoice ' || coalesce(i.amount::text, '-') || ' · doctor ' || coalesce(o.doctor_fee::text, '-') || ' · nurse ' || nf || ' · center ' || coalesce((o.net_revenue - o.doctor_fee - nf)::text, '-'),
      err = 'ok' and i.amount = 1500 and o.doctor_fee = 750 and nf = x.nurse_fee and o.net_revenue - o.doctor_fee - nf = x.center
      from clinic_reception.orders o left join clinic_reception.invoices i on i.order_id = o.id where o.id = x.o;
  end loop;
  insert into hc_live(step, expected, actual, ok) values ('no nurse issue left', '0 open home_nurse_issues for the fixture', (select count(*) from clinic_reception.home_nurse_issues where order_id in (o1, o2) and resolved_at is null)::text,
    not exists (select 1 from clinic_reception.home_nurse_issues where order_id in (o1, o2) and resolved_at is null));
  insert into hc_live(step, expected, actual, ok) values ('nurse fee is held until paid', 'desk_held(nurse) ≥ 100', clinic_finance.desk_held(nurse.nurse_key)::text, clinic_finance.desk_held(nurse.nurse_key) >= 100);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
select step, expected, actual, ok from hc_live order by n;
rollback;
