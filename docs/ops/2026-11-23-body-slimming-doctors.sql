-- «نحت وتنسيق القوام»: a dedicated booking department for the 12 body / slimming services (owner 2026-11-23 21:27Z, price-mapping
-- chat, «اقتراحك افضل من اقتراح الشات الرئيسي»; relayed by main chat 4). Replaces the earlier «التغذية والتخسيس» / «جسم وتخسيس» drafts.
--   (a) booking_department = «نحت وتنسيق القوام» on exactly the 12: INBODY 0001215 + 0001216 … 0001226 (pricing category unchanged).
--   (b) «نحت وتنسيق القوام» as an EXTRA department (clinic_reception.provider_departments) for 7 named doctors only:
--       physio د. سما نبيل + د. يحيى زكريا; cosmetic خلود شلتوت، أحمد سمير، أمنية السيد، شادي حسام عبد الفتاح، شيماء خليفة علي.
--   (c) Nobody gains «التغذية والتخسيس» here (د. يحيى keeps his own; the 3 nutrition consults stay as they are).
--   (d) No home doctor is needed: the booking list takes departments from the services, and a doctor's extra department puts its
--       services in his scope (has_provider_service_scope + snapshot provider_service_scopes, 20261121170000).
-- A doctor name that matches no active provider is reported (NOTICE «missing») and skipped — register him first; a name that matches
-- two providers stops the file. Self-contained and idempotent; dry-run with ROLLBACK first and read the NOTICEs.
begin;
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
commit;
