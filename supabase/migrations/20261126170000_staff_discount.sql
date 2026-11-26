-- «خصم العاملين بالمركز» (owner decision 2026-11-26 via main chat 6): a new booking / visit discount kind 'staff', max 30%.
--   * Percent typed by reception, 1–30 (cap = booking_discount_max_for('staff') = 30), auto-approved like the other kinds ≤ their cap.
--   * Eligibility proven on the server: the patient must BE an employee — reception picks the employee from
--     public.clinic_reception_staff_discount(ws, patient), which lists only ACTIVE HR people (clinic_people.people status active /
--     on_leave, end_date null or ≥ the visit day) whose phone matches the patient file's phone (last 10 digits). The chosen person
--     is saved on the appointment (discount_staff_id) and re-checked at arrival. Defaults until the owner answers: employees only
--     (not relatives), all services, no monthly cap.
--   * Same exclusions as the other kinds: package / entitlement / offer services, one discount per visit.
-- Implementation: wrappers on set_booking_discount (book / walk-in / reschedule / «خصم على الحجز») and order_discount
-- («خصم على الزيارة») run the existing «خاص» path with a fixed reason and then mark the appointment 'staff'; a trigger on
-- discount_requests re-checks the employee at arrival and labels the request «خصم العاملين بالمركز».
-- Rollback: supabase/rollbacks/20261126170000_staff_discount.rollback.sql
do $$ begin
  if to_regprocedure('clinic_reception.set_booking_discount(uuid,uuid,jsonb,uuid)') is null
     or to_regprocedure('clinic_reception.order_discount(uuid,uuid,jsonb,uuid)') is null
     or to_regclass('clinic_people.people') is null then raise exception 'خصومات الحجز / الموارد البشرية مش موجودة'; end if;
  if to_regprocedure('clinic_reception.set_booking_discount_before_staff(uuid,uuid,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;
begin;

alter table clinic_reception.appointments add column discount_staff_id uuid references clinic_people.people(id);
alter table clinic_reception.appointments drop constraint if exists appointments_discount_kind_check;
alter table clinic_reception.appointments add constraint appointments_discount_kind_check
  check (discount_kind in ('syndicate', 'special', 'vezeeta', 'family', 'staff'));
alter table clinic_reception.appointments drop constraint appointments_discount_complete;
alter table clinic_reception.appointments add constraint appointments_discount_complete check (
  discount_kind is null
  or (discount_kind = 'syndicate' and discount_percent is not null and discount_org_type is not null
      and length(btrim(coalesce(discount_org_name, ''))) >= 2 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'special' and discount_percent is not null and length(btrim(coalesce(discount_reason, ''))) >= 3)
  or (discount_kind = 'vezeeta' and discount_percent = 40 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'family' and discount_percent between 10 and 50)
  or (discount_kind = 'staff' and discount_percent is not null and discount_staff_id is not null and length(btrim(coalesce(discount_reason, ''))) >= 3));
alter table clinic_reception.appointments add constraint appointments_discount_staff_complete check (
  discount_kind is distinct from 'staff' or (discount_staff_id is not null and discount_percent > 0 and discount_percent <= 30));

create or replace function clinic_reception.booking_discount_max_for(p_kind text) returns numeric language sql immutable as $$
  select case p_kind when 'vezeeta' then 40 when 'family' then 50 when 'staff' then 30 else clinic_reception.booking_discount_max() end::numeric $$;
revoke all on function clinic_reception.booking_discount_max_for(text) from public, anon, authenticated;

-- active HR people whose phone is the patient file's phone (the patient IS the employee)
create function clinic_reception.staff_for_patient(p_patient uuid, p_day date) returns table(person_id uuid, name text, code text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select pp.id, pp.full_name, pp.code
    from clinic_reception.patients rp
    join clinic_people.people pp on length(regexp_replace(coalesce(pp.phone, ''), '\D', '', 'g')) >= 10
     and right(regexp_replace(pp.phone, '\D', '', 'g'), 10) = right(regexp_replace(coalesce(rp.phone, ''), '\D', '', 'g'), 10)
   where rp.id = p_patient and length(regexp_replace(coalesce(rp.phone, ''), '\D', '', 'g')) >= 10
     and pp.status in ('active', 'on_leave') and (pp.end_date is null or pp.end_date >= p_day)
   order by pp.full_name $$;
revoke all on function clinic_reception.staff_for_patient(uuid, date) from public, anon, authenticated;

create function clinic_reception.staff_check(p_patient uuid, p_person uuid, p_day date) returns text
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r record;
begin
  if p_person is null then raise exception 'اختار الموظف'; end if;
  select * into r from clinic_reception.staff_for_patient(p_patient, p_day) s where s.person_id = p_person;
  if not found then
    raise exception 'خصم العاملين للموظفين الشغالين بس — المريض لازم يكون نفس الموظف (نفس رقم التليفون في الموارد البشرية) وشغال لحد يوم الزيارة';
  end if;
  return 'خصم العاملين بالمركز — ' || r.name || ' (' || r.code || ')';
end $$;
revoke all on function clinic_reception.staff_check(uuid, uuid, date) from public, anon, authenticated;

-- reception's picker: who can this patient be (only matching active employees; name + HR code)
create function public.clinic_reception_staff_discount(p_workspace uuid, p_patient uuid, p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date);
begin
  perform clinic_reception.access(p_workspace, 'book');
  if not exists (select 1 from clinic_reception.patients where id = p_patient and workspace_id = p_workspace) then raise exception 'اختار المريض الأول'; end if;
  return jsonb_build_object('max', 30, 'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.person_id, 'name', s.name, 'code', s.code))
    from clinic_reception.staff_for_patient(p_patient, d) s), '[]'::jsonb));
end $$;
revoke all on function public.clinic_reception_staff_discount(uuid, uuid, date) from public, anon;
grant execute on function public.clinic_reception_staff_discount(uuid, uuid, date) to authenticated;

-- booking side (book / walk-in / reschedule / «خصم على الحجز»)
alter function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) rename to set_booking_discount_before_staff;
revoke all on function clinic_reception.set_booking_discount_before_staff(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
create function clinic_reception.set_booking_discount(p_workspace uuid, p_appointment uuid, p jsonb, p_me uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; why text; person uuid;
begin
  if nullif(btrim(coalesce(p->>'discount_kind', '')), '') is distinct from 'staff' then
    perform clinic_reception.set_booking_discount_before_staff(p_workspace, p_appointment, p, p_me);
    update clinic_reception.appointments set discount_staff_id = null where id = p_appointment and discount_kind is distinct from 'staff' and discount_staff_id is not null;
    return;
  end if;
  select * into ap from clinic_reception.appointments where id = p_appointment and workspace_id = p_workspace;
  if not found then raise exception 'الحجز مش موجود'; end if;
  begin person := nullif(p->>'discount_staff_id', '')::uuid; exception when others then person := null; end;
  why := clinic_reception.staff_check(ap.patient_id, person, (ap.starts_at at time zone 'Africa/Cairo')::date);
  perform clinic_reception.set_booking_discount_before_staff(p_workspace, p_appointment, p || jsonb_build_object('discount_kind', 'special', 'discount_reason', why), p_me);
  update clinic_reception.appointments set discount_kind = 'staff', discount_staff_id = person where id = p_appointment;
end $$;
revoke all on function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- visit side («خصم على الزيارة», before execution / collection)
alter function clinic_reception.order_discount(uuid, uuid, jsonb, uuid) rename to order_discount_before_staff;
revoke all on function clinic_reception.order_discount_before_staff(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
create function clinic_reception.order_discount(p_workspace uuid, p_order uuid, p jsonb, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o record; why text; person uuid; res jsonb;
begin
  if nullif(btrim(coalesce(p->>'discount_kind', '')), '') is distinct from 'staff' then
    return clinic_reception.order_discount_before_staff(p_workspace, p_order, p, p_me);
  end if;
  select ord.id, v.patient_id, v.appointment_id into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id
   where ord.id = p_order and ord.workspace_id = p_workspace;
  if not found then raise exception 'الخدمة مش موجودة'; end if;
  begin person := nullif(p->>'discount_staff_id', '')::uuid; exception when others then person := null; end;
  why := clinic_reception.staff_check(o.patient_id, person, (now() at time zone 'Africa/Cairo')::date);
  res := clinic_reception.order_discount_before_staff(p_workspace, p_order, p || jsonb_build_object('discount_kind', 'special', 'discount_reason', why), p_me);
  update clinic_reception.appointments set discount_kind = 'staff', discount_staff_id = person where id = o.appointment_id;
  update clinic_reception.discount_requests set reason = replace(reason, 'خصم الحجز: خصم خاص — ', 'خصم الحجز: ')
   where order_id = p_order and reason like 'خصم الحجز: خصم خاص — خصم العاملين بالمركز%';
  return res;
end $$;
revoke all on function clinic_reception.order_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- at arrival (booking_discount_apply): re-check the employee on the arrival day and label the request
create function clinic_reception.staff_discount_request() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record;
begin
  if new.reason not like 'خصم الحجز: %' then return new; end if;
  select a.* into ap from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id
    join clinic_reception.appointments a on a.id = v.appointment_id where o.id = new.order_id;
  if not found or ap.discount_kind is distinct from 'staff' then return new; end if;
  perform clinic_reception.staff_check(ap.patient_id, ap.discount_staff_id, (now() at time zone 'Africa/Cairo')::date);
  new.reason := replace(new.reason, 'خصم الحجز: خصم خاص — ', 'خصم الحجز: ');
  return new;
end $$;
revoke all on function clinic_reception.staff_discount_request() from public, anon, authenticated;
create trigger staff_discount_request before insert on clinic_reception.discount_requests
  for each row execute function clinic_reception.staff_discount_request();

-- the «one discount per visit» refusal names the staff kind
create or replace function clinic_reception.booking_discount_exclusive() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare oid uuid := new.order_id; ap record;
begin
  select a.discount_kind, a.discount_org_name into ap
    from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id join clinic_reception.appointments a on a.id = v.appointment_id
   where o.id = oid;
  if not found or ap.discount_kind is null then return new; end if;
  if tg_table_name = 'discount_requests' and new.reason like 'خصم الحجز: %' then return new; end if;
  raise exception 'الحجز ده عليه خصم % — مينفعش خصم تاني ولا سعر تعاقد عليه',
    case ap.discount_kind when 'syndicate' then 'نقابة / نادي (' || ap.discount_org_name || ')' when 'vezeeta' then 'فيزيتا شامل'
      when 'family' then 'كارت العيلة' when 'staff' then 'العاملين بالمركز' else 'خاص' end;
end $$;
revoke all on function clinic_reception.booking_discount_exclusive() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
