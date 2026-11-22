-- «الخدمة تتحدد عند الحضور» (owner 2026-11-22, reception: laser patients decide the service at the visit; mockup
-- docs/ui-references/mockups/booking-service-later-* approved «طبقه»).
-- A booking can reserve the doctor's time without a service. appointments.service_id stays NOT NULL: such a booking points
-- at a per-department placeholder service (services.placeholder, price 0, name «الخدمة تتحدد عند الحضور», 30 minutes by
-- default; minutes editable per department). Placeholders are kept INACTIVE, so they never appear in service lists, never
-- reach order_add / packages / auto-book, and the catalog sync cannot matter; the wrapper turns one on only for the
-- duration of its own book / reschedule / walk_in call (same transaction).
-- * appointments.service_later = true while the service is not chosen.
-- * «تسجيل حضور» (arrive) on such a booking REQUIRES payload service_id (an active, non-placeholder service of the
--   doctor's department(s) or scope). The appointment takes the real service and its length (capacity / gap re-checked)
--   BEFORE the normal arrival runs, so the visit order, price, quantity and booking discount are exactly as for a normal
--   booking. Without a service the arrival is refused (also from «تشغيل اليوم» → «وصل»). No order, price or invoice can
--   exist before that.
-- * A discount or a package cannot be set on such a booking (they are decided with the service).
-- * «تعديل الحجز» keeps it «تتحدد عند الحضور» unless a real service is chosen (then service_later = false).
-- * Snapshot: 'service_later' lists the placeholders (id, department, minutes) for the booking screen.
-- * Booking messages / reminders: unchanged (their text has no service name); screens show the placeholder name.
-- Rollback: supabase/rollbacks/20261122060000_booking_service_later.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('public.clinic_reception_snapshot(uuid,date,date)') is null
     or to_regprocedure('clinic_reception.has_provider_service_scope(uuid,text,date)') is null
     or to_regclass('clinic_reception.provider_departments') is null then raise exception 'مكونات الحجز غير موجودة'; end if;
  if to_regprocedure('clinic_reception.command_before_service_later(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.services add column if not exists placeholder boolean not null default false;
alter table clinic_reception.appointments add column if not exists service_later boolean not null default false;

-- get-or-create the (inactive) placeholder of a department
create function clinic_reception.service_later_id(p_workspace uuid, p_department text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v uuid; d text := btrim(coalesce(p_department, ''));
begin
  if length(d) < 2 then raise exception 'الدكتور مالوش قسم — مينفعش «الخدمة تتحدد عند الحضور»'; end if;
  select id into v from clinic_reception.services where workspace_id = p_workspace and placeholder and department = d;
  if v is null then
    insert into clinic_reception.services(workspace_id, code, name, department, price, minutes, active, placeholder)
      values (p_workspace, 'LATER-' || left(md5(d), 10), 'الخدمة تتحدد عند الحضور', d, 0, 30, false, true)
      on conflict (workspace_id, code, version) do nothing returning id into v;
    if v is null then select id into v from clinic_reception.services where workspace_id = p_workspace and placeholder and department = d; end if;
  end if;
  return v;
end $$;
revoke all on function clinic_reception.service_later_id(uuid, text) from public, anon, authenticated;

-- a provider serves a department as its own (main department or an extra one)
create function clinic_reception.provider_serves(p_provider uuid, p_department text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_reception.providers p where p.id = p_provider and p.department = p_department)
      or exists (select 1 from clinic_reception.provider_departments pd where pd.provider_id = p_provider and pd.department = p_department)
$$;
revoke all on function clinic_reception.provider_serves(uuid, text) from public, anon, authenticated;

-- placeholders for every department that has a provider today; new departments get one on first use
do $$ declare r record; begin
  for r in select distinct p.workspace_id, p.department d from clinic_reception.providers p where length(btrim(coalesce(p.department, ''))) >= 2
           union select distinct p.workspace_id, pd.department from clinic_reception.provider_departments pd join clinic_reception.providers p on p.id = pd.provider_id loop
    perform clinic_reception.service_later_id(r.workspace_id, r.d);
  end loop;
end $$;

-- the placeholder of a department the provider serves is in the provider's scope (booking-time check only; it is never
-- executed or ordered — arrival replaces it)
alter function clinic_reception.has_provider_service_scope(uuid, text, date) rename to has_provider_service_scope_before_later;
create function clinic_reception.has_provider_service_scope(p_provider uuid, p_code text, p_day date)
returns boolean language sql stable set search_path = pg_catalog, public as $$
  select clinic_reception.has_provider_service_scope_before_later(p_provider, p_code, p_day)
      or exists (select 1 from clinic_reception.services s join clinic_reception.providers p on p.id = p_provider and p.workspace_id = s.workspace_id
                  where s.placeholder and s.code = p_code and clinic_reception.provider_serves(p_provider, s.department))
$$;
revoke all on function clinic_reception.has_provider_service_scope(uuid, text, date) from public, anon, authenticated;
revoke all on function clinic_reception.has_provider_service_scope_before_later(uuid, text, date) from public, anon, authenticated;

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_service_later;
  alter function public.command_before_service_later(uuid, text, jsonb, uuid) set schema clinic_reception;
  alter function public.clinic_reception_snapshot(uuid, date, date) rename to snapshot_before_service_later;
  alter function public.snapshot_before_service_later(uuid, date, date) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_service_later(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function clinic_reception.snapshot_before_service_later(uuid, date, date) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap clinic_reception.appointments%rowtype; s clinic_reception.services%rowtype; ph clinic_reception.services%rowtype;
  pr clinic_reception.providers%rowtype; later boolean; phid uuid; out jsonb; b jsonb; e timestamptz; d text;
begin
  if jsonb_typeof(p_payload) <> 'object' or p_action not in ('book', 'walk_in', 'reschedule', 'arrive') then
    return clinic_reception.command_before_service_later(p_workspace, p_action, p_payload, p_token);
  end if;

  if p_action = 'arrive' then
    select * into ap from clinic_reception.appointments a
     where a.workspace_id = p_workspace and a.id = nullif(p_payload->>'id', '')::uuid for update;
    if found and ap.status = 'booked' and ap.service_later then
      select * into s from clinic_reception.services
       where workspace_id = p_workspace and id = nullif(p_payload->>'service_id', '')::uuid and active and not placeholder;
      if not found then
        raise exception 'الحجز ده «الخدمة تتحدد عند الحضور» — اختار الخدمة اللي المريض قررها في «تسجيل حضور» من الحجز والاستقبال';
      end if;
      if not (clinic_reception.provider_serves(ap.provider_id, s.department)
              or clinic_reception.has_provider_service_scope(ap.provider_id, s.code, (now() at time zone 'Africa/Cairo')::date)) then
        raise exception 'الخدمة دي مش من خدمات الدكتور ده — اختار خدمة من قسمه';
      end if;
      select * into pr from clinic_reception.providers where id = ap.provider_id;
      e := ap.starts_at + make_interval(mins => s.minutes);
      perform pg_advisory_xact_lock(hashtextextended('rx-slot:' || ap.provider_id::text, 0));
      if (select count(*) from clinic_reception.appointments x
           where x.workspace_id = p_workspace and x.provider_id = ap.provider_id and x.id <> ap.id
             and x.status not in ('cancelled', 'no_show') and x.starts_at < e and x.ends_at > ap.starts_at) >= greatest(coalesce(pr.capacity, 1), 1) then
        raise exception 'الخدمة دي أطول من الوقت المحجوز وميعاد الدكتور اللي بعده مشغول — اختار خدمة تانية أو عدّل الميعاد';
      end if;
      update clinic_reception.appointments set service_id = s.id, ends_at = e, service_later = false where id = ap.id;
    end if;
    return clinic_reception.command_before_service_later(p_workspace, p_action, p_payload - 'service_id', p_token);
  end if;

  -- book / walk_in / reschedule
  if p_action = 'reschedule' then
    select * into ap from clinic_reception.appointments a
     where a.workspace_id = p_workspace and a.id = nullif(p_payload->>'id', '')::uuid;
  end if;
  select * into ph from clinic_reception.services
   where workspace_id = p_workspace and placeholder
     and id::text = coalesce(p_payload->>'service_id', '');
  later := ph.id is not null or coalesce((p_payload->>'service_later')::boolean, false)
           or coalesce(p_action = 'reschedule' and ap.service_later and nullif(p_payload->>'service_id', '') is null, false);
  if not later then
    out := clinic_reception.command_before_service_later(p_workspace, p_action, p_payload - 'service_later', p_token);
    if p_action = 'reschedule' and ap.service_later then
      update clinic_reception.appointments set service_later = false where id = ap.id;
    end if;
    return out;
  end if;

  if nullif(p_payload->>'package_id', '') is not null then raise exception 'الباكج مش متاح مع «الخدمة تتحدد عند الحضور»'; end if;
  if nullif(btrim(coalesce(p_payload->>'discount_kind', '')), '') is not null then
    raise exception 'الخصم بيتحدد مع الخدمة — شيل الخصم أو اختار الخدمة دلوقتي';
  end if;
  select * into pr from clinic_reception.providers
   where workspace_id = p_workspace and active and id = coalesce(nullif(p_payload->>'provider_id', '')::uuid, ap.provider_id);
  if not found then raise exception 'اختار الطبيب'; end if;
  d := coalesce(ph.department, pr.department);
  if not clinic_reception.provider_serves(pr.id, d) then raise exception 'الدكتور ده مش من قسم %', d; end if;
  phid := clinic_reception.service_later_id(p_workspace, d);
  select * into ph from clinic_reception.services where id = phid;
  update clinic_reception.services set active = true where id = ph.id;
  b := (p_payload - 'service_later' - 'discount_kind') || jsonb_build_object('service_id', ph.id, 'provider_id', pr.id);
  out := clinic_reception.command_before_service_later(p_workspace, p_action, b, p_token);
  update clinic_reception.services set active = false where id = ph.id;
  update clinic_reception.appointments set service_later = true
   where workspace_id = p_workspace and id = coalesce(nullif(out->>'id', '')::uuid, ap.id) and service_id = ph.id and status = 'booked';
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

create function public.clinic_reception_snapshot(p_workspace uuid, p_from date default current_date, p_to date default current_date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  result := clinic_reception.snapshot_before_service_later(p_workspace, p_from, p_to);
  return result || jsonb_build_object('service_later', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'department', s.department,
                                        'minutes', s.minutes, 'price', 0, 'placeholder', true) order by s.department)
      from clinic_reception.services s where s.workspace_id = p_workspace and s.placeholder), '[]'::jsonb));
end $$;
revoke all on function public.clinic_reception_snapshot(uuid, date, date) from public, anon;
grant execute on function public.clinic_reception_snapshot(uuid, date, date) to authenticated;

commit;
