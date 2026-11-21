-- «المعمل» as a booking provider (owner bug 2026-11-21; needs migration 20261121170000_reception_lab_units applied first).
-- Template: «التمريض المنزلي» (provider row + weekly_slots). No doctor_key: the lab books by the department rule, which needs
-- no doctor contract; «باقي التحاليل» is added as an extra department. Self-contained; dry-run with ROLLBACK first.
-- EDIT BEFORE RUNNING (owner answers): lab_capacity (patients at the same time) and the hours below.
begin;
do $$
declare
  ws uuid; lab uuid; me uuid; d int;
  lab_capacity int := 3;                 -- ← owner: how many patients at the same time
  open_at time := '08:00'; close_at time := '23:59';   -- ← owner: lab hours (center hours by default)
  open_days int[] := array[0,1,2,3,4,5,6];             -- ← owner: 0 = Sunday … 6 = Saturday
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if ws is null then raise exception 'no live reception workspace'; end if;
  select id into me from public.admins where role = 'super_admin' and active order by created_at limit 1;
  if to_regclass('clinic_reception.provider_departments') is null then raise exception 'apply 20261121170000_reception_lab_units first'; end if;
  select id into lab from clinic_reception.providers where workspace_id = ws and name = 'المعمل';
  if lab is null then
    insert into clinic_reception.providers(workspace_id, name, doctor_key, department, branch, active, capacity)
      values (ws, 'المعمل', null, 'التحاليل', 'حدائق الأهرام', true, lab_capacity) returning id into lab;
  else
    update clinic_reception.providers set department = 'التحاليل', active = true, capacity = lab_capacity where id = lab;
  end if;
  insert into clinic_reception.provider_departments(provider_id, department) values (lab, 'باقي التحاليل') on conflict do nothing;
  delete from clinic_reception.weekly_slots where provider_id = lab;
  foreach d in array open_days loop
    insert into clinic_reception.weekly_slots(workspace_id, provider_id, dow, starts, ends, created_by) values (ws, lab, d, open_at, close_at, me);
  end loop;
  perform clinic_reception.weekly_generate(ws, lab, 28);
  raise notice 'lab provider %, capacity %, departments %, weekly rows %, availability rows (next 28 days) %',
    lab, lab_capacity,
    (select array_agg(x) from (select 'التحاليل' x union all select department from clinic_reception.provider_departments where provider_id = lab) q),
    (select count(*) from clinic_reception.weekly_slots where provider_id = lab),
    (select count(*) from clinic_reception.availability where provider_id = lab and ends_at > now());
  raise notice 'lab services: التحاليل %, باقي التحاليل %',
    (select count(*) from clinic_reception.services where workspace_id = ws and active and department = 'التحاليل'),
    (select count(*) from clinic_reception.services where workspace_id = ws and active and department = 'باقي التحاليل');
end $$;
commit;
