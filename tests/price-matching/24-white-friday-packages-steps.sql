-- White Friday «3 جلسات» laser packages (Candela GentlePro) — owner 2026-11-24: «الباكيدج من ١ نوفمبر الي ٣١ نوفمبر»,
-- validity «٤ شهور» (120 days), «المقدم … علي الاقل ٢٥٪» (mig 20261123170000 rule). One package per area, the same area
-- service on visits 1, 2 and 3. Written like the price editor does (public.pricing_packages under RLS, as the owner);
-- clinic_reception.sync_catalog turns each into a reception package template.
-- PRICE: a package price is computed, not stored = Σ(reception service price × qty) × (1 + profit_margin_percent/100).
-- During the White Friday offer the reception price of each area = its offer price, so the margin is set to
-- target / (3 × offer price) − 1  → the template price is exactly the owner's 3-session price.
-- REQUIRES the White Friday offer (22) to be active (prices are read from resolve() for today). After 30-11 the sell
-- window is closed, so the later recomputation never sells; packages already sold keep their own price and expiry.
-- Idempotent (skips names that exist). Run inside BEGIN … COMMIT.
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
create temp table wf_pkg on commit drop as
select v.code,v.area,v.target,p.id service_id,(clinic_prices.resolve(p.id,p.base_price,current_date)->>'price')::numeric unit_price,
       clinic_prices.resolve(p.id,p.base_price,current_date)->>'source' price_source
from (values ('0001232','الموستاج',120),('0001239','الوجه',380),('0001235','تحت الإبط',380),('0001230','البكيني',480),
             ('0001252','البكيني ولاين البكيني وتحت الإبط',750),('0001241','الوجه والرقبة',620),('0001270','نصف اليدين',980),
             ('0001294','اليدين بالكامل',1270),('0001272','نصف الرجلين',1270),('0001292','الرجلين بالكامل',2250),
             ('0001307','البطن',1180),('0001309','البطن والضهر',2150),('0001311','المؤخرة',1080),
             ('0001314','الجسم كامل بدون البطن والضهر',4850),('0001333','الجسم كامل بالبطن والضهر',6350)) v(code,area,target)
join public.pricing_services p on p.booking_code=v.code and p.active;
do $$begin
 if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'wrong actor';end if;
 if (select count(*) from wf_pkg)<>15 then raise exception 'expected 15 area services, found %',(select count(*) from wf_pkg);end if;
 if exists(select 1 from wf_pkg where price_source<>'offer') then raise exception 'White Friday offer is not active for: %',(select string_agg(code,',') from wf_pkg where price_source<>'offer');end if;
end $$;
grant select on wf_pkg to authenticated;
set local role authenticated;
insert into public.pricing_packages(name,services_included,profit_margin_percent,active,booking_enabled,booking_visits,booking_validity_days,booking_terms,
  booking_sell_from,booking_sell_until,booking_min_first_percent)
select 'وايت فرايداي — ليزر كانديلا 3 جلسات — '||w.area,
       jsonb_build_array(jsonb_build_object('service_id',w.service_id,'quantity',1,'visit_no',1),jsonb_build_object('service_id',w.service_id,'quantity',1,'visit_no',2),jsonb_build_object('service_id',w.service_id,'quantity',1,'visit_no',3)),
       round((w.target/(3*w.unit_price)-1)*100,10),true,true,3,120,
       'عرض وايت فرايداي: 3 جلسات ليزر كانديلا جنتل برو لمنطقة '||w.area||'. صالح 4 شهور من يوم الشراء. أول دفعة 25% على الأقل في أول جلسة، والباقي على الجلسات اللي بعدها.',
       '2026-11-01','2026-11-30',25
from wf_pkg w
where not exists(select 1 from public.pricing_packages x where x.name='وايت فرايداي — ليزر كانديلا 3 جلسات — '||w.area);
reset role;
