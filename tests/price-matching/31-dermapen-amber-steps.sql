-- Owner 2026-11-25: new service «جلسة ديرما بن أمبر» at 1500 EGP (standalone), and the cosmetic package
-- «باكج تنظيف بشرة عميق + ديرما بن أمبر» at a FIXED 2000 (1 session, 1 month, full payment at the first session).
-- Run AFTER mig 20261125120000 and 29, inside BEGIN … COMMIT. Same path as 26: copies the booking setup of 0001246
-- (ديرما بن ميزوثيرابي — category, unit, department, minutes, device, …), base 1500, supplies [] and margin 0,
-- next free 7-digit booking code, reason in clinic_prices.audit. Not in any price list (center fallback 'base' → 1500),
-- not in any offer. Idempotent.
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
create temp table amber_new on commit drop as
select s.id src_id, s.booking_department src_dept,
       lpad(((select max(booking_code::bigint) from public.pricing_services where booking_code ~ '^[0-9]{7}$')+1)::text,7,'0') new_code,
       'جلسة ديرما بن أمبر'::text new_name,
       exists(select 1 from public.pricing_services x where x.name='جلسة ديرما بن أمبر' and x.active) already
from public.pricing_services s where s.booking_code='0001246' and s.active;
do $$declare c amber_new%rowtype;begin
 if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'wrong actor';end if;
 if (select count(*) from amber_new)<>1 then raise exception '0001246 (ديرما بن ميزوثيرابي) not found/active';end if;
 select * into c from amber_new;
 if c.src_dept is distinct from 'الجلدية والتجميل' then raise exception '0001246 department is % — stop and ask',c.src_dept;end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='pricing_packages' and column_name='booking_fixed_price')
  then raise exception 'apply mig 20261125120000 first';end if;
end $$;
grant select on amber_new to authenticated;
set local role authenticated;
insert into public.pricing_services
select (jsonb_populate_record(null::public.pricing_services,
         to_jsonb(s) || jsonb_build_object('id',gen_random_uuid(),'name',c.new_name,'booking_code',c.new_code,'canonical_code',null,
           'base_price',1500,'supplies_used','[]'::jsonb,'profit_margin_percent',0,'active',true,'booking_enabled',true,
           'created_by','bd5a528f-af8d-4ada-afe9-ce64e68b1d92','created_at',now(),'updated_at',now()))).*
from amber_new c join public.pricing_services s on s.id=c.src_id
where not c.already;
insert into public.pricing_packages(name,services_included,profit_margin_percent,active,booking_enabled,booking_visits,booking_validity_days,booking_terms,
  booking_variable_visits,booking_sell_from,booking_sell_until,booking_min_first_percent,booking_fixed_price)
select 'باكج تنظيف بشرة عميق + ديرما بن أمبر',
       jsonb_build_array(jsonb_build_object('service_id',d.id,'quantity',1,'visit_no',1),jsonb_build_object('service_id',a.id,'quantity',1,'visit_no',1)),
       0,true,true,1,30,'تنظيف بشرة عميق وجلسة ديرما بن أمبر. جلسة واحدة. صالح شهر من يوم الشراء. الدفع كامل في أول جلسة.',false,null,null,100,2000
from public.pricing_services d, public.pricing_services a
where d.booking_code='0001260' and d.active and a.name='جلسة ديرما بن أمبر' and a.active
  and not exists(select 1 from public.pricing_packages x where x.active and x.name='باكج تنظيف بشرة عميق + ديرما بن أمبر');
reset role;
insert into clinic_prices.audit(actor_id,action,list_id,details)
select 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92','owner_fixed_price_service',l.id,
       jsonb_build_object('service_id',p.id,'code',p.booking_code,'name',p.name,'price',1500,'copied_from','0001246',
                          'reason','قرار المالك 2026-11-25 — ديرما بن أمبر 1500')
from amber_new c join public.pricing_services p on p.booking_code=c.new_code and p.name=c.new_name
join lateral (select id from clinic_prices.lists where list_kind='center' and contract_id is null and status='active' and deleted_at is null
              order by valid_from desc,id limit 1) l on true
where not c.already;
do $$declare ws uuid;begin
 select id into ws from clinic_reception.workspaces where mode='live' order by id limit 1;
 perform clinic_reception.sync_catalog(ws);
end $$;
