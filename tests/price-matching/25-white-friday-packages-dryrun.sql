-- DRY RUN: White Friday offer (22) + 15 packages (24) + reception catalogue sync → template price must equal the owner's
-- 3-session price. One transaction, ends in ROLLBACK. Run from tests/price-matching with -v ON_ERROR_STOP=1.
begin;
\i 22-white-friday-offer-steps.sql
\i 24-white-friday-packages-steps.sql
do $$declare ws uuid;begin
 select id into ws from clinic_reception.workspaces where mode='live' order by id limit 1;
 perform clinic_reception.sync_catalog(ws);
end $$;
select w.code,w.area,w.target,w.unit_price,
       t.price template_price,(t.price=w.target) ok,t.visits,t.validity_days,t.sell_from,t.sell_until,t.min_first_percent,t.active,
       (select count(*) from clinic_reception.template_lines tl where tl.template_id=t.id) lines
from wf_pkg w
join public.pricing_packages pp on pp.name='وايت فرايداي — ليزر كانديلا 3 جلسات — '||w.area
left join clinic_reception.package_templates t on t.pricing_package_id=pp.id and t.active
order by w.code;
select 'catalog_issues' part, jsonb_agg(jsonb_build_array(name,detail)) from clinic_reception.catalog_issues where kind='packages' and name like 'وايت فرايداي%';
rollback;
