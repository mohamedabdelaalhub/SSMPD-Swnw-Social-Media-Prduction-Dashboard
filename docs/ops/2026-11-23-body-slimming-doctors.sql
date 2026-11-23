-- «التغذية والتخسيس» body services bookable by every physio and cosmetic doctor (owner «موافق» 2026-11-23, relayed by the price-mapping
-- chat / main chat 4): ALL physio doctors book the 12 services (11 body / cosmetic + INBODY), cosmetic doctors book them too.
-- Choice (main chat 4's caution): the 12 move to a DEDICATED booking department «جسم وتخسيس», NOT «التغذية والتخسيس» — that one also holds
-- the nutrition consults (0001388 كشف التغذية / 0001389 متابعة التغذية / 0001397 كشف استشاري تغذية), which must stay with the nutrition
-- doctors only. Then «جسم وتخسيس» is added as an extra department (clinic_reception.provider_departments, the same mechanism as «المعمل»)
-- for: every active provider of العلاج الطبيعي / الجلدية والتجميل / التغذية والتخسيس (nutrition doctors keep INBODY), plus named physio
-- doctors whose main department is different (د. سما نبيل عارف). Source of truth = public.pricing_services.booking_department, then
-- clinic_reception.sync_catalog() publishes it to the booking catalogue.
-- The 12 are found by their pricing section «التغذية والتخسيس» minus the three nutrition consults; the file stops unless exactly 12 match.
-- Self-contained and idempotent; dry-run with ROLLBACK first and read the NOTICEs.
begin;
do $$
declare ws uuid; n int; r record; dept constant text := 'جسم وتخسيس'; codes text[]; extra_names text[] := array['سما نبيل'];
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if ws is null then raise exception 'no live reception workspace'; end if;
  if to_regclass('clinic_reception.provider_departments') is null then raise exception 'apply 20261121170000_reception_lab_units first'; end if;

  -- the 12: pricing rows whose section / category is «التغذية والتخسيس», bookable, not the 3 nutrition consults
  select array_agg(ps.booking_code order by ps.booking_code) into codes from public.pricing_services ps
   where ps.booking_enabled and coalesce(ps.booking_code, '') <> ''
     and ps.booking_code not in ('0001388', '0001389', '0001397')
     and exists (select 1 from jsonb_each_text(to_jsonb(ps)) kv where kv.key not in ('booking_department', 'name') and kv.value = 'التغذية والتخسيس');
  for r in select ps.booking_code, ps.name, ps.booking_department from public.pricing_services ps where ps.booking_code = any(codes) order by ps.booking_code loop
    raise notice 'service % — % (booking department now: %)', r.booking_code, r.name, r.booking_department;
  end loop;
  if coalesce(array_length(codes, 1), 0) <> 12 then raise exception 'expected 12 body / slimming services, found % — check the list above', coalesce(array_length(codes, 1), 0); end if;

  update public.pricing_services set booking_department = dept where booking_code = any(codes) and booking_department is distinct from dept;
  get diagnostics n = row_count; raise notice 'booking department → «%» on % pricing rows', dept, n;
  perform clinic_reception.sync_catalog(ws);
  raise notice 'booking catalogue: % active services in «%»', (select count(*) from clinic_reception.services where workspace_id = ws and active and department = dept), dept;

  -- doctors: physio / cosmetic / nutrition (main or extra department) + named physio doctors
  for r in select p.id, p.name, p.department, p.active from clinic_reception.providers p
            where p.workspace_id = ws and p.active
              and (p.department in ('العلاج الطبيعي', 'الجلدية والتجميل', 'التغذية والتخسيس')
                   or exists (select 1 from clinic_reception.provider_departments pd where pd.provider_id = p.id and pd.department in ('العلاج الطبيعي', 'الجلدية والتجميل'))
                   or exists (select 1 from unnest(extra_names) x where p.name like '%' || x || '%'))
            order by p.department, p.name loop
    insert into clinic_reception.provider_departments(provider_id, department) values (r.id, dept) on conflict do nothing;
    raise notice 'doctor % (%) → «%»', r.name, r.department, dept;
  end loop;
  for r in select p.name, p.department from clinic_reception.providers p
            where p.workspace_id = ws and not p.active and (p.department in ('العلاج الطبيعي', 'الجلدية والتجميل') or exists (select 1 from unnest(extra_names) x where p.name like '%' || x || '%')) loop
    raise notice 'inactive (not added): % (%)', r.name, r.department;
  end loop;
  -- nothing else uses the new department
  if exists (select 1 from clinic_reception.services s where s.workspace_id = ws and s.active and s.department = dept and not (s.code = any(codes))) then
    raise exception 'another service already uses «%»', dept; end if;
end $$;
commit;
