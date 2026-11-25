-- DRY RUN: mig 20261125120000 (body) + 29 + 31 (ديرما بن أمبر) + sync → every sheet row must show its template at the sheet price. ROLLBACK.
-- Before the mig is live: sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261125120000_package_fixed_price.sql > /tmp/fixed_body.sql
--   cd tests/price-matching && psql -v ON_ERROR_STOP=1 -v body=/tmp/fixed_body.sql -f 30-packages-sheet-dryrun.sql
-- After the mig is live: -v body=/dev/null
begin;
\i :body
\i 29-packages-sheet-steps.sql
\i 31-dermapen-amber-steps.sql
insert into pk_rows(grp,name,fixed,visits) values('D','باكج تنظيف بشرة عميق + ديرما بن أمبر',2000,1);
select r.grp, r.name, r.fixed sheet_price, t.price template_price, (t.price=r.fixed) price_ok, t.visits, r.visits want_visits,
       t.validity_days days, t.min_first_percent min_first, t.sell_until, t.active,
       (select count(*) from clinic_reception.template_lines tl where tl.template_id=t.id) lines,
       (select sum(tl.standalone_price*tl.quantity) from clinic_reception.template_lines tl where tl.template_id=t.id) standalone_total
from pk_rows r
left join public.pricing_packages pp on pp.name=r.name and pp.active
left join clinic_reception.package_templates t on t.pricing_package_id=pp.id and t.active
order by r.grp, r.fixed;
select 'amber_service' part, (select jsonb_build_object('code',p.booking_code,'name',p.name,'dept',p.booking_department,'minutes',p.booking_minutes,'base',p.base_price,
  'cash',clinic_prices.resolve(p.id,p.base_price,current_date)->>'price','reception',(select r.price from clinic_reception.services r where r.pricing_service_id=p.id and r.active limit 1))
  from public.pricing_services p where p.name='جلسة ديرما بن أمبر' and p.active)
union all
select 'summary' part, jsonb_build_object('rows',count(*),'price_ok',count(*) filter(where t.price=r.fixed),
  'missing_template',count(*) filter(where t.id is null)) from pk_rows r
left join public.pricing_packages pp on pp.name=r.name and pp.active
left join clinic_reception.package_templates t on t.pricing_package_id=pp.id and t.active
union all
select 'package_issues', jsonb_agg(jsonb_build_array(name,detail)) from clinic_reception.catalog_issues where kind='packages';
rollback;
