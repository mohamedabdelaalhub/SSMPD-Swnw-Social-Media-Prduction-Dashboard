-- Booking discounts «فيزيتا شامل» and «كارت العيلة» (owner 2026-11-22, mockup docs/ui-references/mockups/
-- discount-vezeeta-family-* approved «طبقه»), on top of 20261121180000 (booking discount):
--   * «فيزيتا شامل»: fixed 40%; card number + valid until (≥ visit day) + card photo (same private bucket).
--   * «كارت العيلة»: the system sets the percent — 10% on the family's first family-card visit, +10% each next visit of
--     the patient or any family member, up to 50%, then back to 10% (cycle 10/20/30/40/50). A visit counts when the patient
--     ARRIVES (arrived / completed appointments carrying the family discount). The percent is recomputed at arrival.
--     Family = reception patient files linked in «أفراد العيلة» (new, any phone; relation + proof document required, linked
--     once, audited) plus files on the same phone number (they share the phone-owner relation already).
--   * Maximum per kind: نقابة/نادي and خاص 30% (unchanged), فيزيتا 40%, كارت العيلة 50%; all applied at arrival without
--     review (they are the owner's fixed rules). One discount per visit and no package discount (unchanged).
-- New: clinic_reception.patient_relatives, clinic_reception.family_ids(patient), public.clinic_reception_family(ws, action,
-- payload) actions list / link / unlink, public.patient_family_verified(archive a, archive b) for the Patient Portal later. Re-created (old bodies saved for rollback): set_booking_discount,
-- booking_discount_apply, booking_discount_exclusive.
-- Rollback: supabase/rollbacks/20261122110000_discount_vezeeta_family.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.set_booking_discount(uuid,uuid,jsonb,uuid)') is null then raise exception 'طبّق 20261121180000 الأول'; end if;
  if to_regclass('clinic_reception.patient_relatives') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.discount_saved_defs(sig text primary key, def text not null);
revoke all on clinic_reception.discount_saved_defs from public, anon, authenticated;
insert into clinic_reception.discount_saved_defs
  select p.oid::regprocedure::text, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'clinic_reception' and p.proname in ('set_booking_discount', 'booking_discount_apply', 'booking_discount_exclusive');

-- kinds + completeness
alter table clinic_reception.appointments drop constraint if exists appointments_discount_kind_check;
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

create function clinic_reception.booking_discount_max_for(p_kind text) returns numeric language sql immutable as $$
  select case p_kind when 'vezeeta' then 40 when 'family' then 50 else clinic_reception.booking_discount_max() end::numeric $$;
revoke all on function clinic_reception.booking_discount_max_for(text) from public, anon, authenticated;

-- «أفراد العيلة»: links between reception patient files (any phone), with the proof document, once
create table clinic_reception.patient_relatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  patient_id uuid not null references clinic_reception.patients(id),
  relative_id uuid not null references clinic_reception.patients(id),
  relation text not null check (relation in ('spouse', 'child', 'parent', 'sibling')),
  proof_path text not null check (length(proof_path) > 3),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz, removed_by uuid references public.admins(id), removed_reason text,
  check (patient_id <> relative_id));
create unique index patient_relatives_active_pair on clinic_reception.patient_relatives
  (least(patient_id, relative_id), greatest(patient_id, relative_id)) where removed_at is null;
alter table clinic_reception.patient_relatives enable row level security;
revoke all on clinic_reception.patient_relatives from public, anon, authenticated;

create function clinic_reception.phone_key(p text) returns text language sql immutable as $$
  select case when length(d) >= 8 then right(d, 10) end from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') d) x $$;
revoke all on function clinic_reception.phone_key(text) from public, anon, authenticated;

-- the family of a reception patient file: linked files (both directions, transitively) + files on the same phone
create function clinic_reception.family_ids(p_patient uuid) returns uuid[]
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare ws uuid; ids uuid[]; nxt uuid[];
begin
  select workspace_id into ws from clinic_reception.patients where id = p_patient;
  if ws is null then return array[]::uuid[]; end if;
  ids := array[p_patient];
  for i in 1..6 loop
    select coalesce(array_agg(distinct x), array[]::uuid[]) into nxt from (
      select unnest(ids) x
      union select case when r.patient_id = any(ids) then r.relative_id else r.patient_id end
        from clinic_reception.patient_relatives r
       where r.removed_at is null and r.workspace_id = ws and (r.patient_id = any(ids) or r.relative_id = any(ids))
      union select p2.id from clinic_reception.patients p1 join clinic_reception.patients p2
          on p2.workspace_id = p1.workspace_id and clinic_reception.phone_key(p2.phone) = clinic_reception.phone_key(p1.phone)
       where p1.id = any(ids) and clinic_reception.phone_key(p1.phone) is not null) q;
    exit when cardinality(nxt) = cardinality(ids);
    ids := nxt;
  end loop;
  return ids;
end $$;
revoke all on function clinic_reception.family_ids(uuid) from public, anon, authenticated;

-- family-card visits already used by the family (arrived / completed), excluding one appointment
create function clinic_reception.family_visits(p_patient uuid, p_exclude uuid default null) returns integer
language sql stable security definer set search_path = pg_catalog, public as $$
  select count(*)::int from clinic_reception.appointments a
   where a.patient_id = any(clinic_reception.family_ids(p_patient)) and a.discount_kind = 'family'
     and a.status in ('arrived', 'completed') and a.id is distinct from p_exclude $$;
create function clinic_reception.family_percent(p_used integer) returns numeric language sql immutable as $$
  select (10 * ((coalesce(p_used, 0) % 5) + 1))::numeric $$;
revoke all on function clinic_reception.family_visits(uuid, uuid) from public, anon, authenticated;
revoke all on function clinic_reception.family_percent(integer) from public, anon, authenticated;

create or replace function clinic_reception.set_booking_discount(p_workspace uuid, p_appointment uuid, p jsonb, p_me uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; kind text := nullif(btrim(coalesce(p->>'discount_kind', '')), ''); pct numeric; exp date; path text; d date; has_file boolean;
begin
  select * into ap from clinic_reception.appointments where id = p_appointment and workspace_id = p_workspace for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if ap.status <> 'booked' then raise exception 'الخصم بيتعدّل قبل وصول المريض بس'; end if;
  if kind is null then
    update clinic_reception.appointments set discount_kind = null, discount_percent = null, discount_org_type = null, discount_org_name = null,
      discount_card_no = null, discount_card_expiry = null, discount_card_path = null, discount_reason = null, discount_by = p_me, discount_at = now()
     where id = ap.id;
    return;
  end if;
  if kind not in ('syndicate', 'special', 'vezeeta', 'family') then raise exception 'اختار نوع الخصم'; end if;
  if ap.package_id is not null then raise exception 'حجز الباكج بسعره المتعاقد عليه — مينفعش عليه خصم'; end if;
  d := (ap.starts_at at time zone 'Africa/Cairo')::date;
  if kind = 'vezeeta' then
    pct := 40;
  elsif kind = 'family' then
    pct := clinic_reception.family_percent(clinic_reception.family_visits(ap.patient_id, ap.id));
  else
    begin pct := nullif(btrim(coalesce(p->>'discount_percent', '')), '')::numeric; exception when others then pct := null; end;
    if pct is null or pct <= 0 then raise exception 'اكتب نسبة الخصم'; end if;
    if pct > clinic_reception.booking_discount_max() then raise exception 'أقصى خصم على الحجز % ٪', clinic_reception.booking_discount_max(); end if;
  end if;
  if kind in ('syndicate', 'vezeeta') then
    if kind = 'syndicate' then
      if coalesce(p->>'discount_org_type', '') not in ('syndicate','club','other') then raise exception 'اختار الجهة: نقابة أو نادي أو أخرى'; end if;
      if length(btrim(coalesce(p->>'discount_org_name', ''))) < 2 then raise exception 'اكتب اسم الجهة'; end if;
    end if;
    if length(btrim(coalesce(p->>'discount_card_no', ''))) < 2 then
      raise exception '%', case when kind = 'vezeeta' then 'رقم كارت فيزيتا شامل إجباري' else 'رقم الكارنيه إجباري' end; end if;
    begin exp := nullif(p->>'discount_card_expiry', '')::date; exception when others then exp := null; end;
    if exp is null then raise exception 'اكتب الكارت ساري لحد إمتى'; end if;
    if exp < d then raise exception 'الكارت منتهي قبل يوم الزيارة — الخصم مش متاح'; end if;
    path := btrim(coalesce(p->>'discount_card_path', ''));
    if length(path) < 4 then raise exception 'ارفع صورة الكارت'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''booking-discount-cards'' and o.name = $1)' into has_file using path;
      if not has_file then raise exception 'ارفع صورة الكارت'; end if;
    end if;
  elsif kind = 'special' and length(btrim(coalesce(p->>'discount_reason', ''))) < 3 then
    raise exception 'اكتب سبب الخصم';
  end if;
  update clinic_reception.appointments set discount_kind = kind, discount_percent = pct,
      discount_org_type = case when kind = 'syndicate' then p->>'discount_org_type' end,
      discount_org_name = case when kind = 'syndicate' then left(btrim(p->>'discount_org_name'), 120) end,
      discount_card_no = case when kind in ('syndicate', 'vezeeta') then left(btrim(p->>'discount_card_no'), 60) end,
      discount_card_expiry = case when kind in ('syndicate', 'vezeeta') then exp end,
      discount_card_path = case when kind in ('syndicate', 'vezeeta') then path end,
      discount_reason = case when kind = 'special' then left(btrim(p->>'discount_reason'), 300) end,
      discount_by = p_me, discount_at = now()
   where id = ap.id;
end $$;
revoke all on function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

create or replace function clinic_reception.booking_discount_apply() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; why text; ok boolean; pct numeric; used int;
begin
  if new.entitlement_id is not null then return new; end if;
  select a.* into ap from clinic_reception.visits v join clinic_reception.appointments a on a.id = v.appointment_id where v.id = new.visit_id;
  if not found or ap.discount_kind is null or ap.service_id is distinct from new.service_id then return new; end if;
  if (select count(*) from clinic_reception.orders o where o.visit_id = new.visit_id and o.service_id = new.service_id) > 1 then return new; end if;
  if ap.discount_kind in ('syndicate', 'vezeeta') and ap.discount_card_expiry < (now() at time zone 'Africa/Cairo')::date then
    raise exception 'كارت الخصم (%) منتهي — شيل الخصم من الحجز أو حدّثه قبل تسجيل الحضور',
      case when ap.discount_kind = 'vezeeta' then 'فيزيتا شامل' else ap.discount_org_name end;
  end if;
  pct := ap.discount_percent;
  if ap.discount_kind = 'family' then
    used := clinic_reception.family_visits(ap.patient_id, ap.id);
    pct := clinic_reception.family_percent(used);
    update clinic_reception.appointments set discount_percent = pct where id = ap.id;
  end if;
  why := 'خصم الحجز: ' || case ap.discount_kind
           when 'syndicate' then case ap.discount_org_type when 'syndicate' then 'نقابة' when 'club' then 'نادي' else 'جهة' end
                || ' — ' || ap.discount_org_name || ' — كارنيه ' || ap.discount_card_no
           when 'vezeeta' then 'فيزيتا شامل — كارت ' || ap.discount_card_no
           when 'family' then 'كارت العيلة — زيارة العيلة رقم ' || (used + 1)
           else 'خصم خاص — ' || ap.discount_reason end;
  ok := pct <= clinic_reception.booking_discount_max_for(ap.discount_kind);
  insert into clinic_reception.discount_requests(workspace_id, order_id, percent, reason, created_by, status)
    values (new.workspace_id, new.id, pct, why, coalesce(ap.discount_by, ap.created_by), case when ok then 'approved' else 'pending' end);
  if ok then update clinic_reception.orders set discount = pct where id = new.id; end if;
  return new;
end $$;
revoke all on function clinic_reception.booking_discount_apply() from public, anon, authenticated;

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

-- «أفراد العيلة» + family-card preview for the booking screen
create function public.clinic_reception_family(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; pid uuid := nullif(p_payload->>'patient_id', '')::uuid; rid uuid; rel text; path text; has_file boolean; v uuid;
  fam uuid[]; used int; r clinic_reception.patient_relatives%rowtype;
begin
  me := clinic_reception.access(p_workspace, case when p_action = 'list' then 'view' else 'book' end);
  if p_action = 'link' then
    rid := nullif(p_payload->>'relative_id', '')::uuid; rel := coalesce(p_payload->>'relation', '');
    path := btrim(coalesce(p_payload->>'proof_path', ''));
    if pid is null or rid is null or pid = rid then raise exception 'اختار القريب'; end if;
    if (select count(*) from clinic_reception.patients where id in (pid, rid) and workspace_id = p_workspace) <> 2 then
      raise exception 'الملف مش موجود'; end if;
    if rel not in ('spouse', 'child', 'parent', 'sibling') then raise exception 'اختار صلة القرابة'; end if;
    if length(path) < 4 then raise exception 'ارفع مستند إثبات القرابة'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''booking-discount-cards'' and o.name = $1)' into has_file using path;
      if not has_file then raise exception 'ارفع مستند إثبات القرابة'; end if;
    end if;
    if exists (select 1 from clinic_reception.patient_relatives x where x.removed_at is null
                and least(x.patient_id, x.relative_id) = least(pid, rid) and greatest(x.patient_id, x.relative_id) = greatest(pid, rid)) then
      raise exception 'الملفين مربوطين ببعض قبل كده'; end if;
    insert into clinic_reception.patient_relatives(workspace_id, patient_id, relative_id, relation, proof_path, created_by)
      values (p_workspace, pid, rid, rel, path, me) returning id into v;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'family_link', v, jsonb_build_object('patient_id', pid, 'relative_id', rid, 'relation', rel));
    return jsonb_build_object('id', v);
  elsif p_action = 'unlink' then
    select * into r from clinic_reception.patient_relatives where id = nullif(p_payload->>'id', '')::uuid and workspace_id = p_workspace and removed_at is null;
    if not found then raise exception 'الربط مش موجود'; end if;
    if length(btrim(coalesce(p_payload->>'reason', ''))) < 3 then raise exception 'اكتب سبب فك الربط'; end if;
    update clinic_reception.patient_relatives set removed_at = now(), removed_by = me, removed_reason = left(btrim(p_payload->>'reason'), 200) where id = r.id;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'family_unlink', r.id, jsonb_build_object('reason', p_payload->>'reason'));
    return jsonb_build_object('id', r.id);
  elsif p_action <> 'list' then raise exception 'إجراء غير متاح';
  end if;
  if not exists (select 1 from clinic_reception.patients where id = pid and workspace_id = p_workspace) then raise exception 'الملف مش موجود'; end if;
  fam := clinic_reception.family_ids(pid);
  used := clinic_reception.family_visits(pid, null);
  return jsonb_build_object(
    'patient_id', pid, 'used', used, 'next_percent', clinic_reception.family_percent(used), 'visit_no', (used % 5) + 1,
    'members', coalesce((select jsonb_agg(jsonb_build_object('patient_id', p.id, 'name', p.name, 'file_no', p.file_no, 'phone', p.phone,
        'link_id', l.id, 'relation', l.relation, 'linked_to', case when l.id is null then null when l.patient_id = p.id then l.relative_id else l.patient_id end,
        'via', case when l.id is not null then 'link' else 'phone' end) order by p.name)
      from clinic_reception.patients p
      left join lateral (select x.* from clinic_reception.patient_relatives x where x.removed_at is null and (x.patient_id = p.id or x.relative_id = p.id)
                           and (x.patient_id = any(fam) and x.relative_id = any(fam)) order by x.created_at limit 1) l on true
     where p.id = any(fam) and p.id <> pid), '[]'::jsonb),
    'linked', exists (select 1 from clinic_reception.patient_relatives x where x.removed_at is null and (x.patient_id = pid or x.relative_id = pid)),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('day', (a.starts_at at time zone 'Africa/Cairo')::date, 'name', p.name, 'percent', a.discount_percent)
        order by a.starts_at)
      from clinic_reception.appointments a join clinic_reception.patients p on p.id = a.patient_id
     where a.patient_id = any(fam) and a.discount_kind = 'family' and a.status in ('arrived', 'completed')), '[]'::jsonb));
end $$;
revoke all on function public.clinic_reception_family(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_family(uuid, text, jsonb) to authenticated;

-- For the Patient Portal later (owner 2026-11-22): a family link the staff verified here (relation + proof document) lets
-- a portal family request between the same two archive patients be approved without new documents. Server-side only
-- (service role / edge functions): returns the relation of the active staff-verified link, or null.
create function public.patient_family_verified(p_archive_a uuid, p_archive_b uuid) returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select r.relation from clinic_reception.patient_relatives r
    join clinic_reception.patients a on a.id = r.patient_id join clinic_reception.patients b on b.id = r.relative_id
   where r.removed_at is null and length(r.proof_path) > 3
     and ((a.patient_id = p_archive_a and b.patient_id = p_archive_b) or (a.patient_id = p_archive_b and b.patient_id = p_archive_a))
   order by r.created_at limit 1 $$;
revoke all on function public.patient_family_verified(uuid, uuid) from public, anon, authenticated;

commit;
