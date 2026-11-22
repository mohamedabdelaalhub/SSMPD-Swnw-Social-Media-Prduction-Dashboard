-- Home-nursing visit fee bookable (owner 2026-11-22 «موافق على رسوم الزيارة المنزلية 200»). APPLY script (ends in COMMIT;
-- dry-run it with the last line changed to ROLLBACK). Only this one service. English digits.
-- 1) pricing row «خدمة تمريض منزلي - رسوم الزيارة» → booking enabled, dept «التمريض المنزلي», code NUR-F61284, 5 min
-- 2) clinic_reception.sync_catalog(live workspace)  → reception service created / refreshed from pricing (price from pricing)
-- 3) is_home = true (same column the 'service_home' action sets)
-- 4) scope rows for the 6 home-nursing staff providers (doctor_key EMP-000001/3/5/7/8/11)
-- 5) after-state checks; any mismatch raises and nothing is kept
begin;
do $$
declare ps record; n int; ws uuid; sv record; k int;
begin
  select count(*) into n from public.pricing_services where name = 'خدمة تمريض منزلي - رسوم الزيارة';
  if n <> 1 then raise exception 'expected exactly 1 pricing row named «خدمة تمريض منزلي - رسوم الزيارة», found %', n; end if;
  select * into ps from public.pricing_services where name = 'خدمة تمريض منزلي - رسوم الزيارة';
  if not ps.active then raise exception 'pricing row is inactive'; end if;
  if exists (select 1 from public.pricing_services where booking_code = 'NUR-F61284' and id <> ps.id) then raise exception 'code NUR-F61284 already used by another pricing row'; end if;
  update public.pricing_services set booking_enabled = true, booking_department = 'التمريض المنزلي', booking_code = 'NUR-F61284', booking_minutes = 5
   where id = ps.id;

  select id into ws from clinic_reception.workspaces where mode = 'live';
  if ws is null then raise exception 'live workspace not found'; end if;
  perform clinic_reception.sync_catalog(ws);

  select * into sv from clinic_reception.services where workspace_id = ws and code = 'NUR-F61284' and active order by version desc limit 1;
  if not found then raise exception 'sync_catalog did not create the reception service NUR-F61284'; end if;
  if sv.department <> 'التمريض المنزلي' or sv.minutes <> 5 then raise exception 'unexpected service setup: % / % min', sv.department, sv.minutes; end if;
  if sv.price <> 200 then raise exception 'price is % (expected 200) — fix the price in التسعير first', sv.price; end if;

  update clinic_reception.services set is_home = true where id = sv.id;

  insert into clinic_reception.provider_service_scopes(provider_id, service_code)
    select p.id, 'NUR-F61284' from clinic_reception.providers p
     where p.workspace_id = ws and p.active and p.doctor_key in ('EMP-000001','EMP-000003','EMP-000005','EMP-000007','EMP-000008','EMP-000011')
    on conflict do nothing;
  select count(*) into k from clinic_reception.provider_service_scopes sc join clinic_reception.providers p on p.id = sc.provider_id
   where sc.service_code = 'NUR-F61284' and p.workspace_id = ws and p.active
     and p.doctor_key in ('EMP-000001','EMP-000003','EMP-000005','EMP-000007','EMP-000008','EMP-000011');
  if k <> 6 then raise exception 'expected 6 home-nursing scope rows, found %', k; end if;
  raise notice 'OK: % (%) dept % · % min · price % · is_home true · 6 home-nursing staff scoped', sv.name, sv.code, sv.department, sv.minutes, sv.price;
end $$;
select s.code, s.name, s.department, s.minutes, s.price, s.is_home, s.active,
       (select count(*) from clinic_reception.provider_service_scopes sc where sc.service_code = s.code) scopes
  from clinic_reception.services s where s.code = 'NUR-F61284' and s.active;
commit;
