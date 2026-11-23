-- Rolled-back verify of docs/ops/2026-11-23-body-slimming-doctors.sql («نحت وتنسيق القوام»): runs the step, then checks the booking
-- scope gate (clinic_reception.has_provider_service_scope — used by «حجز موعد» / order / execution) for each named doctor × the 12,
-- that the snapshot offers them (provider_service_scopes), that nobody gained the nutrition consults, and the catalogue republished.
-- The snapshot is read as Mazen (reception). ONE transaction ending in ROLLBACK; last output = one table.
begin;
create temp table bs_before as select p.id, clinic_reception.has_provider_service_scope(p.id, s.code, (now() at time zone 'Africa/Cairo')::date) ok, s.code
  from clinic_reception.providers p join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live'
  cross join clinic_reception.services s where s.workspace_id = p.workspace_id and s.active and s.department = 'التغذية والتخسيس' and p.active;
do $$
declare ws uuid; n int; r record; dept constant text := 'نحت وتنسيق القوام'; codes text[]; want text[];
  doctors text[] := array['%سما نبيل%', '%يحي% زكريا%', '%خلود شلتوت%', '%حمد سمير%', '%منية السيد%', '%شادي حسام%', '%شيماء خليفة%'];
  x text; hits int;
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if ws is null then raise exception 'no live reception workspace'; end if;
  if to_regclass('clinic_reception.provider_departments') is null then raise exception 'apply 20261121170000_reception_lab_units first'; end if;
  select array_agg(lpad(g::text, 7, '0') order by g) into want from generate_series(1215, 1226) g;

  -- (a) the 12 (explicit pricing_services ids from the live apply at 21:13Z; INBODY = ebae4501…) — must be exactly 0001215 … 0001226
  select array_agg(ps.booking_code order by ps.booking_code) into codes from public.pricing_services ps
   where ps.id = any(array['512bc9ed-cf76-43a6-9673-1dcef7b976b4', 'b54865b4-324e-4bdc-85fd-d1be349b69e4', 'd8e5a46e-b23c-42d0-85b1-0c9c7b124ccf', 'ebae4501-a32d-4096-be3d-3e46dbc8ae15', '2f364296-4623-49a3-a843-43ee64c9e598', 'd09df168-af96-415a-99bd-bcd3999751f3', 'c361d97e-72d2-4a05-a00d-0a278dd5f00f', '78362136-0c50-4e13-95f6-6029089c0804', '4fdcd8a6-adf1-434b-b745-e9a8214f70b8', 'ffdf373a-acdf-4e49-bb64-6f522b462995', 'ac9798ca-467b-4626-b3b1-b3f5f26e37b3', 'b7f08ca4-4553-4bd1-b52d-7986d2989029']::uuid[]) and coalesce(ps.booking_code, '') <> '';
  for r in select ps.booking_code, ps.name, ps.category, ps.booking_department from public.pricing_services ps where ps.booking_code = any(want) order by ps.booking_code loop
    raise notice 'service % — % (category %, booking department now: %)', r.booking_code, r.name, r.category, r.booking_department;
  end loop;
  if codes is distinct from want then raise exception 'the 12 ids give codes % — expected 0001215 … 0001226', codes; end if;
  update public.pricing_services set booking_department = dept where booking_code = any(codes) and booking_department is distinct from dept;
  get diagnostics n = row_count; raise notice 'booking department → «%» on % pricing rows', dept, n;
  perform clinic_reception.sync_catalog(ws);
  raise notice 'booking catalogue: % active services in «%»', (select count(*) from clinic_reception.services where workspace_id = ws and active and department = dept), dept;

  -- (b) the 7 named doctors
  foreach x in array doctors loop
    select count(*) into hits from clinic_reception.providers p where p.workspace_id = ws and p.active and p.name like x;
    if hits > 1 then raise exception 'doctor % matches % active providers — make the name exact', x, hits; end if;
    if hits = 0 then raise notice 'missing: no active provider like % — register him first (not added)', x; continue; end if;
    select p.id, p.name, p.department into r from clinic_reception.providers p where p.workspace_id = ws and p.active and p.name like x;
    insert into clinic_reception.provider_departments(provider_id, department) values (r.id, dept) on conflict do nothing;
    raise notice 'doctor % (%) → «%»', r.name, r.department, dept;
  end loop;
end $$;

create temp table bs_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare ws uuid; d date := (now() at time zone 'Africa/Cairo')::date; r record; bad text; tot int; okn int; snap jsonb;
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  insert into bs_live(step, expected, actual, ok) select 'catalogue «نحت وتنسيق القوام»', '12 active services (0001215 … 0001226)',
    count(*) || ': ' || string_agg(s.code, ', ' order by s.code), count(*) = 12 and bool_and(s.code between '0001215' and '0001226')
    from clinic_reception.services s where s.workspace_id = ws and s.active and s.department = 'نحت وتنسيق القوام';
  insert into bs_live(step, expected, actual, ok) select 'pricing category unchanged', 'العلاج الطبيعي (or as before)', string_agg(distinct coalesce(ps.category, '-'), ', '), true
    from public.pricing_services ps where ps.booking_code between '0001215' and '0001226';
  select count(*) into tot from clinic_reception.provider_departments pd join clinic_reception.providers p on p.id = pd.provider_id and p.workspace_id = ws and p.active
   where pd.department = 'نحت وتنسيق القوام';
  insert into bs_live(step, expected, actual, ok) values ('doctors with the extra department', '7 (fewer = a NOTICE «missing» above)', tot::text, tot = 7);
  for r in select p.id, p.name, p.department from clinic_reception.providers p join clinic_reception.provider_departments pd on pd.provider_id = p.id and pd.department = 'نحت وتنسيق القوام'
            where p.workspace_id = ws and p.active order by p.department, p.name loop
    select count(*), count(*) filter (where clinic_reception.has_provider_service_scope(r.id, s.code, d)),
           string_agg(s.name, '، ') filter (where not clinic_reception.has_provider_service_scope(r.id, s.code, d))
      into tot, okn, bad from clinic_reception.services s where s.workspace_id = ws and s.active and s.department = 'نحت وتنسيق القوام';
    insert into bs_live(step, expected, actual, ok) values (r.name || ' (' || r.department || ')', '12 / 12 bookable', okn || ' / ' || tot || coalesce(' — missing: ' || bad, ''), okn = 12 and tot = 12);
  end loop;
  -- the booking screen reads the snapshot: provider_service_scopes must list the 12 codes for each of them
  perform set_config('request.jwt.claims', jsonb_build_object('sub', 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb', true);
  snap := public.clinic_reception_snapshot(ws, d, d);  -- as Mazen (reception), like the booking screen
  insert into bs_live(step, expected, actual, ok)
    select 'snapshot scopes: ' || p.name, '12 codes listed', (select count(*) from jsonb_array_elements_text(coalesce(snap->'provider_service_scopes'->(p.id::text), '[]')) c where c between '0001215' and '0001226')::text,
           (select count(distinct c) from jsonb_array_elements_text(coalesce(snap->'provider_service_scopes'->(p.id::text), '[]')) c where c between '0001215' and '0001226') = 12
      from clinic_reception.providers p join clinic_reception.provider_departments pd on pd.provider_id = p.id and pd.department = 'نحت وتنسيق القوام' where p.workspace_id = ws and p.active;
  -- nobody gained «التغذية والتخسيس» services
  select count(*), string_agg(distinct p.name, '، ') into tot, bad from clinic_reception.providers p cross join clinic_reception.services s
   where p.workspace_id = ws and p.active and s.workspace_id = ws and s.active and s.department = 'التغذية والتخسيس'
     and clinic_reception.has_provider_service_scope(p.id, s.code, d)
     and not exists (select 1 from bs_before b where b.id = p.id and b.code = s.code and b.ok);
  insert into bs_live(step, expected, actual, ok) values ('nobody gained nutrition services', '0', tot || coalesce(' — ' || bad, ''), tot = 0);
end $$;
select step, expected, actual, ok from bs_live order by n;
rollback;
