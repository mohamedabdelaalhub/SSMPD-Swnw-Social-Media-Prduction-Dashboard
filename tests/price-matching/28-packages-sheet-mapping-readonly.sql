-- READ ONLY. Owner's packages/offers sheet 2026-11-25: candidate services for every row + every current package with its
-- live template. Wrap: BEGIN READ ONLY … ROLLBACK (this file does it). Paste back all 'part' rows.
begin read only;
with kw(grp,pat) as (values
 ('A_physio','(علاج طبيعي|جلسة علاج|تأهيل|تاهيل)'),
 ('B_pulse','(نبض|نبضه|نبضة|pulse)'),
 ('B_diode','(دايود|ديود|diode)'),
 ('C_candela','(كانديلا|candela)'),
 ('D_dermapen','(ديرمابن|ديرما بن|ديرمابين|dermapen|ميكرونيدل)'),
 ('D_cleaning','(تنظيف)'),
 ('D_oxygeneo','(اكسجين|أكسجين|اوكسجين|أوكسجين|oxyg)'),
 ('D_hydra','(هيدرا|hydra)'),
 ('D_fractional','(فراكشن|فراكشنال|fractional|فركشنال)'),
 ('D_amber','(امبر|أمبر|عنبر|amber)'),
 ('D_lips','(شفايف|شفاه|شفاة|lips)')),
svc as (select p.*, clinic_prices.resolve(p.id,p.base_price,current_date) today, clinic_prices.resolve(p.id,p.base_price,'2026-12-01') dec1
        from public.pricing_services p where p.active)
select 'services' part, k.grp, jsonb_agg(jsonb_build_object('code',s.booking_code,'id',s.id,'name',s.name,'dept',s.booking_department,
  'cat',s.category,'unit',s.canonical_unit,'booking',s.booking_enabled,'min',s.booking_minutes,'base',s.base_price,
  'today',s.today->>'price','dec1',s.dec1->>'price',
  'reception',(select r.price from clinic_reception.services r join clinic_reception.workspaces w on w.id=r.workspace_id and w.mode='live'
               where r.pricing_service_id=s.id and r.active limit 1)) order by s.booking_code) data
from kw k join svc s on lower(s.name) ~ k.pat group by k.grp
union all
select 'packages', null, jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'active',p.active,'booking',p.booking_enabled,
  'visits',p.booking_visits,'days',p.booking_validity_days,'variable',p.booking_variable_visits,'margin',round(p.profit_margin_percent,4),
  'from',p.booking_sell_from,'until',p.booking_sell_until,'min_first',p.booking_min_first_percent,
  'lines',(select jsonb_agg(jsonb_build_array(s.booking_code,j->>'quantity',j->>'visit_no')) from jsonb_array_elements(p.services_included) j
           left join public.pricing_services s on s.id=(j->>'service_id')::uuid),
  'template',(select jsonb_build_object('price',t.price,'visits',t.visits,'days',t.validity_days,'min_first',t.min_first_percent,'until',t.sell_until)
              from clinic_reception.package_templates t join clinic_reception.workspaces w on w.id=t.workspace_id and w.mode='live'
              where t.pricing_package_id=p.id and t.active limit 1),
  'sold',(select count(*) from clinic_reception.packages k join clinic_reception.package_templates t on t.id=k.template_id where t.pricing_package_id=p.id))
  order by p.name) from public.pricing_packages p
union all
select 'package_columns', null, jsonb_agg(column_name order by ordinal_position) from information_schema.columns
 where table_schema='public' and table_name='pricing_packages'
union all
select 'template_triggers', null, jsonb_agg(tgname order by tgname) from pg_trigger
 where tgrelid='clinic_reception.package_templates'::regclass and not tgisinternal
union all
select 'package_issues', null, jsonb_agg(jsonb_build_array(name,detail)) from clinic_reception.catalog_issues where kind='packages';
rollback;
