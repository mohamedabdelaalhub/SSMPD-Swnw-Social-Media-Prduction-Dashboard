-- «خصم العاملين بالمركز» (owner decision 2026-11-26 via main chat 6): a new booking / visit discount kind 'staff', max 40%.
--   * Percent typed by reception, 1–40 (cap = booking_discount_max_for('staff') = 40, owner change 19:12Z), auto-approved.
--   * Supplies stay at FULL price (owner 19:13Z): the percent applies to the service part only. For a service whose catalogue
--     price includes supplies (pricing_services.supplies_used, «شاملة المستلزمات»), the order's discount is the typed percent ×
--     (1 − supplies share), share = supply cost / (base price + supply cost) — the same formula sync_catalog prices with.
--     Extra / billable supply lines are billed separately at execute (4116) and were never discounted.
--   * Eligibility proven on the server (owner answers 2026-11-26): the employee AND first-degree relatives, no monthly / yearly
--     cap, all services. Reception picks the employee from public.clinic_reception_staff_discount(ws, patient), which lists only
--     ACTIVE HR people (clinic_people.people status active / on_leave, end_date null or ≥ the visit day) whose phone matches the
--     patient file's phone (last 10 digits) — or the phone of a file DIRECTLY linked to the patient in «أفراد العيلة» (spouse /
--     child / parent / sibling, proof required, not transitive). The chosen person is saved on the appointment
--     (discount_staff_id) and re-checked at arrival.
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
  discount_kind is distinct from 'staff' or (discount_staff_id is not null and discount_percent > 0 and discount_percent <= 40));

create or replace function clinic_reception.booking_discount_max_for(p_kind text) returns numeric language sql immutable as $$
  select case p_kind when 'vezeeta' then 40 when 'family' then 50 when 'staff' then 40 else clinic_reception.booking_discount_max() end::numeric $$;
revoke all on function clinic_reception.booking_discount_max_for(text) from public, anon, authenticated;

-- who can give this patient the staff discount: (a) the patient IS the employee — the file's phone = the HR person's phone; or
-- (b) a FIRST-DEGREE relative — the file is linked DIRECTLY in «أفراد العيلة» (spouse / child / parent / sibling, with the proof
-- document, not removed) to a file whose phone = the HR person's phone. Not transitive: a relative's relative does not qualify.
-- The HR person must be active / on leave and not ended by the visit day.
create function clinic_reception.staff_for_patient(p_patient uuid, p_day date) returns table(person_id uuid, name text, code text, relation text)
language sql stable security definer set search_path = pg_catalog, public as $$
  with files as (
    select rp.id file_id, 'self'::text rel from clinic_reception.patients rp where rp.id = p_patient
    union all
    select case when r.patient_id = p_patient then r.relative_id else r.patient_id end, r.relation
      from clinic_reception.patient_relatives r
     where r.removed_at is null and (r.patient_id = p_patient or r.relative_id = p_patient)
  )
  select distinct on (pp.id) pp.id, pp.full_name, pp.code, f.rel
    from files f join clinic_reception.patients fp on fp.id = f.file_id
    -- the archive phone is the source on live (sync_native_links copies public.patients.phone onto the reception file)
    left join public.patients ar on ar.id = fp.patient_id
    cross join lateral (select regexp_replace(coalesce(nullif(btrim(ar.phone), ''), fp.phone, ''), '\D', '', 'g') d) ph
    join clinic_people.people pp on length(regexp_replace(coalesce(pp.phone, ''), '\D', '', 'g')) >= 10
     and right(regexp_replace(pp.phone, '\D', '', 'g'), 10) = right(ph.d, 10)
   where length(ph.d) >= 10
     and pp.status in ('active', 'on_leave') and (pp.end_date is null or pp.end_date >= p_day)
   order by pp.id, (f.rel = 'self') desc $$;
revoke all on function clinic_reception.staff_for_patient(uuid, date) from public, anon, authenticated;

create function clinic_reception.staff_check(p_patient uuid, p_person uuid, p_day date) returns text
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r record;
begin
  if p_person is null then raise exception 'اختار الموظف'; end if;
  select * into r from clinic_reception.staff_for_patient(p_patient, p_day) s where s.person_id = p_person;
  if not found then
    raise exception 'خصم العاملين للموظفين الشغالين وقرايبهم من الدرجة الأولى بس — المريض لازم يكون الموظف نفسه (نفس رقم التليفون في الموارد البشرية) أو مربوط بيه في «أفراد العيلة» (زوج/زوجة، ابن/بنت، أب/أم، أخ/أخت) والموظف شغال لحد يوم الزيارة';
  end if;
  return 'خصم العاملين بالمركز — ' || case r.relation when 'self' then '' else 'قريب درجة أولى ('
    || case r.relation when 'spouse' then 'زوج / زوجة' when 'child' then 'ابن / بنت' when 'parent' then 'أب / أم' else 'أخ / أخت' end || ') لـ ' end
    || r.name || ' (' || r.code || ')';
end $$;
revoke all on function clinic_reception.staff_check(uuid, uuid, date) from public, anon, authenticated;

-- supplies share of a reception service's catalogue price (0 when it has no structured supplies)
create function clinic_reception.staff_supply_share(p_service uuid) returns numeric
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare x record; l jsonb; ss record; sup numeric := 0; q numeric;
begin
  begin
    select ps.* into x from clinic_reception.services s join public.pricing_services ps on ps.id = (to_jsonb(s)->>'pricing_service_id')::uuid where s.id = p_service;
    if not found then return 0; end if;
    for l in select * from jsonb_array_elements(coalesce(to_jsonb(x)->'supplies_used', '[]'::jsonb)) loop
      select * into ss from public.pricing_supplies where id = (l->>'supply_id')::uuid;
      begin q := nullif(l->>'quantity', '')::numeric; exception when others then q := null; end;
      if found and q > 0 and coalesce((to_jsonb(ss)->>'units_per_package')::numeric, 0) > 0 then
        sup := sup + q * (to_jsonb(ss)->>'package_price')::numeric / (to_jsonb(ss)->>'units_per_package')::numeric;
      end if;
    end loop;
    if sup <= 0 or coalesce((to_jsonb(x)->>'base_price')::numeric, 0) + sup <= 0 then return 0; end if;
    return least(1, sup / ((to_jsonb(x)->>'base_price')::numeric + sup));
  exception when others then return 0; end;
end $$;
revoke all on function clinic_reception.staff_supply_share(uuid) from public, anon, authenticated;
-- the order discount for a typed staff percent: the service part only
create function clinic_reception.staff_order_percent(p_order uuid, p_typed numeric) returns numeric
language sql stable security definer set search_path = pg_catalog, public as $$
  select round(p_typed * (1 - clinic_reception.staff_supply_share(o.service_id)), 2) from clinic_reception.orders o where o.id = p_order $$;
revoke all on function clinic_reception.staff_order_percent(uuid, numeric) from public, anon, authenticated;
create function clinic_reception.staff_percent_ok(p jsonb) returns numeric language plpgsql immutable set search_path = pg_catalog as $$
declare v numeric;
begin
  begin v := nullif(btrim(coalesce(p->>'discount_percent', '')), '')::numeric; exception when others then v := null; end;
  if v is null or v <= 0 then raise exception 'اكتب نسبة الخصم'; end if;
  if v > 40 then raise exception 'أقصى خصم للعاملين بالمركز 40 ٪'; end if;
  return v;
end $$;
revoke all on function clinic_reception.staff_percent_ok(jsonb) from public, anon, authenticated;

-- reception's picker: who can this patient be (only matching active employees; name + HR code)
create function public.clinic_reception_staff_discount(p_workspace uuid, p_patient uuid, p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date);
begin
  perform clinic_reception.access(p_workspace, 'book');
  if not exists (select 1 from clinic_reception.patients where id = p_patient and workspace_id = p_workspace) then raise exception 'اختار المريض الأول'; end if;
  return jsonb_build_object('max', 40, 'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.person_id, 'name', s.name, 'code', s.code, 'relation', s.relation))
    from clinic_reception.staff_for_patient(p_patient, d) s), '[]'::jsonb));
end $$;
revoke all on function public.clinic_reception_staff_discount(uuid, uuid, date) from public, anon;
grant execute on function public.clinic_reception_staff_discount(uuid, uuid, date) to authenticated;

-- booking side (book / walk-in / reschedule / «خصم على الحجز»)
alter function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) rename to set_booking_discount_before_staff;
revoke all on function clinic_reception.set_booking_discount_before_staff(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
create function clinic_reception.set_booking_discount(p_workspace uuid, p_appointment uuid, p jsonb, p_me uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; why text; person uuid; pct numeric;
begin
  if nullif(btrim(coalesce(p->>'discount_kind', '')), '') is distinct from 'staff' then
    perform clinic_reception.set_booking_discount_before_staff(p_workspace, p_appointment, p, p_me);
    update clinic_reception.appointments set discount_staff_id = null where id = p_appointment and discount_kind is distinct from 'staff' and discount_staff_id is not null;
    return;
  end if;
  select * into ap from clinic_reception.appointments where id = p_appointment and workspace_id = p_workspace;
  if not found then raise exception 'الحجز مش موجود'; end if;
  begin person := nullif(p->>'discount_staff_id', '')::uuid; exception when others then person := null; end;
  pct := clinic_reception.staff_percent_ok(p);
  why := clinic_reception.staff_check(ap.patient_id, person, (ap.starts_at at time zone 'Africa/Cairo')::date);
  perform clinic_reception.set_booking_discount_before_staff(p_workspace, p_appointment,
    p || jsonb_build_object('discount_kind', 'special', 'discount_reason', why, 'discount_percent', least(pct, 30)::text), p_me);
  update clinic_reception.appointments set discount_kind = 'staff', discount_staff_id = person, discount_percent = pct where id = p_appointment;
end $$;
revoke all on function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- visit side («خصم على الزيارة», before execution / collection)
alter function clinic_reception.order_discount(uuid, uuid, jsonb, uuid) rename to order_discount_before_staff;
revoke all on function clinic_reception.order_discount_before_staff(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
create function clinic_reception.order_discount(p_workspace uuid, p_order uuid, p jsonb, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o record; why text; person uuid; res jsonb; pct numeric; eff numeric; od record;
begin
  if nullif(btrim(coalesce(p->>'discount_kind', '')), '') is distinct from 'staff' then
    return clinic_reception.order_discount_before_staff(p_workspace, p_order, p, p_me);
  end if;
  select ord.id, v.patient_id, v.appointment_id into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id
   where ord.id = p_order and ord.workspace_id = p_workspace;
  if not found then raise exception 'الخدمة مش موجودة'; end if;
  begin person := nullif(p->>'discount_staff_id', '')::uuid; exception when others then person := null; end;
  pct := clinic_reception.staff_percent_ok(p);
  why := clinic_reception.staff_check(o.patient_id, person, (now() at time zone 'Africa/Cairo')::date);
  res := clinic_reception.order_discount_before_staff(p_workspace, p_order,
    p || jsonb_build_object('discount_kind', 'special', 'discount_reason', why, 'discount_percent', least(pct, 30)::text), p_me);
  update clinic_reception.appointments set discount_kind = 'staff', discount_staff_id = person, discount_percent = pct where id = o.appointment_id;
  eff := clinic_reception.staff_order_percent(p_order, pct);
  update clinic_reception.discount_requests set reason = replace(reason, 'خصم الحجز: خصم خاص — ', 'خصم الحجز: '), percent = eff
   where order_id = p_order and reason like 'خصم الحجز: خصم خاص — خصم العاملين بالمركز%';
  update clinic_reception.orders set discount = eff where id = p_order and (res->>'status') = 'approved';
  select price, quantity into od from clinic_reception.orders where id = p_order;
  return res || jsonb_build_object('percent', eff, 'typed_percent', pct, 'net', round(od.price * od.quantity * (1 - eff / 100), 2));
end $$;
revoke all on function clinic_reception.order_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- at arrival (booking_discount_apply): re-check the employee on the arrival day and label the request
create function clinic_reception.staff_discount_request() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record;
begin
  if new.reason not like 'خصم الحجز: %' and new.reason not like 'نفس خصم الزيارة: %' then return new; end if;
  select a.* into ap from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id
    join clinic_reception.appointments a on a.id = v.appointment_id where o.id = new.order_id;
  if not found or ap.discount_kind is distinct from 'staff' then return new; end if;
  perform clinic_reception.staff_check(ap.patient_id, ap.discount_staff_id, (now() at time zone 'Africa/Cairo')::date);
  new.reason := replace(new.reason, 'خصم الحجز: خصم خاص — ', 'خصم الحجز: ');
  new.percent := clinic_reception.staff_order_percent(new.order_id, ap.discount_percent);  -- supplies at full price
  return new;
end $$;
revoke all on function clinic_reception.staff_discount_request() from public, anon, authenticated;
create trigger staff_discount_request before insert on clinic_reception.discount_requests
  for each row execute function clinic_reception.staff_discount_request();

-- a staff-discounted order always carries its approved request's percent (the service part only), whatever the caller set
create function clinic_reception.staff_order_discount() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare k text; pr numeric;
begin
  if new.discount is not distinct from old.discount or coalesce(new.discount, 0) <= 0 then return new; end if;
  select a.discount_kind into k from clinic_reception.visits v join clinic_reception.appointments a on a.id = v.appointment_id where v.id = new.visit_id;
  if k is distinct from 'staff' then return new; end if;
  select dr.percent into pr from clinic_reception.discount_requests dr where dr.order_id = new.id and dr.status = 'approved' order by dr.id desc limit 1;
  if pr is not null then new.discount := pr; end if;
  return new;
end $$;
revoke all on function clinic_reception.staff_order_discount() from public, anon, authenticated;
create trigger staff_order_discount before update of discount on clinic_reception.orders
  for each row execute function clinic_reception.staff_order_discount();

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
