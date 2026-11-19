-- Reports: «حالاتي اليوم» — a doctor's own cases for today. Read-only.
-- Shows only appointments of the doctor linked to the caller (clinic_people.people.admin_id → doctor_key → providers.doctor_key),
-- today (Cairo) only, live workspaces only, sandbox excluded. No amounts, no phone, no medical data.
-- Super admin / general manager may preview any doctor and any day (to check the screen); nobody else can widen it.
begin;

insert into public.report_registry(code, title, area, sort, sensitive) values
  ('doctor_day', 'حالاتي اليوم', 'doctors', 5, false);

-- Doctor keys linked to the caller. Internal helper (not granted).
create function public.report_my_doctor_keys() returns setof text
language sql stable security definer set search_path = pg_catalog, public as $$
  select distinct p.doctor_key from clinic_people.people p
   where p.admin_id = public.my_admin_id() and nullif(btrim(p.doctor_key), '') is not null
$$;
revoke all on function public.report_my_doctor_keys() from public, anon, authenticated;

-- The gate learns one rule: a linked doctor may open «doctor_day» (and only that report) without an access row.
create or replace function public.report_allowed(p_code text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and exists (select 1 from public.report_registry g where g.code = p_code and g.active) and (
    public.is_super()
    or (p_code = 'doctor_day' and exists (select 1 from public.report_my_doctor_keys()))
    or (
      exists (select 1 from public.report_access a
               where a.report_code = p_code
                 and (a.admin_id = public.my_admin_id() or (a.role is not null and public.has_role(a.role))))
      and (not (select g.sensitive from public.report_registry g where g.code = p_code)
           or public.has_role('general_manager') or public.has_role('financial_manager'))
    ))
$$;

insert into public.report_access(report_code, role) values ('doctor_day', 'general_manager');

create function public.report_doctor_day(p_day date default null, p_doctor_key text default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_preview boolean := public.is_super() or public.has_role('general_manager');
  v_keys text[];
  v_day date;
  v jsonb;
begin
  perform public.report_require('doctor_day');
  if v_preview and nullif(btrim(p_doctor_key), '') is not null then
    v_keys := array[btrim(p_doctor_key)];
    v_day := coalesce(p_day, v_today);
  else
    select coalesce(array_agg(k.k), '{}') into v_keys from public.report_my_doctor_keys() k(k);
    v_day := case when v_preview then coalesce(p_day, v_today) else v_today end;   -- a doctor always sees today only
  end if;

  with ap as (
    select a.id, a.starts_at, a.status, a.arrived_at, pt.name patient, pt.file_no, s.name service, pr.name doctor,
           vs.opened_at, vs.closed_at, vs.status visit_status
      from clinic_reception.appointments a
      join public.report_workspaces(null) w on w.workspace_id = a.workspace_id
      join clinic_reception.providers pr on pr.id = a.provider_id
      join clinic_reception.patients pt on pt.id = a.patient_id
      join clinic_reception.services s on s.id = a.service_id
      left join clinic_reception.visits vs on vs.appointment_id = a.id
     where pr.doctor_key = any(v_keys)
       and (a.starts_at at time zone 'Africa/Cairo')::date = v_day
       and a.status <> 'cancelled' and coalesce(a.source, '') <> 'sandbox'),
  x as (
    select ap.*, case
             when ap.status = 'no_show' then 'no_show'
             when ap.visit_status = 'completed' or ap.status = 'completed' then 'done'
             when ap.opened_at is not null then 'in_visit'
             when ap.status = 'arrived' then 'waiting'
             else 'booked' end state
      from ap)
  select jsonb_build_object(
    'day', v_day,
    'mode', case when v_preview then 'preview' else 'doctor' end,
    'linked', coalesce(array_length(v_keys, 1), 0) > 0,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
              'time', to_char(x.starts_at at time zone 'Africa/Cairo', 'HH24:MI'), 'patient', x.patient, 'file_no', x.file_no,
              'service', x.service, 'doctor', x.doctor, 'state', x.state,
              'arrived', to_char(x.arrived_at at time zone 'Africa/Cairo', 'HH24:MI'),
              'wait_min', case when x.arrived_at is not null then round(extract(epoch from coalesce(x.opened_at, now()) - x.arrived_at) / 60)::int end)
              order by x.starts_at) from x), '[]'::jsonb),
    'totals', (select jsonb_build_object('patients', count(*), 'waiting', count(*) filter (where x.state = 'waiting'),
              'in_visit', count(*) filter (where x.state = 'in_visit'), 'done', count(*) filter (where x.state = 'done'),
              'booked', count(*) filter (where x.state = 'booked'), 'no_show', count(*) filter (where x.state = 'no_show')) from x),
    'options', case when v_preview then jsonb_build_object('doctors', coalesce((
              select jsonb_agg(jsonb_build_object('key', d.doctor_key, 'name', d.name) order by d.name)
                from (select distinct on (pr.doctor_key) pr.doctor_key, pr.name from clinic_reception.providers pr
                        join public.report_workspaces(null) w on w.workspace_id = pr.workspace_id
                       where pr.active and nullif(btrim(pr.doctor_key), '') is not null order by pr.doctor_key, pr.name) d), '[]'::jsonb))
              else '{}'::jsonb end)
    into v;
  return v;
end $$;

revoke all on function public.report_doctor_day(date, text) from public, anon;
grant execute on function public.report_doctor_day(date, text) to authenticated;

commit;
