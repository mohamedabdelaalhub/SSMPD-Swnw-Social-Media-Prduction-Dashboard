-- DRY RUN for 32: shows everything that touches 0001260 before and after. One transaction, ends in ROLLBACK.
-- Run from tests/price-matching with -v ON_ERROR_STOP=1.
begin;
create temp table dc_before on commit drop as
select 'cash' k, null::text ref, (clinic_prices.resolve(p.id,p.base_price,current_date)->>'price')::numeric price from public.pricing_services p where p.booking_code='0001260' and p.active
union all select 'reception', r.code, r.price from clinic_reception.services r join clinic_reception.workspaces w on w.id=r.workspace_id and w.mode='live' where r.code='0001260' and r.active
union all select 'contract', coalesce(e.name,'')||' | '||c.reference, c.price from clinic_reception.entity_contracts c join clinic_reception.workspaces w on w.id=c.workspace_id and w.mode='live'
  left join clinic_reception.entities e on e.id=c.entity_id where c.service_code='0001260' and c.status='active'
union all select 'package', pp.name||case when pp.booking_fixed_price is not null then ' [ثابت]' else ' [محسوب]' end, t.price
  from public.pricing_packages pp join clinic_reception.package_templates t on t.pricing_package_id=pp.id and t.active
  where pp.active and exists(select 1 from jsonb_array_elements(pp.services_included) j join public.pricing_services s on s.id=(j->>'service_id')::uuid where s.booking_code='0001260');
\i 32-deep-cleaning-800-steps.sql
create temp table dc_after on commit drop as
select 'cash' k, null::text ref, (clinic_prices.resolve(p.id,p.base_price,current_date)->>'price')::numeric price from public.pricing_services p where p.booking_code='0001260' and p.active
union all select 'reception', r.code, r.price from clinic_reception.services r join clinic_reception.workspaces w on w.id=r.workspace_id and w.mode='live' where r.code='0001260' and r.active
union all select 'contract', coalesce(e.name,'')||' | '||c.reference, c.price from clinic_reception.entity_contracts c join clinic_reception.workspaces w on w.id=c.workspace_id and w.mode='live'
  left join clinic_reception.entities e on e.id=c.entity_id where c.service_code='0001260' and c.status='active'
union all select 'package', pp.name||case when pp.booking_fixed_price is not null then ' [ثابت]' else ' [محسوب]' end, t.price
  from public.pricing_packages pp join clinic_reception.package_templates t on t.pricing_package_id=pp.id and t.active
  where pp.active and exists(select 1 from jsonb_array_elements(pp.services_included) j join public.pricing_services s on s.id=(j->>'service_id')::uuid where s.booking_code='0001260');
select coalesce(b.k,a.k) kind, coalesce(b.ref,a.ref) ref, b.price before, a.price after, (b.price is distinct from a.price) changed
from dc_before b full join dc_after a on a.k=b.k and a.ref is not distinct from b.ref order by 1,2;
select 'other_lists_with_0001260' part, jsonb_agg(jsonb_build_object('list',l.name,'kind',l.list_kind,'status',l.status,'mode',l.mode,'fixed',i.fixed_price,'disc',i.discount_percent))
from clinic_prices.items i join clinic_prices.lists l on l.id=i.list_id join public.pricing_services s on s.id=i.service_id
where s.booking_code='0001260' and l.deleted_at is null and l.status in ('active','pending','draft')
union all
select 'open_orders_keep_old_price', jsonb_build_object('count',count(*),'prices',jsonb_agg(distinct o.price))
from clinic_reception.orders o join clinic_reception.services r on r.id=o.service_id where r.code='0001260' and o.status='ordered'
union all
select 'audit', (select to_jsonb(a)-'id' from clinic_prices.audit a where a.action='owner_item_price_change' order by a.created_at desc limit 1)
union all
select 'catalog_issues', jsonb_agg(jsonb_build_array(name,detail)) from clinic_reception.catalog_issues where name like '%تنظيف بشرة عميق%';
rollback;
