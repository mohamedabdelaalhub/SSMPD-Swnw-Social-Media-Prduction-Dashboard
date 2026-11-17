-- Owner 2026-11-17: «أول ما موظف الاستقبال يفتح الداشبورد ويبقى باصم حضور أو جه موعد حضور الشفت ييجي يطلعله بوب اب يقوله افتح
-- وردية اليوم، وفيه زرار فتح الوردية».
-- public.clinic_reception_shift_reminder() — read-only, for the signed-in account only:
--   show = reception / customer_service account, linked HR person, (punched in today OR scheduled start has come),
--          and no open reception cash shift of its own (or only one opened before today → reason 'stale').
-- No writes, no other employees' data. Rollback: drop function public.clinic_reception_shift_reminder();
begin;
create or replace function public.clinic_reception_shift_reminder() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); pid uuid; d date := (now() at time zone 'Africa/Cairo')::date;
  e record; s record; due boolean := false;
begin
  if me is null then return jsonb_build_object('show', false); end if;
  if not (public.has_role('reception') or public.has_role('customer_service')) then return jsonb_build_object('show', false); end if;
  select p.id into pid from clinic_people.people p where p.admin_id = me and p.status <> 'ended' limit 1;
  if pid is null then return jsonb_build_object('show', false, 'why', 'no_person'); end if;
  select x.first_in, x.exp_start, x.exp_end, x.status into e from clinic_people.attendance_eval(d, now()) x where x.person_id = pid limit 1;
  due := found and (e.first_in is not null or (e.exp_start is not null and now() >= e.exp_start)) and coalesce(e.status, '') <> 'leave'
         and (e.exp_end is null or now() < e.exp_end);
  if not due then return jsonb_build_object('show', false, 'why', 'not_yet', 'exp_start', e.exp_start); end if;
  select sh.opened_at into s from clinic_reception.shifts sh where sh.cashier_id = me and sh.status = 'open' order by sh.opened_at desc limit 1;
  if found and (s.opened_at at time zone 'Africa/Cairo')::date = d then return jsonb_build_object('show', false, 'why', 'open'); end if;
  return jsonb_build_object('show', true,
    'reason', case when found then 'stale' when e.first_in is not null then 'punched' else 'shift_start' end,
    'first_in', e.first_in, 'exp_start', e.exp_start, 'stale_opened_at', case when found then s.opened_at end);
end $$;
revoke all on function public.clinic_reception_shift_reminder() from public, anon;
grant execute on function public.clinic_reception_shift_reminder() to authenticated;
commit;
