-- Rollback of 20261115200000_hr_shift_swaps.sql.
-- Restores attendance_eval exactly as in 20261113100000 (no swap overrides) and drops the swap objects.
-- WARNING: drops every swap request and per-day override. Export first if swaps were entered:
--   copy (select * from clinic_people.shift_swaps) to ... ; copy (select * from clinic_people.shift_overrides) to ... ;
-- The clinic_people.audit rows (actions 'shift_swap_*') and the swap notifications are kept on purpose.
begin;
create or replace function clinic_people.attendance_eval(p_day date, p_now timestamptz default now())
returns table(person_id uuid, template_id uuid, template_name text, color text, grace integer, exp_start timestamptz, exp_end timestamptz,
  device_user_id integer, first_in timestamptz, status text, late_min integer, since_start integer, excused boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with pat as (
    select distinct on (ps.person_id) ps.person_id, ps.template_id
    from clinic_people.person_shifts ps
    join clinic_people.people p on p.id = ps.person_id and p.status <> 'ended' and p.kind <> 'doctor'
    where ps.dow = extract(dow from p_day)::int and ps.valid_from <= p_day and (ps.valid_to is null or ps.valid_to >= p_day)
    order by ps.person_id, ps.valid_from desc, ps.id desc),
  sched as (
    select pat.person_id, t.id as template_id, t.name as template_name, t.color, t.grace_minutes as grace,
      ((p_day + t.start_time) at time zone 'Africa/Cairo') as exp_start,
      ((p_day + t.end_time + case when t.end_time <= t.start_time then interval '1 day' else interval '0' end) at time zone 'Africa/Cairo') as exp_end
    from pat join clinic_people.shift_templates t on t.id = pat.template_id),
  joined as (
    select s.*, m.device_user_id,
      (select min(d.ts) from clinic_people.device_punches d
        where d.device_id = m.device_id and d.device_user_id = m.device_user_id and d.punch in (0, 3, 4)
          and d.ts between s.exp_start - interval '3 hours' and s.exp_end) as first_in
    from sched s left join clinic_people.device_user_map m on m.person_id = s.person_id),
  lv as (
    select r.person_id, bool_or(r.kind = 'leave') as leave, bool_or(r.kind = 'permission') as perm
    from clinic_people.requests r
    where r.status = 'approved' and r.kind in ('leave', 'permission') and p_day between r.from_date and r.to_date
    group by r.person_id)
  select j.person_id, j.template_id, j.template_name, j.color, j.grace, j.exp_start, j.exp_end, j.device_user_id, j.first_in,
    case
      when coalesce(lv.leave, false) then 'leave'
      when j.device_user_id is null then 'unmapped'
      when j.first_in is not null then case when j.first_in > j.exp_start + make_interval(mins => j.grace) then 'late' else 'on_time' end
      when p_now < j.exp_start then 'upcoming'
      when p_now <= j.exp_start + make_interval(mins => j.grace) then 'waiting'
      else 'absent' end,
    case when j.first_in is not null and j.first_in > j.exp_start then floor(extract(epoch from (j.first_in - j.exp_start)) / 60)::integer else 0 end,
    case when p_now > j.exp_start then floor(extract(epoch from (p_now - j.exp_start)) / 60)::integer else null end,
    coalesce(lv.perm, false)
  from joined j left join lv on lv.person_id = j.person_id
$$;
revoke all on function clinic_people.attendance_eval(date, timestamptz) from public, anon, authenticated;
drop function if exists public.hr_shift_swaps_list();
drop function if exists public.hr_shift_swap_command(text, jsonb);
drop function if exists clinic_people.swap_notify(uuid, text);
drop function if exists clinic_people.swap_conflict(clinic_people.shift_swaps);
drop function if exists clinic_people.swap_plan(clinic_people.shift_swaps);
drop function if exists clinic_people.weekly_slot(uuid, date);
drop table if exists clinic_people.shift_overrides;
drop table if exists clinic_people.shift_swaps;
commit;
