-- DRY RUN: stale alias fix (17, as the owner) → center master «اعتماد» as Dr. Dina (body of 15). Ends in ROLLBACK.
-- Pass: review_ok true, list status active, items 1363, services_created 0, unconfirmed_rows 0.
begin;
\i 17-center-stale-alias-fix-steps.sql
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from public.admins where id='fefb0277-bc1b-4cfe-a4a2-91a4d9d5689c'),'role','authenticated')::text,true);
create temp table rv_before on commit drop as
 select (select status from clinic_prices.lists where id='12289346-917a-40e6-bd74-9b9696f844f4') list_status,
        (select count(*) from public.pricing_services) services,
        (select count(*) from clinic_prices.lists where list_kind='center' and status='active' and deleted_at is null) active_center_lists;
do $$begin if public.my_admin_id() is distinct from 'fefb0277-bc1b-4cfe-a4a2-91a4d9d5689c'::uuid then raise exception 'actor is not Dr. Dina';end if;end $$;
select public.price_master_command('review',jsonb_build_object(
  'list_id','12289346-917a-40e6-bd74-9b9696f844f4',
  'revision',(select revision from clinic_prices.lists where id='12289346-917a-40e6-bd74-9b9696f844f4'),
  'decision','approved','note','اعتماد مرجع أسعار المركز بعد تصحيح الأقسام وتوحيد الخدمات المكررة (23-11)',
  'dates_confirmed',true,'merge_identical',true)) is not null as review_ok;
select 'result' part, jsonb_build_object(
 'before',(select to_jsonb(r) from rv_before r),
 'list',(select jsonb_build_object('status',status,'fallback',fallback,'valid_from',valid_from,'valid_to',valid_to,'reviewed_by',reviewed_by) from clinic_prices.lists where id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'items',(select count(*) from clinic_prices.items where list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'items_price_differs_from_base',(select count(*) from clinic_prices.items i join public.pricing_services p on p.id=i.service_id where i.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and i.fixed_price is distinct from p.base_price),
 'services_created',(select count(*) from public.pricing_services)-(select services from rv_before),
 'batches',(select jsonb_object_agg(status,c) from (select status,count(*) c from clinic_prices.batches where list_id='12289346-917a-40e6-bd74-9b9696f844f4' group by status) q),
 'unconfirmed_rows',(select count(*) from clinic_prices.batches b,jsonb_array_elements(b.rows) x where b.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and not coalesce((x->>'confirmed')::boolean,false)),
 'review',(select jsonb_build_object('status',status,'reviewed_by',reviewed_by) from clinic_prices.master_reviews where list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'center_aliases',(select count(*) from clinic_prices.aliases where scope_key='center'),
 'other_active_center_lists',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status)) from clinic_prices.lists where list_kind='center' and status in ('active','retired') and deleted_at is null and id<>'12289346-917a-40e6-bd74-9b9696f844f4'),
 'audit',(select jsonb_agg(action order by id) from clinic_prices.audit where list_id='12289346-917a-40e6-bd74-9b9696f844f4' and created_at=now()));
rollback;
