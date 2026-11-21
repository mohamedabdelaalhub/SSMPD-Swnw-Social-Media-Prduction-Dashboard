-- «المعمل» and in-center «التمريض» as booking providers (owner bugs 2026-11-21: «معمل» not found; «مافيش خدمات تمريضية
-- علشان نقدر نسجل اي حاجة تبع التمريض»). Needs migration 20261121170000_reception_lab_units applied first.
-- Template: «التمريض المنزلي» (provider row, no contract, + weekly_slots; hours copied from it = center hours).
-- Owner: lab hours = center hours; the lab takes a sample «كل ٥ دقايق» → capacity 1, no gap, lab services 5 minutes.
-- Self-contained and idempotent; dry-run with ROLLBACK first and read the NOTICEs.
begin;
do $$
declare
  ws uuid; me uuid; home uuid; lab uuid; nur uuid; nur_dept text; n int;
  lab_minutes int := 5;          -- owner: «كل ٥ دقايق»
  nurse_capacity int := 1;       -- ← owner: nurses on shift who can work at the same time (1 = one patient at a time)
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if ws is null then raise exception 'no live reception workspace'; end if;
  if to_regclass('clinic_reception.provider_departments') is null then raise exception 'apply 20261121170000_reception_lab_units first'; end if;
  select id into me from public.admins where role = 'super_admin' and active order by created_at limit 1;
  select id into home from clinic_reception.providers where workspace_id = ws and department = 'التمريض المنزلي' and active
    and exists (select 1 from clinic_reception.weekly_slots w where w.provider_id = providers.id) order by name limit 1;
  raise notice 'hours template (التمريض المنزلي): % with % weekly rows', home, (select count(*) from clinic_reception.weekly_slots where provider_id = home);

  -- «المعمل»
  select id into lab from clinic_reception.providers where workspace_id = ws and name = 'المعمل';
  if lab is null then
    insert into clinic_reception.providers(workspace_id, name, doctor_key, department, branch, active, capacity, booking_gap)
      values (ws, 'المعمل', null, 'التحاليل', 'حدائق الأهرام', true, 1, false) returning id into lab;
  else
    update clinic_reception.providers set department = 'التحاليل', active = true, capacity = 1, booking_gap = false where id = lab;
  end if;
  insert into clinic_reception.provider_departments(provider_id, department) values (lab, 'باقي التحاليل') on conflict do nothing;
  update clinic_reception.services set minutes = lab_minutes
   where workspace_id = ws and active and department in ('التحاليل', 'باقي التحاليل') and minutes <> lab_minutes;
  get diagnostics n = row_count;
  raise notice 'lab %: services التحاليل %, باقي التحاليل %, minutes set to % on % services', lab,
    (select count(*) from clinic_reception.services where workspace_id = ws and active and department = 'التحاليل'),
    (select count(*) from clinic_reception.services where workspace_id = ws and active and department = 'باقي التحاليل'), lab_minutes, n;

  -- in-center «التمريض»: the department in-center nursing services already use
  select department into nur_dept from clinic_reception.services
   where workspace_id = ws and active and department is not null and department <> 'التمريض المنزلي'
     and name ~ '(حقن|كانيولا|كانولا|غيار|جرح|جروح|محلول|قياس|نيبولايزر|جلسة بخار)' and name !~ 'منزل'
   group by department order by count(*) desc limit 1;
  if nur_dept is null then raise exception 'no in-center nursing services found (حقن/كانيولا/غيار…) — check names'; end if;
  raise notice 'in-center nursing department: «%» (% active services); other departments with such names: %', nur_dept,
    (select count(*) from clinic_reception.services where workspace_id = ws and active and department = nur_dept),
    (select string_agg(department || ' ' || c, ', ') from (select department, count(*) c from clinic_reception.services
       where workspace_id = ws and active and department is distinct from nur_dept and department <> 'التمريض المنزلي'
         and name ~ '(حقن|كانيولا|كانولا|غيار|جرح|جروح|محلول)' and name !~ 'منزل' group by department) q);
  select id into nur from clinic_reception.providers where workspace_id = ws and name = 'التمريض';
  if nur is null then
    insert into clinic_reception.providers(workspace_id, name, doctor_key, department, branch, active, capacity)
      values (ws, 'التمريض', null, nur_dept, 'حدائق الأهرام', true, nurse_capacity) returning id into nur;
  else
    update clinic_reception.providers set department = nur_dept, active = true, capacity = nurse_capacity where id = nur;
  end if;

  -- center hours for both, copied from «التمريض المنزلي» (fallback 08:00–23:59 every day)
  delete from clinic_reception.weekly_slots where provider_id in (lab, nur);
  if home is not null then
    insert into clinic_reception.weekly_slots(workspace_id, provider_id, dow, starts, ends, created_by)
      select ws, p, w.dow, w.starts, w.ends, coalesce(me, w.created_by) from clinic_reception.weekly_slots w, unnest(array[lab, nur]) p where w.provider_id = home;
  else
    insert into clinic_reception.weekly_slots(workspace_id, provider_id, dow, starts, ends, created_by)
      select ws, p, d, '08:00', '23:59', me from generate_series(0, 6) d, unnest(array[lab, nur]) p;
  end if;
  perform clinic_reception.weekly_generate(ws, lab, 28);
  perform clinic_reception.weekly_generate(ws, nur, 28);
  raise notice 'lab weekly %, availability %; nursing % weekly %, availability %',
    (select count(*) from clinic_reception.weekly_slots where provider_id = lab),
    (select count(*) from clinic_reception.availability where provider_id = lab and ends_at > now()), nur,
    (select count(*) from clinic_reception.weekly_slots where provider_id = nur),
    (select count(*) from clinic_reception.availability where provider_id = nur and ends_at > now());
end $$;
commit;
