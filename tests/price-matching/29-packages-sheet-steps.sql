-- Owner's packages/offers sheet 2026-11-25 (relayed by main chat 5) → public.pricing_packages, prices pinned with
-- booking_fixed_price (mig 20261125120000 must be applied first). Acts AS THE OWNER (RLS "accounting … packages").
-- Idempotent: updates the existing rows by name, inserts the missing ones; a second run changes nothing.
-- Run inside BEGIN … COMMIT, then the reception catalogue sync (last block).
-- ── settings still waiting for the owner (edit here only; the md5 changes) ──────────────────────────────────────────────
--   Owner 2026-11-25: the 15 area offers are PERMANENT, named «عروض المناطق لليزر», 3 months; pulses = Candela only (Diode
--   unchanged); physio 6 = 400/session (2400), 12 = 350/session (4200, 3 months).
--   c_prefix    : name of the 15 area packages.        c_until : last sale day, '' = no end.
--   c_min_first : minimum first payment % of the 15 (owner: today's 25 % minimum, the patient may pay all; '' = sheet values
--                 100 / 50 for the two full-body rows).
--   include_d   : cosmetic (D) packages — owner answered 2026-11-25: normal cleaning 0001245, dermapen 0001246, fractional 0001289, 1 month.
select set_config('pk.c_prefix','عروض المناطق لليزر — كانديلا 3 جلسات — ',true),
       set_config('pk.c_until','',true),
       set_config('pk.c_min_first','25',true),
       set_config('pk.include_d','true',true),
       set_config('pk.d_days','30',true),
       set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
create temp table pk_plan(grp text, old_name text, name text, lines jsonb, visits int, days int, min_first numeric, fixed numeric,
  terms text, sell_until date) on commit drop;
-- lines = [[code, quantity, visit_no], …]
insert into pk_plan
-- A) physiotherapy (0001166 «جلسة علاج طبيعي»), 1 session a week, 50 % first + 50 % second
select 'A','باكج علاج طبيعي 6 جلسات (350 للجلسة)','باكج علاج طبيعي 6 جلسات (400 للجلسة)',
       (select jsonb_agg(jsonb_build_array('0001166',1,v)) from generate_series(1,6) v),6,60,50,2400,
       'باكج علاج طبيعي 6 جلسات، جلسة كل أسبوع. صالح شهرين من يوم الشراء. 50% في أول جلسة و50% في تاني جلسة.',null::date
union all
select 'A','باكج علاج طبيعي 12 جلسة (350 للجلسة)','باكج علاج طبيعي 12 جلسة (350 للجلسة)',
       (select jsonb_agg(jsonb_build_array('0001166',1,v)) from generate_series(1,12) v),12,90,50,4200,
       'باكج علاج طبيعي 12 جلسة، جلسة كل أسبوع. صالح 3 شهور من يوم الشراء. 50% في أول جلسة و50% في تاني جلسة.',null
union all
-- B) Candela pulse packages (0001228, partial draw per session — clinic_reception.laser_pulse_services)
select 'B',null,'باكج ليزر كانديلا — '||n||' نبضة',jsonb_build_array(jsonb_build_array('0001228',n,1)),1,d,mf,p,
       'باكج '||n||' نبضة ليزر كانديلا (50 قرش للنبضة)، بتتخصم حسب النبضات الفعلية في كل جلسة. صالح '||(d/30)||' شهور من يوم الشراء. '||
       case when mf=100 then 'الدفع كامل في أول جلسة.' else '50% في أول جلسة و50% في تاني جلسة.' end,null
from (values(1000,90,100,450),(3000,90,50,1350),(5000,150,50,2200),(10000,150,50,4300)) b(n,d,mf,p)
union all
-- C) Candela areas, 3 sessions, 3 months; full payment at the first session except the two full-body rows (50/50)
select 'C','وايت فرايداي — ليزر كانديلا 3 جلسات — '||a, current_setting('pk.c_prefix')||a,
       jsonb_build_array(jsonb_build_array(c,1,1),jsonb_build_array(c,1,2),jsonb_build_array(c,1,3)),3,90,
       coalesce(nullif(current_setting('pk.c_min_first'),'')::numeric,mf),p,
       '3 جلسات ليزر كانديلا جنتل برو لمنطقة '||a||'. صالح 3 شهور من يوم الشراء. '||
       case coalesce(nullif(current_setting('pk.c_min_first'),'')::numeric,mf) when 100 then 'الدفع كامل في أول جلسة.' when 50 then '50% في أول جلسة و50% في تاني جلسة.'
         else 'أول دفعة '||current_setting('pk.c_min_first')||'% على الأقل في أول جلسة، وممكن الدفع كامل.' end,
       nullif(current_setting('pk.c_until'),'')::date
from (values('الموستاج','0001232',100,120),('الوجه','0001239',100,380),('تحت الإبط','0001235',100,380),('البكيني','0001230',100,480),
  ('البكيني ولاين البكيني وتحت الإبط','0001252',100,750),('الوجه والرقبة','0001241',100,620),('نصف اليدين','0001270',100,980),
  ('اليدين بالكامل','0001294',100,1270),('نصف الرجلين','0001272',100,1270),('الرجلين بالكامل','0001292',100,2250),
  ('البطن','0001307',100,1180),('البطن والضهر','0001309',100,2150),('المؤخرة','0001311',100,1080),
  ('الجسم كامل بدون البطن والضهر','0001314',50,4850),('الجسم كامل بالبطن والضهر','0001333',50,6350)) c(a,c,mf,p)
union all
-- D) cosmetic, 1 session, full payment at the first session (all services in visit 1)
select 'D',null,n,(select jsonb_agg(jsonb_build_array(x,1,1)) from unnest(cs) x),1,current_setting('pk.d_days')::int,100,p,t,null
from (values
  ('باكج ديرما بن للوش + تنظيف بشرة + ديرما بن شفايف هدية',array['0001246','0001245','0001249'],1000,'ديرما بن للوش وتنظيف بشرة، وديرما بن الشفايف هدية. جلسة واحدة. الدفع كامل في أول جلسة.'),
  ('باكج تنظيف بشرة عميق + أوكسيجينو',array['0001260','0001262'],1100,'تنظيف بشرة عميق وجلسة أوكسيجينو. جلسة واحدة. الدفع كامل في أول جلسة.'),
  ('باكج ديرما بن للوش + ديرما بن شفايف',array['0001246','0001249'],500,'ديرما بن للوش وديرما بن للشفايف. جلسة واحدة. الدفع كامل في أول جلسة.'),
  ('باكج ليزر فراكشنال',array['0001289'],400,'جلسة ليزر فراكشنال لمنطقة واحدة (نضارة وتقشير). الدفع كامل في أول جلسة.'),
  ('باكج تنظيف بشرة عميق + هيدرافيشال + أوكسيجينو',array['0001260','0001261','0001262'],1500,'تنظيف بشرة عميق وهيدرافيشال وأوكسيجينو. جلسة واحدة. الدفع كامل في أول جلسة.')
  -- «تنظيف بشرة عميق للوش + ديرما بن أمبر» 2000: no «ديرما بن أمبر» service in the catalogue → not created (see report).
 ) d(n,cs,p,t) where current_setting('pk.include_d')::boolean;
do $$declare missing text;begin
 if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'wrong actor';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='pricing_packages' and column_name='booking_fixed_price')
  then raise exception 'apply mig 20261125120000 first';end if;
 select string_agg(distinct l->>0,',') into missing from pk_plan, jsonb_array_elements(lines) l
  where not exists(select 1 from public.pricing_services s where s.booking_code=l->>0 and s.active and s.booking_enabled);
 if missing is not null then raise exception 'services not active/booking-enabled: %',missing;end if;
 if exists(select 1 from pk_plan p join public.pricing_packages x on x.name in (p.old_name,p.name) and x.active
           join clinic_reception.package_templates t on t.pricing_package_id=x.id join clinic_reception.packages k on k.template_id=t.id
           where p.old_name is not null) then raise notice 'some updated packages were already sold — sold ones keep their own contract';end if;
end $$;
create temp table pk_rows on commit drop as
select p.*, (select jsonb_agg(jsonb_build_object('service_id',s.id,'quantity',(l->>1)::numeric,'visit_no',(l->>2)::int) order by (l->>2)::int,l->>0)
             from jsonb_array_elements(p.lines) l join public.pricing_services s on s.booking_code=l->>0 and s.active) services_included
from pk_plan p;
grant select on pk_rows to authenticated;
set local role authenticated;
update public.pricing_packages x set name=r.name,services_included=r.services_included,profit_margin_percent=0,booking_enabled=true,
  booking_visits=r.visits,booking_validity_days=r.days,booking_terms=r.terms,booking_variable_visits=false,
  booking_sell_from=null,booking_sell_until=r.sell_until,booking_min_first_percent=r.min_first,booking_fixed_price=r.fixed,updated_at=now()
from pk_rows r
where x.active and x.name in (r.name,coalesce(r.old_name,r.name))
  and (x.name,x.services_included,x.booking_visits,x.booking_validity_days,x.booking_terms,x.booking_sell_until,x.booking_min_first_percent,x.booking_fixed_price,x.booking_enabled)
      is distinct from (r.name,r.services_included,r.visits,r.days,r.terms,r.sell_until,r.min_first,r.fixed,true);
insert into public.pricing_packages(name,services_included,profit_margin_percent,active,booking_enabled,booking_visits,booking_validity_days,booking_terms,
  booking_variable_visits,booking_sell_from,booking_sell_until,booking_min_first_percent,booking_fixed_price)
select r.name,r.services_included,0,true,true,r.visits,r.days,r.terms,false,null,r.sell_until,r.min_first,r.fixed from pk_rows r
where not exists(select 1 from public.pricing_packages x where x.active and x.name in (r.name,coalesce(r.old_name,r.name)));
reset role;
do $$declare ws uuid;begin
 select id into ws from clinic_reception.workspaces where mode='live' order by id limit 1;
 perform clinic_reception.sync_catalog(ws);
end $$;
