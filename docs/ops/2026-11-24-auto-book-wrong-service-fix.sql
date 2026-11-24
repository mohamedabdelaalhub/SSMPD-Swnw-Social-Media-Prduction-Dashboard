-- Fix the EXISTING open auto-booked appointments whose service is not a consultation (owner bug 2026-11-24; main chat 5
-- live count: 49 of 58). Needs 20261124210000_auto_book_consult_only applied first (uses is_consult_name / consult_rank).
-- Scope: appointments created by the auto-booking system account, status 'booked' (NOT arrived — an arrived visit already
-- has an order; reception changes those with «تغيير الخدمة»), starting today (Cairo) or later, service not consultation-type,
-- and the source did NOT name that service (external_bookings.needed_service ≠ the service name).
-- Each one keeps its doctor and time; ONLY its service changes (direct update, v2 after main chat's dry-run: 'reschedule'
-- re-checked the slot and refused 9 rows that overlap only because of the new service length). No message is queued (the
-- outbox reacts to time / doctor changes only); no order exists yet (status 'booked'):
--   * to a consultation the doctor serves (home + extra departments + scope rows; كشف / استشارة / متابعة — the kind the
--     source asked for first, then his most used, then his home department), else
--   * to «الخدمة تتحدد عند الحضور» (service_later) when he serves no consultation service.
-- Part 1 is read-only. Part 2 applies; dry-run it with ROLLBACK first.

-- ===================== 1. PREVIEW (read-only) =====================
with sys as (select system_admin_id id from clinic_reception.auto_book_settings where id),
cand as (
  select a.id, a.workspace_id, a.provider_id, a.starts_at, a.status, s.code, s.name service, pr.name doctor, pr.department,
         e.needed_service,
         (select s2.id from clinic_reception.services s2 where s2.workspace_id = a.workspace_id and s2.active and not s2.placeholder
             and clinic_reception.serves_service(a.provider_id, s2.department, s2.code) and clinic_reception.is_consult_name(s2.name)
           order by (clinic_reception.consult_rank(s2.name, e.needed_service) = -1) desc,
                    (select count(*) from clinic_reception.appointments x where x.provider_id = a.provider_id and x.service_id = s2.id and x.status <> 'cancelled') desc,
                    (s2.department = pr.department) desc, clinic_reception.consult_rank(s2.name, e.needed_service), s2.minutes, s2.name limit 1) target
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
declare sys uuid; r record; tgt uuid; res text;
begin
  select system_admin_id into sys from clinic_reception.auto_book_settings where id;
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
    tgt := (select s2.id from clinic_reception.services s2 where s2.workspace_id = r.workspace_id and s2.active and not s2.placeholder
             and clinic_reception.serves_service(r.provider_id, s2.department, s2.code) and clinic_reception.is_consult_name(s2.name)
           order by (clinic_reception.consult_rank(s2.name, r.needed_service) = -1) desc,
                    (select count(*) from clinic_reception.appointments x where x.provider_id = r.provider_id and x.service_id = s2.id and x.status <> 'cancelled') desc,
                    (s2.department = r.department) desc, clinic_reception.consult_rank(s2.name, r.needed_service), s2.minutes, s2.name limit 1);
    begin
      -- same doctor, same time: only the service changes (no slot / overlap re-check, no patient message, no order yet)
      if tgt is null then tgt := clinic_reception.service_later_id(r.workspace_id, r.department); end if;
      update clinic_reception.appointments set service_id = tgt,
             service_later = coalesce((select placeholder from clinic_reception.services where id = tgt), false)
       where id = r.id and status = 'booked';
      res := 'changed';
    exception when others then res := 'LEFT AS IS: ' || sqlerrm; end;
    insert into _abfix values (r.id, r.doctor, r.service,
      coalesce((select name from clinic_reception.services where id = tgt), '«الخدمة تتحدد عند الحضور»'), res);
  end loop;
end $$;
select left(appt::text, 8) appt, doctor, old_service, new_service, result from _abfix order by result, doctor;
select result like 'changed' ok, count(*) from _abfix group by 1;
commit;
