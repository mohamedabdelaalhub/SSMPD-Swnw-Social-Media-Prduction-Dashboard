-- Live presence: administrative staff only (owner decision 2026-11-12: no attendance for doctors).
-- * hr_presence_snapshot offers only non-doctor people (nursing, reception, management, customer service, managers, accountants...).
-- * hr_presence_map refuses a doctor.
-- * New table device_user_ignore + hr_presence_ignore(): a device number marked "ignored" disappears from the live screen (its punches stay stored, nothing is deleted).
-- ADDITIVE: 1 new table (RLS on, no direct grants), 1 new function, hr_presence_snapshot / hr_presence_map replaced with the same signatures.
-- Rollback: supabase/rollbacks/20261112120000_live_presence_admin_staff_only.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_people.device_feed') is null then raise exception 'طبّق live_presence_heartbeat أولًا'; end if;
  if to_regclass('clinic_people.device_user_ignore') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_people.device_user_ignore(
  device_id text not null check (device_id ~ '^[A-Za-z0-9_.-]{1,40}$'),
  device_user_id integer not null check (device_user_id > 0),
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  primary key (device_id, device_user_id)
);
alter table clinic_people.device_user_ignore enable row level security;
revoke all on clinic_people.device_user_ignore from public, anon, authenticated;

create or replace function public.hr_presence_snapshot(p_lookback_hours integer default 16) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare lb integer := least(greatest(coalesce(p_lookback_hours, 16), 1), 48);
begin
  if public.my_admin_id() is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  return jsonb_build_object(
    'can_manage', true,
    'now', now(),
    'lookback_hours', lb,
    'last_received_at', (select max(received_at) from clinic_people.device_punches),
    'last_seen_at', (select max(last_seen_at) from clinic_people.device_feed),
    'last_punch_at', (select max(ts) from clinic_people.device_punches),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'full_name', p.full_name, 'department', p.department) order by p.full_name), '[]'::jsonb)
      from clinic_people.people p where p.status <> 'ended' and p.kind <> 'doctor'),
    'ignored', (select coalesce(jsonb_agg(jsonb_build_object('device_id', i.device_id, 'device_user_id', i.device_user_id,
        'last_punch_at', (select max(d.ts) from clinic_people.device_punches d where d.device_id = i.device_id and d.device_user_id = i.device_user_id)) order by i.device_user_id), '[]'::jsonb)
      from clinic_people.device_user_ignore i),
    'rows', (
      with recent as (
        select d.device_id, d.device_user_id,
          (array_agg(d.punch order by d.ts desc))[1] as last_punch,
          max(d.ts) as last_punch_at,
          max(d.ts) filter (where d.punch in (0, 3, 4)) as last_in_at,
          max(d.ts) filter (where d.punch in (1, 5)) as last_out_at,
          count(*) as punches
        from clinic_people.device_punches d
        where d.ts >= now() - make_interval(hours => lb)
          and not exists (select 1 from clinic_people.device_user_ignore i where i.device_id = d.device_id and i.device_user_id = d.device_user_id)
        group by d.device_id, d.device_user_id),
      known as (
        select m.device_id, m.device_user_id, m.person_id from clinic_people.device_user_map m
        join clinic_people.people p on p.id = m.person_id and p.status <> 'ended' and p.kind <> 'doctor'
        where not exists (select 1 from clinic_people.device_user_ignore i where i.device_id = m.device_id and i.device_user_id = m.device_user_id)),
      joined as (
        select coalesce(k.device_id, r.device_id) as device_id, coalesce(k.device_user_id, r.device_user_id) as device_user_id, k.person_id,
          r.last_punch, r.last_punch_at, r.last_in_at, r.last_out_at, coalesce(r.punches, 0) as punches
        from known k full join recent r on r.device_id = k.device_id and r.device_user_id = k.device_user_id)
      select coalesce(jsonb_agg(jsonb_build_object(
        'device_id', j.device_id, 'device_user_id', j.device_user_id, 'person_id', j.person_id,
        'mapped', j.person_id is not null, 'full_name', p.full_name, 'code', p.code, 'department', p.department, 'job_title', p.job_title,
        'state', case when j.last_punch is null then 'none' when j.last_punch in (0, 3, 4) then 'in' when j.last_punch = 2 then 'break' else 'out' end,
        'last_punch', j.last_punch, 'last_punch_at', j.last_punch_at, 'last_in_at', j.last_in_at, 'last_out_at', j.last_out_at, 'punches', j.punches,
        'minutes_since', case when j.last_punch_at is null then null else floor(extract(epoch from (now() - j.last_punch_at)) / 60)::integer end
      ) order by (j.last_punch in (0, 3, 4)) desc nulls last, j.last_punch_at desc nulls last, p.full_name), '[]'::jsonb)
      from joined j left join clinic_people.people p on p.id = j.person_id)
  );
end $$;

create or replace function public.hr_presence_map(p_device_id text, p_device_user_id integer, p_person_id uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  if coalesce(p_device_id, '') !~ '^[A-Za-z0-9_.-]{1,40}$' or coalesce(p_device_user_id, 0) <= 0 then raise exception 'راجع رقم الجهاز والموظف'; end if;
  perform pg_advisory_xact_lock(712251112);
  if p_person_id is null then
    delete from clinic_people.device_user_map where device_id = p_device_id and device_user_id = p_device_user_id;
    return;
  end if;
  if not exists (select 1 from clinic_people.people where id = p_person_id and status <> 'ended') then raise exception 'اختر موظفًا مستمرًا'; end if;
  if exists (select 1 from clinic_people.people where id = p_person_id and kind = 'doctor') then raise exception 'الحضور اللحظي للموظفين الإداريين فقط'; end if;
  delete from clinic_people.device_user_ignore where device_id = p_device_id and device_user_id = p_device_user_id;
  delete from clinic_people.device_user_map where device_id = p_device_id and person_id = p_person_id and device_user_id <> p_device_user_id;
  insert into clinic_people.device_user_map(device_id, device_user_id, person_id, created_by) values (p_device_id, p_device_user_id, p_person_id, me)
    on conflict (device_id, device_user_id) do update set person_id = excluded.person_id, created_by = excluded.created_by, created_at = now();
  insert into clinic_people.audit(actor_id, action, record_id, after_data)
    values (me, 'presence_map', p_person_id, jsonb_build_object('device_id', p_device_id, 'device_user_id', p_device_user_id));
end $$;

create function public.hr_presence_ignore(p_device_id text, p_device_user_id integer, p_ignore boolean) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  if coalesce(p_device_id, '') !~ '^[A-Za-z0-9_.-]{1,40}$' or coalesce(p_device_user_id, 0) <= 0 or p_ignore is null then raise exception 'راجع رقم الجهاز'; end if;
  perform pg_advisory_xact_lock(712251112);
  if p_ignore then
    delete from clinic_people.device_user_map where device_id = p_device_id and device_user_id = p_device_user_id;
    insert into clinic_people.device_user_ignore(device_id, device_user_id, created_by) values (p_device_id, p_device_user_id, me) on conflict do nothing;
  else
    delete from clinic_people.device_user_ignore where device_id = p_device_id and device_user_id = p_device_user_id;
  end if;
  insert into clinic_people.audit(actor_id, action, record_id, after_data)
    values (me, case when p_ignore then 'presence_ignore' else 'presence_unignore' end, gen_random_uuid(), jsonb_build_object('device_id', p_device_id, 'device_user_id', p_device_user_id));
end $$;

revoke all on function public.hr_presence_ignore(text, integer, boolean) from public, anon;
grant execute on function public.hr_presence_ignore(text, integer, boolean) to authenticated;

commit;
