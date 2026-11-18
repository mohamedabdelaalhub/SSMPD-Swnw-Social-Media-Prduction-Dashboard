-- Owner 2026-11-17: «أول ما موظف الاستقبال يفتح الداشبورد ويبقى باصم حضور أو جه موعد حضور الشفت ييجي يطلعله بوب اب يقوله افتح
-- وردية اليوم» + floating safe icon: orange (open your shift) → green (shift open) → yellow (shift time over, close it);
-- gone after punch-out or closing the shift, back at the next scheduled shift.
-- public.clinic_reception_shift_reminder() — read-only, for the signed-in account only. state:
--   hidden      : not reception / customer_service, no linked HR person, before the shift, leave day, punched out with no
--                 open shift, or today's shift already closed
--   need_open   : punched in today or the scheduled start has come (and the shift hasn't ended), no reception cash shift opened today
--   open        : own reception shift open, opened today, shift time not over and not punched out
--   close_due   : own reception shift still open but the scheduled end passed, the employee punched out, or it has been open for more than 16 hours
--                 (a shift opened at 23:00 is not «stale» just because the date changed at midnight)
-- show (popup) = state need_open. No writes, no other employees' data. Rollback: supabase/rollbacks/20261117210000_reception_shift_reminder.rollback.sql
begin;
create or replace function public.clinic_reception_shift_reminder() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); pid uuid; d date := (now() at time zone 'Africa/Cairo')::date;
  e record; s record; has_e boolean := false; last_in timestamptz; last_out timestamptz; out_now boolean := false; ended boolean := false;
  closed_today boolean;
begin
  if me is null then return jsonb_build_object('show', false, 'state', 'hidden'); end if;
  if not (public.has_role('reception') or public.has_role('customer_service')) then return jsonb_build_object('show', false, 'state', 'hidden'); end if;
  select p.id into pid from clinic_people.people p where p.admin_id = me and p.status <> 'ended' limit 1;
  if pid is null then return jsonb_build_object('show', false, 'state', 'hidden', 'why', 'no_person'); end if;
  select x.first_in, x.exp_start, x.exp_end, x.status into e from clinic_people.attendance_eval(d, now()) x where x.person_id = pid limit 1;
  has_e := found;
  if to_regclass('clinic_people.device_punches') is not null then
    execute 'select max(dp.ts) filter (where dp.punch in (0,3,4)), max(dp.ts) filter (where dp.punch in (1,5))
               from clinic_people.device_punches dp join clinic_people.device_user_map m on m.device_id = dp.device_id and m.device_user_id = dp.device_user_id
              where m.person_id = $1 and dp.ts >= $2' into last_in, last_out using pid, now() - interval '16 hours';
  end if;
  out_now := last_out is not null and (last_in is null or last_out > last_in);
  ended := has_e and e.exp_end is not null and now() >= e.exp_end;
  select sh.opened_at into s from clinic_reception.shifts sh where sh.cashier_id = me and sh.status = 'open' order by sh.opened_at desc limit 1;
  if found then
    return jsonb_build_object('show', false,
      'state', case when s.opened_at < now() - interval '16 hours' or ended or out_now then 'close_due' else 'open' end,
      'reason', case when s.opened_at < now() - interval '16 hours' then 'stale' when out_now then 'punched_out' when ended then 'shift_end' else null end,
      'opened_at', s.opened_at, 'exp_end', case when has_e then e.exp_end end);
  end if;
  closed_today := exists (select 1 from clinic_reception.shifts sh where sh.cashier_id = me and sh.status <> 'open' and sh.opened_at >= now() - interval '16 hours');
  if closed_today or out_now or not has_e or coalesce(e.status, '') = 'leave' or ended
     or not (e.first_in is not null or (e.exp_start is not null and now() >= e.exp_start)) then
    return jsonb_build_object('show', false, 'state', 'hidden',
      'why', case when closed_today then 'closed' when out_now then 'punched_out' when not has_e then 'no_schedule' when e.status = 'leave' then 'leave' when ended then 'ended' else 'not_yet' end,
      'exp_start', case when has_e then e.exp_start end);
  end if;
  return jsonb_build_object('show', true, 'state', 'need_open',
    'reason', case when e.first_in is not null then 'punched' else 'shift_start' end,
    'first_in', e.first_in, 'exp_start', e.exp_start, 'exp_end', e.exp_end);
end $$;
revoke all on function public.clinic_reception_shift_reminder() from public, anon;
grant execute on function public.clinic_reception_shift_reminder() to authenticated;
commit;
