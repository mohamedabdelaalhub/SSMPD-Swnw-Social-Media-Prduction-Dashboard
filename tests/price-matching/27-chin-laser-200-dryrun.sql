-- DRY RUN for 26: create the service + sync, then show the code/id, price chain and reception booking. Ends in ROLLBACK.
-- Run from tests/price-matching with -v ON_ERROR_STOP=1.
begin;
\i 26-chin-laser-200-steps.sql
select 'new_service' part, jsonb_build_object('id',p.id,'code',p.booking_code,'canonical',p.canonical_code,'name',p.name,
  'category',p.category,'unit',p.canonical_unit,'dept',p.booking_department,'minutes',p.booking_minutes,'device',p.booking_requires_device,
  'base',p.base_price,'booking',p.booking_enabled,
  'cash_price',clinic_prices.resolve(p.id,p.base_price,current_date),
  'cash_price_dec1',clinic_prices.resolve(p.id,p.base_price,'2026-12-01'),
  'in_any_list',(select coalesce(jsonb_agg(l.name),'[]') from clinic_prices.items i join clinic_prices.lists l on l.id=i.list_id where i.service_id=p.id),
  'face_supplies_not_copied',(select src_supplies from chin_new)) data
from chin_new c join public.pricing_services p on p.booking_code=c.new_code and p.name=c.new_name
union all
select 'reception', jsonb_agg(jsonb_build_object('code',r.code,'name',r.name,'dept',r.department,'minutes',r.minutes,'device',r.requires_device,
  'price',r.price,'active',r.active,'source',r.pricing_evidence->>'source'))
from clinic_reception.services r join clinic_reception.workspaces w on w.id=r.workspace_id and w.mode='live'
where r.active and r.code in ('0001239',(select new_code from chin_new))
union all
select 'dept_doctors', jsonb_agg(jsonb_build_object('name',pr.name,'active',pr.active,'shady',pr.name like '%شادي%') order by pr.name)
from clinic_reception.provider_departments d join clinic_reception.providers pr on pr.id=d.provider_id
join clinic_reception.workspaces w on w.id=pr.workspace_id and w.mode='live'
where d.department='الجلدية والتجميل'
union all
select 'shady_departments', jsonb_agg(jsonb_build_object('name',pr.name,'home',pr.department,
  'depts',(select jsonb_agg(d.department) from clinic_reception.provider_departments d where d.provider_id=pr.id)))
from clinic_reception.providers pr join clinic_reception.workspaces w on w.id=pr.workspace_id and w.mode='live' where pr.name like '%شادي%'
union all
select 'catalog_issues', jsonb_agg(jsonb_build_array(name,detail)) from clinic_reception.catalog_issues where name like 'جلسة ليزر تحديد الذقن%';
rollback;
