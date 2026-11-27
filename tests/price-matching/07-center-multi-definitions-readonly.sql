-- Center list: which names would still hit >1 catalogue definition AFTER the section fixes of 05? READ ONLY.
-- The renames are replayed as a mapping (no writes): الطواري→الطوارئ, المخ والاعصاب→المخ والأعصاب,
-- التغذية والتخسيس→الجلدية والتجميل. Same match rule as price_master_command('prepare'):
-- p.active and p.name=trim(row name) and p.category=section name and p.canonical_unit=trim(row unit).
begin read only;
with l as (select '12289346-917a-40e6-bd74-9b9696f844f4'::uuid id),
raw as (select case s.name when 'الطواري' then 'الطوارئ' when 'المخ والاعصاب' then 'المخ والأعصاب' when 'التغذية والتخسيس' then 'الجلدية والتجميل' else s.name end category,
               trim(x->>'name') name, trim(coalesce(x->>'unit','')) unit, (x->>'price')::numeric price, x->>'code' code
        from clinic_prices.batches b join l on l.id=b.list_id join clinic_prices.sections s on s.id=b.section_id cross join lateral jsonb_array_elements(b.rows) x),
grp as (select category,name,unit,min(price) price,count(*) n from raw group by 1,2,3),
hit as (select g.*,p.id sid,p.canonical_code,p.booking_code,p.base_price,p.booking_enabled,p.created_at
        from grp g join public.pricing_services p on p.active and p.name=g.name and p.category=g.category and p.canonical_unit=g.unit),
multi as (select category,name,unit from hit group by 1,2,3 having count(*)>1)
select 'summary' part, jsonb_build_object('groups',(select count(*) from grp),
  'one_definition',(select count(*) from (select 1 from hit group by category,name,unit having count(*)=1) q),
  'multi_definition_BLOCKERS',(select count(*) from multi),
  'still_new',(select count(*) from grp g where not exists(select 1 from hit h where h.category=g.category and h.name=g.name and h.unit=g.unit)),
  'still_new_list',(select jsonb_agg(jsonb_build_array(category,name)) from grp g where not exists(select 1 from hit h where h.category=g.category and h.name=g.name and h.unit=g.unit)))
union all
select 'blockers', jsonb_agg(jsonb_build_object('category',m.category,'name',m.name,'unit',m.unit,'list_price',(select price from grp g where (g.category,g.name,g.unit)=(m.category,m.name,m.unit)),
  'definitions',(select jsonb_agg(jsonb_build_object('id',h.sid,'code',coalesce(h.booking_code,h.canonical_code),'base_price',h.base_price,'booking',h.booking_enabled,'created',h.created_at::date,
     'reception_services',(select count(*) from clinic_reception.services r where r.pricing_service_id=h.sid),
     'reception_active',(select count(*) from clinic_reception.services r where r.pricing_service_id=h.sid and r.active),
     'price_list_items',(select count(*) from clinic_prices.items i where i.service_id=h.sid),
     'aliases',(select count(*) from clinic_prices.aliases a where a.service_id=h.sid),
     'contracts',(select count(*) from public.contracting_entity_contracts c where h.sid=any(c.booking_service_ids)))
   order by h.created_at) from hit h where (h.category,h.name,h.unit)=(m.category,m.name,m.unit))) order by m.category,m.name)
from multi m;
rollback;
