-- HR: «يوم بديل» for work on an official holiday (Labor Law 14/2025 art. 129; owner decision 2026-11-15: a compensatory
-- day at the employee's WRITTEN request, instead of double pay).
--
-- * New request kind 'holiday_comp': the employee (or HR on his behalf) files a written request for ONE official-holiday
--   day (an approved center closure, 20261115230000) on which he actually worked: a check-in punch that day, or an
--   approved attendance row with an arrival. Today or earlier; one request per person and day.
-- * A different HR reviewer approves it (existing hr_command 'request_review' four-eyes). On approval, one approved
--   'leave_credit' day is added to his annual balance for that year, linked back to the request and audited.
-- Additive: no existing function is redefined.
begin;

do $$ begin
  if to_regprocedure('clinic_people.center_closed_on(date)') is null then raise exception 'طبّق 20261115230000_center_closures أولًا'; end if;
  if to_regprocedure('clinic_people.leave_rules()') is null then raise exception 'طبّق 20261116100000_hr_leave_rules أولًا'; end if;
end $$;

alter table clinic_people.requests drop constraint if exists requests_kind_check;
alter table clinic_people.requests add constraint requests_kind_check
  check (kind in ('leave','permission','training','advance','overtime','leave_credit','holiday_comp'));
alter table clinic_people.requests add column if not exists source_request_id uuid references clinic_people.requests(id);
create unique index if not exists requests_holiday_comp_once on clinic_people.requests(person_id, from_date)
  where kind = 'holiday_comp' and status in ('pending', 'approved');

create or replace function clinic_people.holiday_comp_rules() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.kind <> 'holiday_comp' then return new; end if;
  if new.to_date <> new.from_date or new.units <> 1 then raise exception 'اليوم البديل عن يوم إجازة رسمية واحد'; end if;
  if new.from_date > (now() at time zone 'Africa/Cairo')::date then raise exception 'اطلب اليوم البديل بعد ما تشتغل يوم الإجازة الرسمية'; end if;
  if not clinic_people.center_closed_on(new.from_date) then raise exception 'اليوم ده مش إجازة رسمية معتمدة للمركز'; end if;
  if not exists (select 1 from clinic_people.device_punches d
                   join clinic_people.device_user_map m on m.device_id = d.device_id and m.device_user_id = d.device_user_id
                  where m.person_id = new.person_id and d.punch in (0, 3, 4) and (d.ts at time zone 'Africa/Cairo')::date = new.from_date)
     and not exists (select 1 from clinic_people.attendance a
                      where a.person_id = new.person_id and a.day = new.from_date and a.status = 'approved' and a.actual_start is not null) then
    raise exception 'مفيش بصمة أو حضور معتمد للموظف في اليوم ده';
  end if;
  return new;
end $$;

drop trigger if exists requests_holiday_comp_rules on clinic_people.requests;
create trigger requests_holiday_comp_rules before insert on clinic_people.requests
  for each row when (new.kind = 'holiday_comp') execute function clinic_people.holiday_comp_rules();

-- On approval: +1 day in the annual balance of that year (the balance counts approved leave_credit rows).
create or replace function clinic_people.holiday_comp_grant() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v uuid;
begin
  if new.kind = 'holiday_comp' and new.status = 'approved' and old.status <> 'approved'
     and not exists (select 1 from clinic_people.requests c where c.source_request_id = new.id) then
    insert into clinic_people.requests(person_id, kind, from_date, to_date, units, note, status, created_by, reviewed_by, review_note, source_request_id)
    values (new.person_id, 'leave_credit', new.from_date, new.from_date, 1, 'يوم بديل عن العمل في إجازة رسمية (' || new.from_date || ')',
            'approved', new.created_by, new.reviewed_by, new.review_note, new.id)
    returning id into v;
    insert into clinic_people.audit(actor_id, action, record_id, after_data)
    values (new.reviewed_by, 'holiday_comp_credit', new.id, jsonb_build_object('credit_id', v, 'day', new.from_date));
  end if;
  return new;
end $$;

drop trigger if exists requests_holiday_comp_grant on clinic_people.requests;
create trigger requests_holiday_comp_grant after update of status on clinic_people.requests
  for each row when (new.kind = 'holiday_comp') execute function clinic_people.holiday_comp_grant();

revoke all on function clinic_people.holiday_comp_rules(), clinic_people.holiday_comp_grant() from public, anon, authenticated;

commit;
