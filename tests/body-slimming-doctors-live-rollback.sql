-- Rolled-back verify of docs/ops/2026-11-23-body-slimming-doctors.sql: runs the step, then checks the booking scope gate
-- (clinic_reception.has_provider_service_scope — the gate «حجز موعد» / order / execution use) for EVERY added doctor × the 12 services,
-- and that the nutrition consults did NOT open to a cosmetic / physio doctor. ONE transaction ending in ROLLBACK; last output = one table.
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

create temp table bs_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare ws uuid; d date := (now() at time zone 'Africa/Cairo')::date; r record; bad text; tot int; okn int;
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  for r in select p.id, p.name, p.department from clinic_reception.providers p join clinic_reception.provider_departments pd on pd.provider_id = p.id and pd.department = 'جسم وتخسيس'
            where p.workspace_id = ws and p.active order by p.department, p.name loop
    select count(*), count(*) filter (where clinic_reception.has_provider_service_scope(r.id, s.code, d)),
           string_agg(s.name, '، ') filter (where not clinic_reception.has_provider_service_scope(r.id, s.code, d))
      into tot, okn, bad from clinic_reception.services s where s.workspace_id = ws and s.active and s.department = 'جسم وتخسيس';
    insert into bs_live(step, expected, actual, ok) values (r.name || ' (' || r.department || ')', '12 / 12 bookable', okn || ' / ' || tot || coalesce(' — missing: ' || bad, ''), okn = 12 and tot = 12);
  end loop;
  insert into bs_live(step, expected, actual, ok)
    select 'nutrition consults stay closed to ' || p.name, 'not bookable', string_agg(s.code, ', ') filter (where clinic_reception.has_provider_service_scope(p.id, s.code, d)),
           not bool_or(clinic_reception.has_provider_service_scope(p.id, s.code, d))
      from clinic_reception.providers p cross join clinic_reception.services s
     where p.workspace_id = ws and p.active and p.department in ('العلاج الطبيعي', 'الجلدية والتجميل') and s.workspace_id = ws and s.active and s.code in ('0001388', '0001389', '0001397')
     group by p.name;
end $$;
select step, expected, actual, ok from bs_live order by n;
rollback;
