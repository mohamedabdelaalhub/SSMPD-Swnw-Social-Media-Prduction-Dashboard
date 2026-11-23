-- Center list (سونو / دار النقاهة) master-path preflight — READ ONLY. Replays the checks of
-- price_master_command('prepare') (mig 20261028215551) without writing, and previews what 'review' would do.
begin read only;
with l as (select * from clinic_prices.lists where id='12289346-917a-40e6-bd74-9b9696f844f4'),
raw as (select b.id batch_id,b.status,s.id section_id,s.name category,x from clinic_prices.batches b join l on l.id=b.list_id
        join clinic_prices.sections s on s.id=b.section_id cross join lateral jsonb_array_elements(b.rows) x),
grp as (select section_id,category,trim(x->>'name') name,trim(coalesce(x->>'unit','')) unit,min((x->>'price')::numeric) pmin,max((x->>'price')::numeric) pmax,count(*) n
        from raw group by 1,2,3,4),
ex as (select g.*,(select array_agg(p.id) from public.pricing_services p where p.active and p.name=g.name and p.category=g.category and p.canonical_unit=g.unit) ids from grp g)
select 'list' part, (select jsonb_build_object('status',status,'mode',mode,'discount_percent',discount_percent,'discount_amount',discount_amount,'contract_id',contract_id,
  'revision',revision,'created_by',created_by,'items',(select count(*) from clinic_prices.items i where i.list_id=l.id),
  'batches_by_status',(select jsonb_object_agg(status,c) from (select status,count(*) c from clinic_prices.batches where list_id=l.id group by status) q)) from l)
union all select 'row_checks', jsonb_build_object(
  'rows',(select count(*) from raw),
  'bad_name_code_price',(select count(*) from raw where length(trim(coalesce(x->>'name','')))<1 or length(trim(coalesce(x->>'code','')))=0 or nullif(x->>'price','') is null or (x->>'price')::numeric<=0),
  'dup_codes',(select count(*) from (select x->>'code' from raw group by 1 having count(*)>1) q),
  'same_name_diff_price',(select jsonb_agg(jsonb_build_array(name,category,pmin,pmax)) from grp where pmin<>pmax),
  'groups',(select count(*) from grp),
  'groups_merging_rows',(select count(*) from grp where n>1))
union all select 'plan', jsonb_build_object(
  'existing_one',(select count(*) from ex where cardinality(ids)=1),
  'will_create_new_service',(select count(*) from ex where ids is null),
  'multi_definitions_BLOCKER',(select jsonb_agg(jsonb_build_array(name,category,cardinality(ids))) from ex where cardinality(ids)>1),
  'price_changes_vs_base',(select count(*) from ex e join public.pricing_services p on p.id=e.ids[1] where cardinality(e.ids)=1 and p.base_price is distinct from e.pmin),
  'price_change_samples',(select jsonb_agg(z) from (select jsonb_build_array(e.name,p.base_price,e.pmin) z from ex e join public.pricing_services p on p.id=e.ids[1]
       where cardinality(e.ids)=1 and p.base_price is distinct from e.pmin order by abs(e.pmin-coalesce(p.base_price,0)) desc limit 12) q),
  'new_service_samples',(select jsonb_agg(z) from (select jsonb_build_array(name,category,pmin) z from ex where ids is null order by category,name limit 25) q))
union all select 'admins', (select jsonb_agg(jsonb_build_object('id',a.id,'role',a.role,'name',a.name,'is_list_creator',a.id=(select created_by from l)))
  from public.admins a where a.id=(select created_by from l) or a.role in ('super_admin','financial_manager'));
rollback;
