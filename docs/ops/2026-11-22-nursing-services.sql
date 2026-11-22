-- «عاوزين نفعل خدمات التمريض» (owner 2026-11-22). Plan + read-only checks + dry-run. English digits only.
-- How nursing reaches the booking screen (code):
--   * a reception service comes ONLY from public.pricing_services with booking_enabled = true + booking_code +
--     booking_department + booking_minutes (clinic_reception.sync_catalog runs on every live 'book'; rows without a
--     pricing link are turned off);
--   * «حجز موعد» → department «التمريض» lists services of that department AND the services the «التمريض» provider is
--     scoped for (provider_service_scopes; unit provider = no doctor_key, no contract needed) — 20261121170000;
--   * docs/ops/2026-11-21-lab-provider.sql scoped «التمريض» to the nurse services of «الطوارئ»
--     (name ~ حقن|كانيولا|كانولا|محلول|تمريض|تطعيم, not طبيب|دكتور|خياط);
--   * home nursing: services with clinic_reception.services.is_home (action 'service_home') booked on the home-nursing
--     staff providers (department «التمريض المنزلي»).
-- ============================ 1) READ-ONLY CHECKS (send me the rows) ============================
-- 1a. nursing candidates in pricing (any category), with their booking setup
select s.id, s.name, s.category, s.active, s.booking_enabled, s.booking_code, s.booking_department, s.booking_minutes, s.base_price
  from public.pricing_services s
 where s.name ~ '(حقن|كانيولا|كانولا|محلول|غيار|جرح|ضغط|سكر|تمريض|ممرض|تطعيم|قسطر|بخار|نيبولايزر|رسم قلب|منزل|رعاية)'
    or coalesce(s.category,'') ~ '(تمريض|طوارئ|منزل)'
 order by s.booking_department nulls first, s.name;
-- 1b. what reception has now for الطوارئ / التمريض / التمريض المنزلي (active, real services)
select s.department, s.code, s.name, s.price, s.minutes, s.is_home, s.active
  from clinic_reception.services s
 where s.department in ('الطوارئ','التمريض','التمريض المنزلي') and not s.placeholder
 order by s.department, s.name;
-- 1c. the «التمريض» provider and its scope rows (did 2026-11-21-lab-provider.sql run?)
select p.id, p.name, p.department, p.active, p.capacity, p.doctor_key,
       (select string_agg(sc.service_code, ', ') from clinic_reception.provider_service_scopes sc where sc.provider_id = p.id) scopes
  from clinic_reception.providers p where p.name = 'التمريض' or p.department in ('التمريض','التمريض المنزلي') order by p.department, p.name;
-- 1d. weekly hours of the nursing providers (needed for free times)
select p.name, w.dow, w.starts, w.ends from clinic_reception.weekly_slots w join clinic_reception.providers p on p.id = w.provider_id
 where p.department in ('التمريض','التمريض المنزلي') order by p.name, w.dow;

-- ============================ 2) PROPOSED ACTIVATION (dry-run; ends in ROLLBACK) ============================
-- A. In-center nursing: keep the نurse services under «الطوارئ» in pricing (one price list, same codes the doctors use)
--    and give them to the «التمريض» provider by scope rows — re-run of 2026-11-21 step, idempotent. If 1a shows nursing
--    services that are NOT booking-enabled, enable them under «التمريض» with a short code and duration:
--      حقنة عضل / وريد 5 min · تركيب كانيولا 10 · تعليق محلول 60 · غيار جرح (تمريض) 15 · قياس ضغط / سكر 5 · تطعيم 10
--    Prices = base_price from pricing (missing prices are listed for the owner by query 2c below; nothing is guessed).
-- B. Home nursing: the same services marked is_home on the reception side are offered on the home-nursing staff
--    (department «التمريض المنزلي»); a «زيارة تمريض منزلي» service if it exists in pricing (1a) gets booking_department
--    «التمريض المنزلي».
begin;
-- 2a. enable booking for nursing pricing rows that are not enabled yet (review the list from 1a first!)
update public.pricing_services s set booking_enabled = true,
       booking_department = coalesce(nullif(s.booking_department, ''), case when s.name ~ 'منزل' then 'التمريض المنزلي' else 'التمريض' end),
       booking_code = coalesce(nullif(s.booking_code, ''), 'NUR-' || upper(left(md5(s.id::text), 6))),
       booking_minutes = coalesce(s.booking_minutes, case when s.name ~ 'محلول' then 60 when s.name ~ '(غيار|جرح)' then 15
                                                         when s.name ~ '(كانيولا|كانولا|تطعيم)' then 10 else 5 end)
 where s.active and not s.booking_enabled and s.base_price > 0
   and s.name ~ '(حقن|كانيولا|كانولا|محلول|غيار جرح بواسطة التمريض|ضغط|سكر|تطعيم|تمريض|منزل)'
   and s.name !~ '(طبيب|دكتور|خياط)'
returning s.name, s.booking_department, s.booking_code, s.booking_minutes, s.base_price;
-- 2b. sync the catalog (same as a booking does), then scope the «التمريض» provider to the nurse services
select clinic_reception.sync_catalog(w.id) from clinic_reception.workspaces w where w.mode = 'live';
insert into clinic_reception.provider_service_scopes(provider_id, service_code)
select distinct p.id, s.code from clinic_reception.providers p join clinic_reception.services s on s.workspace_id = p.workspace_id
 where p.name = 'التمريض' and s.active and not s.placeholder
   and (s.department = 'التمريض' or (s.department = 'الطوارئ' and s.name ~ '(حقن|كانيولا|كانولا|محلول|تمريض|تطعيم)' and s.name !~ '(طبيب|دكتور|خياط)'))
on conflict do nothing;
-- 2c. what the booking screen will show under «التمريض», and anything without a price
select s.department, s.name, s.code, s.price, s.minutes from clinic_reception.services s
  join clinic_reception.provider_service_scopes sc on sc.service_code = s.code
  join clinic_reception.providers p on p.id = sc.provider_id and p.name = 'التمريض'
 where s.active order by s.name;
select s.name, s.base_price from public.pricing_services s
 where s.active and s.name ~ '(حقن|كانيولا|كانولا|محلول|غيار|ضغط|سكر|تطعيم|تمريض|منزل)' and coalesce(s.base_price,0) <= 0;
rollback;
