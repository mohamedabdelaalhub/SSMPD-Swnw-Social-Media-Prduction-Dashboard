-- «التغذية والتخسيس» body services bookable by every physio and cosmetic doctor (owner «موافق» 2026-11-23, relayed by the price-mapping
-- chat / main chat 4): ALL physio doctors book the 12 services (11 body / cosmetic + INBODY), cosmetic doctors book them too.
-- Owner 2026-11-23: use the EXISTING booking department «التغذية والتخسيس» («ما هي تغذية وتخسيس يا علاج طبيعي») — no new name.
-- The 12 get booking_department «التغذية والتخسيس» (INBODY already has it); every active physio (العلاج الطبيعي) and cosmetic
-- (الجلدية والتجميل) provider, plus named physio doctors with another main department (د. سما نبيل عارف), gets «التغذية والتخسيس» as an
-- extra department (clinic_reception.provider_departments). This also opens the 3 nutrition consults (0001388 / 0001389 / 0001397) to them —
-- the owner was told and accepted. Source of truth = public.pricing_services.booking_department, then clinic_reception.sync_catalog().
-- The 12 = an explicit list of pricing_services ids (main chat 4, captured from the live apply); the file stops unless all 12 have a booking code.
-- Self-contained and idempotent; dry-run with ROLLBACK first and read the NOTICEs.
begin;
do $$
declare ws uuid; n int; r record; dept constant text := 'التغذية والتخسيس'; codes text[]; extra_names text[] := array['سما نبيل'];
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if ws is null then raise exception 'no live reception workspace'; end if;
  if to_regclass('clinic_reception.provider_departments') is null then raise exception 'apply 20261121170000_reception_lab_units first'; end if;

  -- the 12: pricing rows whose section / category is «التغذية والتخسيس», bookable, not the 3 nutrition consults
  -- the 12 (explicit pricing_services ids from the live apply at 21:13Z; INBODY = ebae4501…)
  select array_agg(ps.booking_code order by ps.booking_code) into codes from public.pricing_services ps
   where ps.id = any(array['512bc9ed-cf76-43a6-9673-1dcef7b976b4', 'b54865b4-324e-4bdc-85fd-d1be349b69e4', 'd8e5a46e-b23c-42d0-85b1-0c9c7b124ccf', 'ebae4501-a32d-4096-be3d-3e46dbc8ae15', '2f364296-4623-49a3-a843-43ee64c9e598', 'd09df168-af96-415a-99bd-bcd3999751f3', 'c361d97e-72d2-4a05-a00d-0a278dd5f00f', '78362136-0c50-4e13-95f6-6029089c0804', '4fdcd8a6-adf1-434b-b745-e9a8214f70b8', 'ffdf373a-acdf-4e49-bb64-6f522b462995', 'ac9798ca-467b-4626-b3b1-b3f5f26e37b3', 'b7f08ca4-4553-4bd1-b52d-7986d2989029']::uuid[]) and coalesce(ps.booking_code, '') <> '';
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
              and (p.department in ('العلاج الطبيعي', 'الجلدية والتجميل')
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
end $$;
commit;
