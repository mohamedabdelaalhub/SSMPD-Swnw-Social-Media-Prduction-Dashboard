-- Ops 2026-11-26 (owner decisions 2026-11-26 00:08Z; REPLACES the earlier «visit fee 1500 + consult» draft): data only.
-- Run AFTER migration supabase/migrations/20261126060000_home_consult_split.sql. Run PREVIEW first (read-only), then each APPLY
-- block as ONE transaction: first as a dry-run (replace its final COMMIT with ROLLBACK and read the output), then with COMMIT.
--   (1) Home NURSING visit fee «خدمة تمريض منزلي - رسوم الزيارة» = 150. Keep the ONE active 150 pricing row, retire the 200 row(s)
--       (active = false, booking off). If the 150 row has no booking code it TAKES the reception code of the retired row
--       (NUR-F61284): sync_catalog then re-versions the same reception code at 150, so the nurses' per-service contracts on that
--       code and «خدمة منزلية» (is_home) carry over. Existing future bookings / open orders on the old 200 version are LISTED, not
--       changed (their price snapshot stays 200 unless reception re-books them) — for the owner.
--   (2) Home DOCTOR consult: pricing row SVC-0001396 (canonical_code) becomes «كشف منزلي (شامل الانتقال)» 1500, bookable in
--       «خدمات الكشف» (basic = every doctor, clinic_reception.is_basic_service), is_home = true. Its booking code = the existing
--       booking_code or else SVC-0001396. Registered in clinic_reception.home_visit_split with nurse_fee 100.
--   (3) Doctor 750 = per-doctor EXACT-CODE contract at 50% (performed / service / no deduction) — PENDING, created through the
--       same public.clinic_finance_doctor_command('contract_batch') the contracts screen uses, as the MAKER admin below. The
--       financial manager (a different admin: maker ≠ checker) approves them on screen («اعتماد الكل»). Until a doctor's contract
--       is approved, the migration's guard refuses to execute his «كشف منزلي» (it never falls back to his department contract).
-- Split: invoice 1500 = doctor 750 + (nurse 100 when «ممرض/ة مع طبيب», posted by the migration) + center remainder (650 / 750).

-- ===================== PREVIEW (read-only) =====================
-- P1. the nursing fee rows and the home-consult row
select id, canonical_code, name, base_price, category, active, booking_enabled, booking_code, booking_department, booking_minutes
  from public.pricing_services
 where name like 'خدمة تمريض منزلي - رسوم الزيارة%' or canonical_code = 'SVC-0001396' or name like 'خدمة طبيب منزلي%' or name like 'كشف منزلي%'
 order by name, base_price;
-- P2. their reception services (all versions)
select s.code, s.version, s.name, s.department, s.price, s.is_home, s.active, s.pricing_service_id
  from clinic_reception.services s
 where s.workspace_id = (select id from clinic_reception.workspaces where mode = 'live')
   and (s.pricing_service_id in (select id from public.pricing_services where name like 'خدمة تمريض منزلي - رسوم الزيارة%' or canonical_code = 'SVC-0001396')
        or s.code = 'NUR-F61284')
 order by s.code, s.version;
-- P3. future bookings / open orders on the 200 nursing fee (to be LISTED for the owner, not changed)
select 'appointment' kind, a.id, to_char(a.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') at_cairo, a.status, p.file_no, pr.name provider, s.code, s.price
  from clinic_reception.appointments a join clinic_reception.services s on s.id = a.service_id
  join clinic_reception.patients p on p.id = a.patient_id join clinic_reception.providers pr on pr.id = a.provider_id
 where s.pricing_service_id in (select id from public.pricing_services where name like 'خدمة تمريض منزلي - رسوم الزيارة%' and base_price = 200)
   and a.status in ('booked', 'arrived') and a.starts_at >= now() - interval '12 hours'
union all
select 'open order', o.id, to_char(o.created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'), o.status, p.file_no, pr.name, o.snapshot->>'code', o.price
  from clinic_reception.orders o join clinic_reception.services s on s.id = o.service_id join clinic_reception.visits v on v.id = o.visit_id
  join clinic_reception.patients p on p.id = v.patient_id left join clinic_reception.providers pr on pr.id = o.provider_id
 where s.pricing_service_id in (select id from public.pricing_services where name like 'خدمة تمريض منزلي - رسوم الزيارة%' and base_price = 200)
   and o.status = 'ordered'
 order by 3;
-- P4. contracts on the nursing / home-consult codes (nurse per-service contracts must stay on the code that stays bookable)
select c.doctor_key, c.doctor_name, c.service_scope, c.fee_kind, c.rate, c.fixed_amount, c.status, c.valid_from, c.valid_to
  from clinic_finance.doctor_contracts c
 where c.service_scope in (select booking_code from public.pricing_services where name like 'خدمة تمريض منزلي - رسوم الزيارة%' or canonical_code = 'SVC-0001396')
    or c.service_scope in ('NUR-F61284', 'SVC-0001396') or c.service_scope like 'تمريض:%'
 order by c.service_scope, c.doctor_key, c.valid_from;
-- P5. THE DOCTOR LIST for the 50% contracts: active live providers with a doctor_key, minus nurses (HR person is a nursing /
--     head_nursing admin, or holds a «تمريض:…» contract, or the provider sits in a nursing department). One row per doctor_key.
--     current = what clinic_finance.doctor_contract_for_service resolves today for the home-consult code (expect «department
--     contract …» or «none» before the batch; «exact 50%» after approval).
with live as (select id from clinic_reception.workspaces where mode = 'live'),
code as (select coalesce(nullif(btrim(booking_code), ''), canonical_code) hc_code from public.pricing_services where canonical_code = 'SVC-0001396'),
nurse_keys as (
  select k from (select nullif(btrim(pp.doctor_key), '') k, pp.admin_id from clinic_people.people pp union all select nullif(btrim(pp.code), ''), pp.admin_id from clinic_people.people pp) x
   where k is not null and clinic_reception.is_nurse(x.admin_id)
  union select doctor_key from clinic_finance.doctor_contracts where service_scope like 'تمريض:%' and status in ('pending', 'active')),
docs as (
  select p.doctor_key, min(p.name) doctor_name, string_agg(distinct p.department, ' / ') departments
    from clinic_reception.providers p join live on live.id = p.workspace_id
   where p.active and nullif(btrim(p.doctor_key), '') is not null and p.department !~ 'تمريض'
     and p.doctor_key not in (select k from nurse_keys)
   group by p.doctor_key)
select d.doctor_key, d.doctor_name, d.departments,
       coalesce((select case when c.service_scope like 'قسم:%' then 'department contract ' || c.service_scope || ' ' || c.rate || '%' else 'exact ' || c.rate || '%' end
                   from clinic_finance.doctor_contract_for_service(d.doctor_key, (select hc_code from code), null, 'خدمات الكشف', (now() at time zone 'Africa/Cairo')::date) c limit 1), 'none') current,
       exists (select 1 from clinic_finance.doctor_contracts k where k.doctor_key = d.doctor_key and k.service_scope = (select hc_code from code) and k.status = 'pending') pending_exact
  from docs d order by d.doctor_name;
-- P6 moved to the CHECK section (C0): it needs the migration's clinic_reception.home_nurse_provider.

-- ===================== APPLY 1+2: nursing fee 150 + «كشف منزلي (شامل الانتقال)» 1500 (one transaction) =====================
begin;
do $$
declare ws uuid; n int; keep public.pricing_services%rowtype; old_dept text; old_min integer; old_codes text[]; moved text; sid uuid; hc public.pricing_services%rowtype; v_code text; svc record;
begin
  if to_regclass('clinic_reception.home_visit_split') is null then raise exception 'apply migration 20261126060000_home_consult_split.sql first'; end if;
  select count(*) into n from clinic_reception.workspaces where mode = 'live';
  if n <> 1 then raise exception 'expected exactly 1 live reception workspace, found %', n; end if;
  select id into ws from clinic_reception.workspaces where mode = 'live';

  -- (1) nursing visit fee: exactly one active 150 row; every other row of that name must be a 200 row (retired here)
  select count(*) into n from public.pricing_services where name like 'خدمة تمريض منزلي - رسوم الزيارة%' and active and base_price = 150;
  if n <> 1 then raise exception 'expected exactly 1 active «خدمة تمريض منزلي - رسوم الزيارة…» row at 150, found %', n; end if;
  select * into keep from public.pricing_services where name like 'خدمة تمريض منزلي - رسوم الزيارة%' and active and base_price = 150;
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
  -- the nursing code may still carry an older active reception version (e.g. 200 and 150 both active on NUR-F61284):
  -- keep only the newest version that belongs to the 150 row, as sync_catalog does when it re-versions a code
  select id into sid from clinic_reception.services where workspace_id = ws and pricing_service_id = keep.id and active order by version desc limit 1;
  if sid is not null then
    update clinic_reception.services set active = false
     where workspace_id = ws and active and id <> sid
       and (pricing_service_id = keep.id or code = (select code from clinic_reception.services where id = sid));
    get diagnostics n = row_count;
    raise notice 'nursing fee: deactivated % older active reception version(s) of the same code', n;
  end if;

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
-- after-state
select s.code, s.version, s.name, s.department, s.price, s.is_home, s.active from clinic_reception.services s
 where s.workspace_id = (select id from clinic_reception.workspaces where mode = 'live')
   and s.pricing_service_id in (select id from public.pricing_services where name like 'خدمة تمريض منزلي - رسوم الزيارة%' or canonical_code = 'SVC-0001396')
 order by s.code, s.version;
select * from clinic_reception.home_visit_split;
commit;   -- dry-run: replace with ROLLBACK

-- ===================== APPLY 3: PENDING 50% exact-code contracts, one per doctor (one transaction) =====================
-- MAKER = the admin who registers the contracts (accountant / financial manager / super admin). The financial manager approves
-- them on screen afterwards (the creator cannot approve his own). Change the id if another maker should appear on the contracts.
begin;
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
select c.doctor_key, c.doctor_name, c.rate, c.status, c.valid_from, c.valid_to from clinic_finance.doctor_contracts c
 where c.service_scope = (select booking_code from public.pricing_services where canonical_code = 'SVC-0001396') order by c.doctor_name;
commit;   -- dry-run: replace with ROLLBACK

-- ===================== CHECK after the financial manager approved (read-only) =====================
-- C0 (was P6; needs the migration, so it runs after it). nurses (booking «مين اللي هينفّذ؟» list) → their reception provider (a nurse without one gets her 100 later: home_nurse_issues)
select a.id admin_id, coalesce(a.name, a.email) nurse, pp.code, pp.doctor_key, np.provider_id, (select name from clinic_reception.providers where id = np.provider_id) provider
  from public.admins a left join clinic_people.people pp on pp.admin_id = a.id
  cross join lateral clinic_reception.home_nurse_provider((select id from clinic_reception.workspaces where mode = 'live'), a.id) np
 where clinic_reception.is_nurse(a.id) order by 2;
-- expect every doctor of P5: «exact 50%»; nurses with a provider in C0
select p.doctor_key, min(p.name) doctor,
       (select c.rate || '% ' || case when c.service_scope like 'قسم:%' then c.service_scope else 'exact' end
          from clinic_finance.doctor_contract_for_service(p.doctor_key, (select booking_code from public.pricing_services where canonical_code = 'SVC-0001396'), null, 'خدمات الكشف', (now() at time zone 'Africa/Cairo')::date) c limit 1) resolves_to
  from clinic_reception.providers p where p.workspace_id = (select id from clinic_reception.workspaces where mode = 'live') and p.active and p.doctor_key is not null
 group by p.doctor_key order by 2;
