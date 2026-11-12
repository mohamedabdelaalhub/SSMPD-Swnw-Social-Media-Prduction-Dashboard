-- Live presence: connection heartbeat. The agent on the center laptop pings the server every minute even when nobody punched, so the screen can tell
-- "the link is alive, there are just no new punches" apart from "the link is down". Before this, «آخر استلام» only moved when a punch arrived and showed a false stale warning.
-- ADDITIVE: 1 new table (RLS on, no direct grants) + hr_presence_snapshot gains one key ('last_seen_at'); same signature, nothing else changes.
-- Rollback: supabase/rollbacks/20261112110000_live_presence_heartbeat.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_people.device_punches') is null then raise exception 'طبّق live_presence أولًا'; end if;
  if to_regclass('clinic_people.device_feed') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_people.device_feed(
  device_id text primary key check (device_id ~ '^[A-Za-z0-9_.-]{1,40}$'),
  last_seen_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table clinic_people.device_feed enable row level security;
revoke all on clinic_people.device_feed from public, anon, authenticated;

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
      from clinic_people.people p where p.status <> 'ended'),
    'rows', (
      with recent as (
        select device_id, device_user_id,
          (array_agg(punch order by ts desc))[1] as last_punch,
          max(ts) as last_punch_at,
          max(ts) filter (where punch in (0, 3, 4)) as last_in_at,
          max(ts) filter (where punch in (1, 5)) as last_out_at,
          count(*) as punches
        from clinic_people.device_punches
        where ts >= now() - make_interval(hours => lb)
        group by device_id, device_user_id),
      known as (
        select m.device_id, m.device_user_id, m.person_id from clinic_people.device_user_map m
        join clinic_people.people p on p.id = m.person_id and p.status <> 'ended'),
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

commit;
