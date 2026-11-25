-- Ops 2026-11-26: make the doctor home-visit fee bookable for every doctor (owner decision 2026-11-14, pricing row created by
-- the owner): pricing_services «خدمة طبيب منزلي - رسوم الزيارة (يضاف لها سعر الكشف العادي حسب التخصص)», base_price 1500.
-- Model: the visit fee is its OWN line (1500) + the doctor's normal consult of his specialty (+ any home services / supplies /
-- medicines). Mirrors the home-NURSING fee «خدمة تمريض منزلي - رسوم الزيارة» (200, NUR-F61284).
-- Department «خدمات الكشف» → clinic_reception.is_basic_service = true → bookable / executable by EVERY doctor, no scope rows.
-- NOT done here (owner decision pending): the doctor contract for this code. Execution needs exactly one approved contract per
-- doctor for the code (clinic_finance.doctor_contract_for_service). An exact-code contract wins over 'قسم:خدمات الكشف', so:
--   * all 1500 to the center  → per doctor an exact-code contract at rate 0 (contract_batch);
--   * doctor gets X% of the fee → the same with rate X.
-- Until those contracts exist the fee line can be BOOKED but its «تنفيذ» is refused («حدد عقدًا واحدًا معتمدًا…»).
-- Run PREVIEW first; then the APPLY block as ONE transaction (dry-run with ROLLBACK, then COMMIT).

-- ===================== PREVIEW (read-only) =====================
select id, name, base_price, category, active, booking_enabled, booking_code, booking_department, booking_minutes
  from public.pricing_services
 where name like 'خدمة طبيب منزلي - رسوم الزيارة%' or name like 'خدمة تمريض منزلي - رسوم الزيارة%';
select s.code, s.name, s.department, s.price, s.is_home, s.active from clinic_reception.services s
 where s.workspace_id = (select id from clinic_reception.workspaces where mode = 'live')
   and (s.name like 'خدمة طبيب منزلي%' or s.name like 'خدمة تمريض منزلي - رسوم الزيارة%');
select clinic_reception.is_basic_service('خدمات الكشف', 'خدمة طبيب منزلي - رسوم الزيارة (يضاف لها سعر الكشف العادي حسب التخصص)') as basic_ok;

-- ===================== APPLY (one transaction) =====================
begin;
do $$
declare n int; pid uuid; ws uuid; sid uuid; v_code text;
begin
  select count(*) into n from public.pricing_services
   where name = 'خدمة طبيب منزلي - رسوم الزيارة (يضاف لها سعر الكشف العادي حسب التخصص)' and base_price = 1500;
  if n <> 1 then raise exception 'expected exactly 1 pricing row «خدمة طبيب منزلي - رسوم الزيارة…» at 1500, found %', n; end if;
  select id, coalesce(nullif(btrim(booking_code), ''), 'HOME-DR-FEE') into pid, v_code from public.pricing_services
   where name = 'خدمة طبيب منزلي - رسوم الزيارة (يضاف لها سعر الكشف العادي حسب التخصص)' and base_price = 1500;
  if exists (select 1 from public.pricing_services where booking_code = v_code and id <> pid) then
    raise exception 'booking code % is already used by another pricing row', v_code; end if;
  update public.pricing_services
     set active = true, booking_enabled = true, booking_code = v_code, booking_department = 'خدمات الكشف', booking_minutes = 5
   where id = pid;
  select id into ws from clinic_reception.workspaces where mode = 'live';
  perform clinic_reception.sync_catalog(ws);
  select id into sid from clinic_reception.services where workspace_id = ws and code = v_code and active
   order by version desc limit 1;
  if sid is null then raise exception 'sync_catalog did not create the reception service for %', v_code; end if;
  -- the same write the reception «service_home» action does
  update clinic_reception.services set is_home = true where id = sid;
  if not clinic_reception.is_basic_service('خدمات الكشف', (select name from clinic_reception.services where id = sid)) then
    raise exception 'the fee is not a basic service — every doctor would need a scope row'; end if;
end $$;
-- after-state (expect: 1 active row, department خدمات الكشف, price 1500, is_home true)
select s.code, s.name, s.department, s.price, s.is_home, s.active, s.version from clinic_reception.services s
 where s.workspace_id = (select id from clinic_reception.workspaces where mode = 'live') and s.name like 'خدمة طبيب منزلي%'
 order by s.version desc;
-- doctors who could execute the fee line today (exactly one contract for its code) — expect 0 until the FM adds contracts
select count(*) filter (where (select count(*) from clinic_finance.doctor_contract_for_service(p.doctor_key, s.code, null, s.department, clinic_reception.today())) = 1) as executable_doctors,
       count(*) as active_doctors
  from clinic_reception.providers p
  cross join (select code, department from clinic_reception.services where workspace_id = (select id from clinic_reception.workspaces where mode = 'live')
               and name like 'خدمة طبيب منزلي%' and active order by version desc limit 1) s
 where p.active and p.doctor_key is not null;
rollback;   -- dry-run; change to COMMIT for the real apply
