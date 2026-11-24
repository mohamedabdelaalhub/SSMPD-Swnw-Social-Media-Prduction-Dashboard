-- Fix the EXISTING open auto-booked appointments whose service is not a consultation (owner bug 2026-11-24; main chat 5
-- live count: 49 of 58). Needs 20261124210000_auto_book_consult_only applied first (uses is_consult_name / consult_rank).
-- Scope: appointments created by the auto-booking system account, status 'booked' (NOT arrived — an arrived visit already
-- has an order; reception changes those with «تغيير الخدمة»), starting today (Cairo) or later, service not consultation-type,
-- and the source did NOT name that service (external_bookings.needed_service ≠ the service name).
-- Each one is changed with the normal «تعديل الحجز» command (reschedule: same doctor, same time), run as the auto-booking
-- system account, so every booking check still applies and NO patient message is sent (a message is queued only when the
-- time or doctor changes):
--   * to the doctor's department consultation (كشف → استشارة → متابعة, the doctor's most used one first), else
--   * to «الخدمة تتحدد عند الحضور» (service_later) when the department has no consultation service.
-- A row the booking checks refuse (e.g. the longer consultation overlaps the next booking) is left as it is and listed.
-- Part 1 is read-only. Part 2 applies; dry-run it with ROLLBACK first.

-- ===================== 1. PREVIEW (read-only) =====================
with sys as (select system_admin_id id from clinic_reception.auto_book_settings where id),
cand as (
  select a.id, a.workspace_id, a.provider_id, a.starts_at, a.status, s.code, s.name service, pr.name doctor, pr.department,
         e.needed_service,
         (select s2.id from clinic_reception.services s2 where s2.workspace_id = a.workspace_id and s2.active and not s2.placeholder
             and s2.department = pr.department and clinic_reception.is_consult_name(s2.name)
           order by (select count(*) from clinic_reception.appointments x where x.provider_id = a.provider_id and x.service_id = s2.id and x.status <> 'cancelled') desc,
                    clinic_reception.consult_rank(s2.name), s2.minutes, s2.name limit 1) target
    from clinic_reception.appointments a join sys on a.created_by = sys.id
    join clinic_reception.services s on s.id = a.service_id join clinic_reception.providers pr on pr.id = a.provider_id
    left join clinic_reception.external_bookings e on e.appointment_id = a.id
   where a.starts_at >= date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'
     and a.status not in ('cancelled', 'no_show', 'completed') and not clinic_reception.is_consult_name(s.name) and not s.placeholder)
select left(c.id::text, 8) appt, (c.starts_at at time zone 'Africa/Cairo') as starts_cairo, c.status, c.doctor, c.department,
       c.code || ' ' || c.service as current_service, coalesce(t.code || ' ' || t.name, '«الخدمة تتحدد عند الحضور»') as proposed,
       case when c.status <> 'booked' then 'SKIP: arrived — use «تغيير الخدمة»'
            when clinic_reception.service_name_key(c.needed_service) = clinic_reception.service_name_key(c.service) then 'SKIP: the source named this service'
            else 'change' end as plan
  from cand c left join clinic_reception.services t on t.id = c.target
 order by plan, c.starts_at;

-- ===================== 2. APPLY =====================
begin;
create temp table _abfix(appt uuid, doctor text, old_service text, new_service text, result text) on commit drop;
do $$
declare sys uuid; sys_user uuid; r record; tgt uuid; res text;
begin
  select system_admin_id into sys from clinic_reception.auto_book_settings where id;
  select user_id into sys_user from public.admins where id = sys;
  if sys_user is null then raise exception 'auto-booking system account not found'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sys_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sys_user::text, true);
  for r in
    select a.id, a.workspace_id, a.provider_id, a.starts_at, s.name service, pr.name doctor, pr.department, e.needed_service
      from clinic_reception.appointments a join clinic_reception.services s on s.id = a.service_id
      join clinic_reception.providers pr on pr.id = a.provider_id left join clinic_reception.external_bookings e on e.appointment_id = a.id
     where a.created_by = sys and a.status = 'booked'
       and a.starts_at >= date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'
       and not clinic_reception.is_consult_name(s.name) and not s.placeholder
       and clinic_reception.service_name_key(e.needed_service) is distinct from clinic_reception.service_name_key(s.name)
     order by a.starts_at
  loop
    select s2.id into tgt from clinic_reception.services s2 where s2.workspace_id = r.workspace_id and s2.active and not s2.placeholder
       and s2.department = r.department and clinic_reception.is_consult_name(s2.name)
     order by (select count(*) from clinic_reception.appointments x where x.provider_id = r.provider_id and x.service_id = s2.id and x.status <> 'cancelled') desc,
              clinic_reception.consult_rank(s2.name), s2.minutes, s2.name limit 1;
    begin
      execute 'set local role authenticated';
      perform public.clinic_reception_command(r.workspace_id, 'reschedule',
        jsonb_build_object('id', r.id, 'provider_id', r.provider_id, 'starts_at', r.starts_at)
        || case when tgt is not null then jsonb_build_object('service_id', tgt) else jsonb_build_object('service_later', true) end, gen_random_uuid());
      execute 'reset role'; res := 'changed';
    exception when others then execute 'reset role'; res := 'LEFT AS IS: ' || sqlerrm; end;
    insert into _abfix values (r.id, r.doctor, r.service,
      coalesce((select name from clinic_reception.services where id = tgt), '«الخدمة تتحدد عند الحضور»'), res);
  end loop;
end $$;
select left(appt::text, 8) appt, doctor, old_service, new_service, result from _abfix order by result, doctor;
select result like 'changed' ok, count(*) from _abfix group by 1;
commit;
