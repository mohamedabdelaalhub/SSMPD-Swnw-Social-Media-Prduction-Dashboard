-- Center list: why would 106 rows become NEW services? READ ONLY.
begin read only;
with l as (select id from clinic_prices.lists where id='12289346-917a-40e6-bd74-9b9696f844f4'),
raw as (select b.id batch_id,b.status,s.name category,x from clinic_prices.batches b join l on l.id=b.list_id
        join clinic_prices.sections s on s.id=b.section_id cross join lateral jsonb_array_elements(b.rows) x),
grp as (select category,trim(x->>'name') name,trim(coalesce(x->>'unit','')) unit,min((x->>'price')::numeric) p from raw group by 1,2,3),
nw as (select g.* from grp g where not exists(select 1 from public.pricing_services p where p.active and p.name=g.name and p.category=g.category and p.canonical_unit=g.unit))
select 'by_reason', jsonb_build_object(
  'same_name_other_category',(select count(*) from nw where exists(select 1 from public.pricing_services p where p.active and p.name=nw.name and p.canonical_unit=nw.unit)),
  'same_name_other_unit',(select count(*) from nw where exists(select 1 from public.pricing_services p where p.active and p.name=nw.name and p.canonical_unit<>nw.unit)),
  'name_only_trim_or_space_diff',(select count(*) from nw where exists(select 1 from public.pricing_services p where p.active and regexp_replace(p.name,'\s+','','g')=regexp_replace(nw.name,'\s+','','g') and p.name<>nw.name)),
  'truly_new',(select count(*) from nw where not exists(select 1 from public.pricing_services p where p.active and regexp_replace(p.name,'\s+','','g')=regexp_replace(nw.name,'\s+','','g'))))
union all select 'category_pairs', (select jsonb_agg(z) from (select jsonb_build_array(nw.category,p.category,count(*)) z from nw join public.pricing_services p on p.active and p.name=nw.name
  where p.category is distinct from nw.category group by nw.category,p.category order by count(*) desc) q)
union all select 'truly_new_list', (select jsonb_agg(jsonb_build_array(category,name,p) order by category,name) from nw where not exists(select 1 from public.pricing_services p where p.active and regexp_replace(p.name,'\s+','','g')=regexp_replace(nw.name,'\s+','','g')))
union all select 'applied_batch_and_items', jsonb_build_object(
  'batches',(select jsonb_agg(jsonb_build_object('id',b.id,'filename',b.filename,'rows',jsonb_array_length(b.rows),'created_at',b.created_at)) from clinic_prices.batches b join l on l.id=b.list_id where b.status='applied'),
  'items',(select jsonb_agg(jsonb_build_object('service',p.name,'price',i.fixed_price,'src',i.source_ref)) from clinic_prices.items i join l on l.id=i.list_id join public.pricing_services p on p.id=i.service_id))
union all select 'section_names', (select jsonb_agg(jsonb_build_array(s.name,(select count(*) from raw where raw.category=s.name))) from clinic_prices.sections s join l on l.id=s.list_id)
union all select 'catalogue_categories', (select jsonb_agg(c) from (select distinct category c from public.pricing_services where active order by 1) q);
rollback;
