-- Live rollback test for 20261126170000_staff_discount.sql («خصم العاملين بالمركز»). Run the WHOLE file as postgres.
-- ONE transaction, ends with ROLLBACK — nothing is kept (temp HR rows, phones, bookings, discounts are all rolled back).
-- Acts as Mazen (reception, auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb). Fixture: 6 real live reception patients without a
-- booking today; inside the txn their phones (archive public.patients AND the reception file — live mirrors the archive phone onto the
-- file at every command) are set to test numbers, 2 temp HR people are added (one active on P1's number,
-- one ENDED on P3's number) and 3 «أفراد العيلة» links (R1 child of P1, R3 spouse of P3, R2 sibling of R1 = 2nd degree). If nobody is on shift now, a temp availability block; the unrelated cash-shift guard is stubbed if
-- Mazen has no open shift. Output: one table (step, expected, actual, ok) — no names or phone numbers.
do $$ begin
  if to_regprocedure('clinic_reception.set_booking_discount_before_staff(uuid,uuid,jsonb,uuid)') is not null then
    raise exception '20261126170000 already applied — this dry-run is for before the apply'; end if;
end $$;

begin;
savepoint stf_guard;
create temp table stf_live(n serial, step text, expected text, actual text, ok boolean);
create temp table stf_fx(w uuid, me uuid, sub uuid, prov uuid, svc uuid, p1 uuid, p2 uuid, p3 uuid, e1 uuid, e3 uuid, r1 uuid, r3 uuid, r2 uuid);

-- >>> MIGRATION BODY: supabase/migrations/20261126170000_staff_discount.sql (between its begin; / commit;) >>>

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
-- <<< END MIGRATION BODY <<<

do $$
declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; prov uuid; svc uuid; p1 uuid; p2 uuid; p3 uuid; e1 uuid; e3 uuid; r1 uuid; r3 uuid; r2 uuid;
  d date := (now() at time zone 'Africa/Cairo')::date; g jsonb; pids uuid[];
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select id into me from public.admins where user_id = sub;
  if w is null or me is null then raise exception 'live workspace % / admin for sub % missing', w, sub; end if;
  perform clinic_reception.sync_catalog(w); perform clinic_reception.sync_catalog(w);
  -- a provider + a priced, non-home, non-offer service of its department; working now or a temp block
  select av.provider_id, s.id into prov, svc
    from clinic_reception.availability av join clinic_reception.providers pr2 on pr2.id = av.provider_id
    join clinic_reception.services s on s.workspace_id = w and s.department = pr2.department and s.active and s.price > 0
     and to_jsonb(s)->>'pricing_service_id' is not null and coalesce((to_jsonb(s)->>'is_home')::boolean, false) = false
     and not clinic_reception.service_is_offer(s.id)
     and not exists (select 1 from public.pricing_services ps where ps.active and ps.booking_enabled and btrim(ps.booking_code) = s.code
                       and ps.id <> (to_jsonb(s)->>'pricing_service_id')::uuid)
   where av.workspace_id = w and now() between av.starts_at and av.ends_at - interval '2 hours' and pr2.active and nullif(btrim(coalesce(pr2.doctor_key,'')),'') is not null
   order by (clinic_reception.staff_supply_share(s.id) between 0.01 and 0.9) desc, s.price limit 1;
  if prov is null then
    select pr2.id, s.id into prov, svc from clinic_reception.providers pr2
      join clinic_reception.services s on s.workspace_id = w and s.department = pr2.department and s.active and s.price > 0
       and to_jsonb(s)->>'pricing_service_id' is not null and coalesce((to_jsonb(s)->>'is_home')::boolean, false) = false
       and not clinic_reception.service_is_offer(s.id)
       and not exists (select 1 from public.pricing_services ps where ps.active and ps.booking_enabled and btrim(ps.booking_code) = s.code
                         and ps.id <> (to_jsonb(s)->>'pricing_service_id')::uuid)
     where pr2.workspace_id = w and pr2.active and nullif(btrim(coalesce(pr2.doctor_key,'')),'') is not null
     order by (clinic_reception.staff_supply_share(s.id) between 0.01 and 0.9) desc, s.price, pr2.name limit 1;
    insert into clinic_reception.availability(workspace_id, provider_id, starts_at, ends_at)
      values (w, prov, date_trunc('minute', now()) - interval '7 minutes', date_trunc('minute', now()) + interval '3 hours');
    insert into stf_live(step, expected, actual, ok) values ('0a provider on shift', 'working now or a temp block', 'temp availability block (rolled back)', true);
  end if;
  -- 3 real patients without a booking today; test phones inside the txn
  select array_agg(id order by created_at desc) into pids from (select p.id, p.created_at from clinic_reception.patients p where p.workspace_id = w and p.patient_id is not null
     and not exists (select 1 from clinic_reception.appointments x where x.patient_id = p.id and (x.starts_at at time zone 'Africa/Cairo')::date = d)
   order by p.created_at desc limit 6) z;
  p1 := pids[1]; p2 := pids[2]; p3 := pids[3]; r1 := pids[4]; r3 := pids[5]; r2 := pids[6];
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  update clinic_reception.patients set phone = '01999000901' where id = p1;
  update public.patients set phone = '01999000901' where id = (select patient_id from clinic_reception.patients where id = p1);
  update clinic_reception.patients set phone = '01999000902' where id = p2;
  update public.patients set phone = '01999000902' where id = (select patient_id from clinic_reception.patients where id = p2);
  update clinic_reception.patients set phone = '01999000903' where id = p3;
  update public.patients set phone = '01999000903' where id = (select patient_id from clinic_reception.patients where id = p3);
  update clinic_reception.patients set phone = '01999000904' where id = r1;
  update public.patients set phone = '01999000904' where id = (select patient_id from clinic_reception.patients where id = r1);
  update clinic_reception.patients set phone = '01999000905' where id = r3;
  update public.patients set phone = '01999000905' where id = (select patient_id from clinic_reception.patients where id = r3);
  update clinic_reception.patients set phone = '01999000906' where id = r2;
  update public.patients set phone = '01999000906' where id = (select patient_id from clinic_reception.patients where id = r2);
  -- «أفراد العيلة» links (rolled back): r1 = child of the employee's file, r3 = spouse of the ENDED employee's file, r2 = sibling of r1 (2nd degree)
  update clinic_reception.patient_relatives set removed_at = now(), removed_by = me, removed_reason = 'rollback test' where removed_at is null and (patient_id = any(pids) or relative_id = any(pids));
  insert into clinic_reception.patient_relatives(workspace_id, patient_id, relative_id, relation, proof_path, created_by) values
    (w, p1, r1, 'child', 'rollback/proof.jpg', me), (w, p3, r3, 'spouse', 'rollback/proof.jpg', me), (w, r1, r2, 'sibling', 'rollback/proof.jpg', me);
  insert into clinic_people.people(full_name, phone, status, created_by) values ('ROLLBACK STAFF ONE', '+20 1999000901', 'active', me) returning id into e1;
  insert into clinic_people.people(full_name, phone, status, end_date, created_by) values ('ROLLBACK STAFF ENDED', '01999000903', 'ended', d - 1, me) returning id into e3;
  insert into stf_fx values (w, me, sub, prov, svc, p1, p2, p3, e1, e3, r1, r3, r2);
  insert into stf_live(step, expected, actual, ok) values ('fixture', '6 patients + provider/service + 2 temp HR rows + 3 family links',
    'nobody else on the test numbers: ' || ((select count(*) from clinic_people.people where right(regexp_replace(phone,'\D','','g'),10) in ('1999000901','1999000902','1999000903','1999000904','1999000905','1999000906')) = 2),
    r2 is not null and svc is not null);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  if to_regprocedure('clinic_reception.shift_guard_check(uuid)') is not null then
    begin g := clinic_reception.shift_guard_state();
      if coalesce((g->>'locked')::boolean, false) then
        execute 'create or replace function clinic_reception.shift_guard_check(p_workspace uuid) returns void language plpgsql as $f$ begin return; end $f$';
        insert into stf_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'open shift, or stubbed in this txn', 'stubbed (Mazen had no open shift)', true);
      end if;
    exception when others then insert into stf_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'state readable', sqlerrm, true); end;
  end if;
end $$;

do $$ declare f stf_fx; r jsonb; err text; ap record; o record; wk uuid;
begin select * into f from stf_fx;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f.sub::text, true);
  -- 1) the picker as Mazen
  begin execute 'set local role authenticated';
    r := public.clinic_reception_staff_discount(f.w, f.p1); execute 'reset role';
    insert into stf_live(step, expected, actual, ok) values ('1 picker P1 (employee)', '1 employee (the temp one) · max 40', jsonb_array_length(r->'staff') || ' · max ' || (r->>'max'),
      jsonb_array_length(r->'staff') = 1 and (r->'staff'->0->>'id')::uuid = f.e1 and (r->>'max') = '40');
    execute 'set local role authenticated'; r := public.clinic_reception_staff_discount(f.w, f.p3); execute 'reset role';
    insert into stf_live(step, expected, actual, ok) values ('1b picker P3 (ended employee)', '0', jsonb_array_length(r->'staff')::text, jsonb_array_length(r->'staff') = 0);
  exception when others then execute 'reset role'; insert into stf_live(step, expected, actual, ok) values ('1 picker', 'works', sqlerrm, false); end;
  -- 2) walk-in P1 staff 31 → refused
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.p1, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'discount_kind', 'staff', 'discount_percent', '41', 'discount_staff_id', f.e1), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into stf_live(step, expected, actual, ok) values ('2 Mazen staff 41%', 'refused «أقصى خصم للعاملين بالمركز 40 ٪»', err, err like '%أقصى خصم للعاملين بالمركز 40%');
  -- 3) P2 (not an employee) with E1 → refused
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.p2, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'discount_kind', 'staff', 'discount_percent', '20', 'discount_staff_id', f.e1), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into stf_live(step, expected, actual, ok) values ('3 Mazen staff for a non-employee', 'refused «للموظفين الشغالين وقرايبهم…»', err, err like '%للموظفين الشغالين وقرايبهم%');
  -- 4) P3 with the ENDED employee → refused
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.p3, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'discount_kind', 'staff', 'discount_percent', '20', 'discount_staff_id', f.e3), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into stf_live(step, expected, actual, ok) values ('4 Mazen staff for an ended employee', 'refused «للموظفين الشغالين وقرايبهم…»', err, err like '%للموظفين الشغالين وقرايبهم%');
  -- 5) P1 staff 30 → saved; arrive → approved 30%, labelled
  begin execute 'set local role authenticated';
    r := public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.p1, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'discount_kind', 'staff', 'discount_percent', '40', 'discount_staff_id', f.e1), gen_random_uuid()); execute 'reset role'; err := 'ok'; wk := (r->>'id')::uuid;
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select * into ap from clinic_reception.appointments where id = wk;
  insert into stf_live(step, expected, actual, ok) values ('5 Mazen staff 40% (walk-in)', 'saved · staff · 40 · employee linked',
    err || ' · ' || coalesce(ap.discount_kind, '-') || ' · ' || coalesce(ap.discount_percent::text, '-') || ' · linked ' || (ap.discount_staff_id = f.e1),
    err = 'ok' and ap.discount_kind = 'staff' and ap.discount_percent = 40 and ap.discount_staff_id = f.e1);
  if wk is not null then
    begin execute 'set local role authenticated';
      perform public.clinic_reception_command(f.w, 'arrive', jsonb_build_object('id', wk), gen_random_uuid()); execute 'reset role'; err := 'ok';
    exception when others then execute 'reset role'; err := sqlerrm; end;
    select ord.id oid, ord.discount, ord.price, dr.status, dr.reason, dr.percent rpct, clinic_reception.staff_supply_share(ord.service_id) share into o
      from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id
      left join clinic_reception.discount_requests dr on dr.order_id = ord.id where v.appointment_id = wk order by ord.created_at limit 1;
    insert into stf_live(step, expected, actual, ok) values ('5b Mazen «وصل»', 'approved · «خصم العاملين بالمركز» · order % = 40 × (1 − supplies share)',
      err || ' · order ' || coalesce(o.discount::text, '-') || '% · ' || coalesce(o.status, '-') || ' · ' || coalesce(left(o.reason, 32), '-'),
      err = 'ok' and o.status = 'approved' and o.reason like 'خصم الحجز: خصم العاملين بالمركز%' and o.discount = round(40 * (1 - o.share), 2) and o.rpct = o.discount);
    insert into stf_live(step, expected, actual, ok) values ('5c supplies at full price', 'supplies share > 0 → order % < 40 and discount = 40% of the service part only',
      'share ' || round(o.share, 4) || ' · price ' || o.price || ' · discount ' || round(o.price * o.discount / 100, 2) || ' = 40% of ' || round(o.price * (1 - o.share), 2)
      || case when o.share = 0 then ' · (no live service with structured supplies on a working provider — check is only 40=40)' else '' end,
      o.discount = round(40 * (1 - o.share), 2) and (o.share = 0 or o.discount < 40));
  end if;
  -- 7) first-degree relative of the ACTIVE employee (linked child) → offered + saved; relative of the ENDED employee → refused;
  --    a relative's relative (2nd degree) → refused
  begin execute 'set local role authenticated'; r := public.clinic_reception_staff_discount(f.w, f.r1); execute 'reset role';
    insert into stf_live(step, expected, actual, ok) values ('7 picker relative of active employee', '1 · relation child', jsonb_array_length(r->'staff') || ' · ' || coalesce(r->'staff'->0->>'relation', '-'),
      jsonb_array_length(r->'staff') = 1 and r->'staff'->0->>'relation' = 'child');
  exception when others then execute 'reset role'; insert into stf_live(step, expected, actual, ok) values ('7 picker relative', 'works', sqlerrm, false); end;
  wk := null;
  begin execute 'set local role authenticated';
    r := public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.r1, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'discount_kind', 'staff', 'discount_percent', '40', 'discount_staff_id', f.e1), gen_random_uuid()); execute 'reset role'; err := 'ok'; wk := (r->>'id')::uuid;
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select * into ap from clinic_reception.appointments where id = wk;
  insert into stf_live(step, expected, actual, ok) values ('7b Mazen staff 40% for the relative', 'saved · staff · «قريب درجة أولى (ابن / بنت)»',
    err || ' · ' || coalesce(ap.discount_kind, '-') || ' · ' || (coalesce(ap.discount_reason, '') like '%قريب درجة أولى (ابن / بنت)%'),
    err = 'ok' and ap.discount_kind = 'staff' and ap.discount_reason like '%قريب درجة أولى (ابن / بنت)%');
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.r3, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'discount_kind', 'staff', 'discount_percent', '20', 'discount_staff_id', f.e3), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into stf_live(step, expected, actual, ok) values ('8 Mazen staff for a relative of an ended employee', 'refused «للموظفين الشغالين وقرايبهم…»', err, err like '%للموظفين الشغالين وقرايبهم%');
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.r2, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'discount_kind', 'staff', 'discount_percent', '20', 'discount_staff_id', f.e1), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into stf_live(step, expected, actual, ok) values ('9 Mazen staff for a 2nd-degree relative', 'refused «للموظفين الشغالين وقرايبهم…»', err, err like '%للموظفين الشغالين وقرايبهم%');
end $$;

-- >>> ROLLBACK BODY: supabase/rollbacks/20261126170000_staff_discount.rollback.sql >>>
drop trigger staff_discount_request on clinic_reception.discount_requests;
drop function clinic_reception.staff_discount_request();
drop function clinic_reception.order_discount(uuid, uuid, jsonb, uuid);
alter function clinic_reception.order_discount_before_staff(uuid, uuid, jsonb, uuid) rename to order_discount;
drop function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid);
alter function clinic_reception.set_booking_discount_before_staff(uuid, uuid, jsonb, uuid) rename to set_booking_discount;
drop function public.clinic_reception_staff_discount(uuid, uuid, date);
drop function clinic_reception.staff_check(uuid, uuid, date);
drop function clinic_reception.staff_for_patient(uuid, date);
update clinic_reception.appointments set discount_kind = 'special', discount_reason = coalesce(discount_reason, 'خصم العاملين بالمركز')
 where discount_kind = 'staff';
alter table clinic_reception.appointments drop constraint appointments_discount_staff_complete;
alter table clinic_reception.appointments drop constraint appointments_discount_kind_check;
alter table clinic_reception.appointments add constraint appointments_discount_kind_check
  check (discount_kind in ('syndicate', 'special', 'vezeeta', 'family'));
alter table clinic_reception.appointments drop constraint appointments_discount_complete;
alter table clinic_reception.appointments add constraint appointments_discount_complete check (
  discount_kind is null
  or (discount_kind = 'syndicate' and discount_percent is not null and discount_org_type is not null
      and length(btrim(coalesce(discount_org_name, ''))) >= 2 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'special' and discount_percent is not null and length(btrim(coalesce(discount_reason, ''))) >= 3)
  or (discount_kind = 'vezeeta' and discount_percent = 40 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'family' and discount_percent between 10 and 50));
alter table clinic_reception.appointments drop column discount_staff_id;
create or replace function clinic_reception.booking_discount_max_for(p_kind text) returns numeric language sql immutable as $$
  select case p_kind when 'vezeeta' then 40 when 'family' then 50 else clinic_reception.booking_discount_max() end::numeric $$;
revoke all on function clinic_reception.booking_discount_max_for(text) from public, anon, authenticated;
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
      when 'family' then 'كارت العيلة' else 'خاص' end;
end $$;
revoke all on function clinic_reception.booking_discount_exclusive() from public, anon, authenticated;
notify pgrst, 'reload schema';
-- <<< END ROLLBACK BODY <<<
insert into stf_live(step, expected, actual, ok) select '6 rollback body', 'wrappers gone, kind check back',
  coalesce(to_regprocedure('clinic_reception.set_booking_discount_before_staff(uuid,uuid,jsonb,uuid)')::text, 'gone') || ' / ' ||
  coalesce(to_regprocedure('public.clinic_reception_staff_discount(uuid,uuid,date)')::text, 'gone'),
  to_regprocedure('clinic_reception.set_booking_discount_before_staff(uuid,uuid,jsonb,uuid)') is null
  and to_regprocedure('public.clinic_reception_staff_discount(uuid,uuid,date)') is null
  and to_regprocedure('clinic_reception.set_booking_discount(uuid,uuid,jsonb,uuid)') is not null;

select step, expected, actual, ok from stf_live order by n;
rollback;
