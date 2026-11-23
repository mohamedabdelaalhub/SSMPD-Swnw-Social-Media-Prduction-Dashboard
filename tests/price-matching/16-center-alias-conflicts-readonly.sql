-- READ ONLY. Center master review fails with «تعارض مع مطابقة معتمدة للاسم …». The activation step (decide_list, and the
-- identical pre-20261123080000 price_lists_command 'review' branch) checks every item against clinic_prices.aliases
-- scope 'center': same external_code + unit (and name, or a non-empty code) must point to the SAME service.
-- Items are built by master review as: service = plan existing_ids[0], external_code = plan source_rows[0].code,
-- external_name = plan name, unit = plan unit. This lists every plan group whose alias points elsewhere.
begin read only;
with p as (select x from clinic_prices.master_reviews m, jsonb_array_elements(m.plan) x where m.list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
g as (select x->>'name' name,x->>'category' category,x->>'unit' unit,(x->'existing_ids'->>0)::uuid plan_sid,x->'source_rows'->0->>'code' code,(x->>'price')::numeric price from p),
c as (select g.*,a.service_id alias_sid,a.external_name alias_name,a.list_id alias_list,a.reviewed_at,a.reviewed_by
      from g join clinic_prices.aliases a on a.scope_key='center' and a.external_code=g.code and a.unit=g.unit
        and (a.external_name=g.name or (g.code<>'' and a.external_code=g.code))
      where g.plan_sid is not null and a.service_id<>g.plan_sid)
select 'summary', jsonb_build_object('plan_groups',(select count(*) from g),'conflicts',(select count(*) from c),
  'center_aliases_total',(select count(*) from clinic_prices.aliases where scope_key='center'),
  'alias_source_lists',(select jsonb_agg(distinct jsonb_build_object('list',l.name,'version',l.version,'status',l.status,'deleted',l.deleted_at is not null)) from clinic_prices.aliases a join clinic_prices.lists l on l.id=a.list_id where a.scope_key='center'))
union all
select 'conflicts', jsonb_agg(jsonb_build_object('code',code,'row_name',name,'row_category',category,'price',price,
  'plan_service',(select jsonb_build_object('id',s.id,'name',s.name,'category',s.category,'code',s.booking_code,'active',s.active) from public.pricing_services s where s.id=plan_sid),
  'alias_service',(select jsonb_build_object('id',s.id,'name',s.name,'category',s.category,'code',s.booking_code,'active',s.active,
       'reception_active',(select count(*) from clinic_reception.services r where r.pricing_service_id=s.id and r.active)) from public.pricing_services s where s.id=alias_sid),
  'alias_name',alias_name,'alias_from_list',(select name||' v'||version from clinic_prices.lists where id=alias_list),'alias_at',reviewed_at::date) order by name)
from c;
rollback;
