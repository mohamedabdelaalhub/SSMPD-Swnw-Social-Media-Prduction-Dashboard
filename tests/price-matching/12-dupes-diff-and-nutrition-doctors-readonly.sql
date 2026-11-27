-- READ ONLY. (A) field-by-field diff of the 2 duplicate pairs (pricing + reception copies).
-- (B) the 12 «التغذية والتخسيس» center rows: current catalogue category/department/codes.
-- (C) which reception doctors could book them today (department or explicit service scope), and the cosmetic doctors.
begin read only;
with pairs(keep,drop_) as (values ('2f4eee27-9285-490b-af68-084d515559e2'::uuid,'2d9954c7-a9bc-5ae3-9363-59be8aba4ea3'::uuid),
                                  ('6a6e5e4c-22dc-4787-a59d-1952b83f212c'::uuid,'6fc82d83-3733-5235-ba42-247a405680a2'::uuid)),
d as (select p.keep,p.drop_,k.j kj,x.j xj from pairs p
      cross join lateral (select to_jsonb(s)-'id'-'created_at'-'updated_at'-'canonical_code'-'booking_code' j from public.pricing_services s where s.id=p.keep) k
      cross join lateral (select to_jsonb(s)-'id'-'created_at'-'updated_at'-'canonical_code'-'booking_code' j from public.pricing_services s where s.id=p.drop_) x),
rd as (select p.keep,p.drop_,
        (select to_jsonb(r)-'id'-'code'-'pricing_service_id'-'source_fingerprint'-'created_at'-'version' from clinic_reception.services r where r.pricing_service_id=p.keep and r.active limit 1) rk,
        (select to_jsonb(r)-'id'-'code'-'pricing_service_id'-'source_fingerprint'-'created_at'-'version' from clinic_reception.services r where r.pricing_service_id=p.drop_ and r.active limit 1) rx from pairs p),
nut as (select distinct trim(x->>'name') name from clinic_prices.batches b join clinic_prices.sections s on s.id=b.section_id cross join lateral jsonb_array_elements(b.rows) x
        where b.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and s.name='التغذية والتخسيس')
select 'A_pricing_diff', jsonb_agg(jsonb_build_object('keep',keep,'name',kj->>'name',
   'different_fields',(select coalesce(jsonb_object_agg(k,jsonb_build_array(kj->k,xj->k)),'{}') from jsonb_object_keys(kj) k where kj->k is distinct from xj->k))) from d
union all
select 'A_reception_diff', jsonb_agg(jsonb_build_object('keep',keep,
   'different_fields',(select coalesce(jsonb_object_agg(k,jsonb_build_array(rk->k,rx->k)),'{}') from jsonb_object_keys(coalesce(rk,'{}')) k where rk->k is distinct from rx->k))) from rd
union all
select 'B_nutrition_services', jsonb_agg(jsonb_build_object('name',n.name,'catalogue',(select jsonb_agg(jsonb_build_object('id',p.id,'category',p.category,'dept',p.booking_department,'code',p.booking_code,'booking',p.booking_enabled)) from public.pricing_services p where p.active and p.name=n.name))) from nut n
union all
select 'C_doctors', jsonb_build_object(
  'departments_of_nutrition_services',(select jsonb_agg(distinct p.booking_department) from public.pricing_services p join nut n on n.name=p.name where p.active),
  'physio_and_cosmetic_doctors',(select jsonb_agg(jsonb_build_object('provider',pr.name,'department',pr.department,'extra_departments',(select jsonb_agg(department) from clinic_reception.provider_departments d where d.provider_id=pr.id),
     'scoped_codes_count',(select count(*) from clinic_reception.provider_service_scopes sc where sc.provider_id=pr.id)))
     from clinic_reception.providers pr where pr.active and (pr.department ~ 'جلد|تجميل|علاج طبيعي|تأهيل|تغذية|تخسيس' or exists(select 1 from clinic_reception.provider_departments d where d.provider_id=pr.id and d.department ~ 'جلد|تجميل|علاج طبيعي|تأهيل|تغذية|تخسيس'))),
  'catalogue_departments',(select jsonb_agg(distinct booking_department) from public.pricing_services where active));
rollback;
