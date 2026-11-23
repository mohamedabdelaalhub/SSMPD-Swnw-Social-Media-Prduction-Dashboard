-- The 2 duplicate catalogue services blocking the center master 'prepare' — full usage picture. READ ONLY.
begin read only;
with ids(sid) as (values ('6fc82d83-3733-5235-ba42-247a405680a2'::uuid),('6a6e5e4c-22dc-4787-a59d-1952b83f212c'::uuid),
                         ('2d9954c7-a9bc-5ae3-9363-59be8aba4ea3'::uuid),('2f4eee27-9285-490b-af68-084d515559e2'::uuid))
select jsonb_agg(jsonb_build_object(
 'pricing',(select jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'canonical',p.canonical_code,'booking_code',p.booking_code,'base',p.base_price,'unit',p.canonical_unit,'dept',p.booking_department,'created',p.created_at) from public.pricing_services p where p.id=ids.sid),
 'aliases',(select jsonb_agg(jsonb_build_object('scope',a.scope_key,'code',a.external_code,'name',a.external_name)) from clinic_prices.aliases a where a.service_id=ids.sid),
 'reception',(select jsonb_agg(jsonb_build_object('id',r.id,'code',r.code,'name',r.name,'active',r.active,'price',r.price,
     'appointments',(select count(*) from clinic_reception.appointments x where x.service_id=r.id),
     'orders',(select count(*) from clinic_reception.orders x where x.service_id=r.id),
     'template_lines',(select count(*) from clinic_reception.template_lines x where x.service_id=r.id),
     'entitlements',(select count(*) from clinic_reception.entitlements x where x.service_id=r.id),
     'follow_ups',(select count(*) from clinic_reception.follow_ups x where x.service_id=r.id)))
   from clinic_reception.services r where r.pricing_service_id=ids.sid),
 'center_rows',(select jsonb_agg(jsonb_build_object('code',x->>'code','name',x->>'name','price',x->>'price')) from clinic_prices.batches b cross join lateral jsonb_array_elements(b.rows) x
     where b.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and trim(x->>'name')=(select name from public.pricing_services where id=ids.sid))
)) from ids;
rollback;
