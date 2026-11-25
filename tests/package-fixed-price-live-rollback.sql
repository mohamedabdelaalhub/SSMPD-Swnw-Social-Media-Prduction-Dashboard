-- Live check for mig 20261125120000 (fixed package price) — one transaction, ends in ROLLBACK. Run from the repo root.
-- Before the mig is live, include its body (without its own begin/commit):
--   sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261125120000_package_fixed_price.sql > /tmp/fixed_body.sql
--   psql -v ON_ERROR_STOP=1 -v body=/tmp/fixed_body.sql -f tests/package-fixed-price-live-rollback.sql
-- After it is live: psql -v ON_ERROR_STOP=1 -v body=/dev/null -f tests/package-fixed-price-live-rollback.sql
begin;
\i :body
create temp table fx(step text, price numeric, expect numeric) on commit drop;
do $$
declare ws uuid; pk uuid; a uuid; b uuid; pa numeric; pb numeric; t numeric;
begin
 select id into ws from clinic_reception.workspaces where mode='live' order by id limit 1;
 select p.id, r.price into a, pa from public.pricing_services p join clinic_reception.services r on r.pricing_service_id=p.id and r.workspace_id=ws and r.active
  where p.booking_code='0001239' and p.active;
 select p.id, r.price into b, pb from public.pricing_services p join clinic_reception.services r on r.pricing_service_id=p.id and r.workspace_id=ws and r.active
  where p.booking_code='0001232' and p.active;
 if a is null or b is null then raise exception 'test services 0001239/0001232 not live in reception'; end if;
 insert into public.pricing_packages(name,services_included,profit_margin_percent,active,booking_enabled,booking_visits,booking_validity_days,booking_terms,booking_min_first_percent,booking_fixed_price)
 values('اختبار سعر ثابت — يتلغي',jsonb_build_array(jsonb_build_object('service_id',a,'quantity',1,'visit_no',1),jsonb_build_object('service_id',b,'quantity',1,'visit_no',2)),
        10,true,true,2,90,'اختبار سعر الباكج الثابت',50,999) returning id into pk;
 perform clinic_reception.sync_catalog(ws);
 select price into t from clinic_reception.package_templates where pricing_package_id=pk and active; insert into fx values('1 fixed at sync',t,999);
 update public.pricing_packages set booking_fixed_price=888 where id=pk;
 select price into t from clinic_reception.package_templates where pricing_package_id=pk and active; insert into fx values('2 fixed changed',t,888);
 update public.pricing_packages set profit_margin_percent=20 where id=pk; perform clinic_reception.sync_catalog(ws);
 select price into t from clinic_reception.package_templates where pricing_package_id=pk and active; insert into fx values('3 margin change ignored',t,888);
 update public.pricing_packages set booking_fixed_price=null where id=pk; perform clinic_reception.sync_catalog(ws);
 select price into t from clinic_reception.package_templates where pricing_package_id=pk and active; insert into fx values('4 cleared → margin',t,round((pa+pb)*1.2,2));
 insert into fx select '5 min_first copied', min_first_percent, 50 from clinic_reception.package_templates where pricing_package_id=pk and active;
 insert into fx select '6 active templates', count(*), 1 from clinic_reception.package_templates where pricing_package_id=pk and active;
end $$;
select step, price, expect, price is not distinct from expect ok from fx order by step;
select 'issues' part, jsonb_agg(jsonb_build_array(name,detail)) from clinic_reception.catalog_issues where name='اختبار سعر ثابت — يتلغي';
rollback;
