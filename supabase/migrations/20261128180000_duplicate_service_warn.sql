-- «تنبيه الخدمة المكررة» (owner 2026-11-28, via main chat 7): «لما يبقى الموظف الاستقبال بيضيف خدمة هي موجودة بالفعل، نفس الخدمة،
-- ينبهوا إن الخدمة دي موجودة بالفعل، عايزها تكررها فعلا، تضيفها فعلا، ولا أخطأت، فيختار هو عايزها فعلا أو لأ تراجع».
-- Server guard (so Masa / the agent / any other path cannot duplicate a service silently either):
--   public.clinic_reception_command actions 'order_add' (+ إضافة خدمة / تغيير الخدمة), 'book' and 'walk_in': when the SAME service
--   (same services.code) is already, not cancelled,
--     · on the same visit (order_add), or
--     · on the same patient's visits of today's business day (an order), or
--     · booked for the same patient on the same business day (an appointment that is not cancelled / no-show),
--   the command is refused with hint 'duplicate_service' (detail = json: service, code, at, by, where, visit_no) unless
--   payload.confirm_duplicate = true. A replayed token is never refused (it returns the first answer as before).
--   public.clinic_reception_journey_request_service (service request from «تشغيل اليوم»): same check, same hint;
--   the confirmed retry is public.clinic_reception_journey_request_service_again (same arguments, same access check inside).
--   public.clinic_reception_duplicate_service_check: read-only check the screens call the MOMENT a service is chosen (before «حفظ»).
-- Rename-wrap: the previous functions are kept as clinic_reception.command_before_dup_service and
-- clinic_reception.journey_request_service_before_dup. Nothing removed.
-- Rollback: supabase/rollbacks/20261128180000_duplicate_service_warn.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('public.clinic_reception_journey_request_service(uuid,uuid,uuid,uuid)') is null
     or to_regclass('clinic_reception.commands') is null then
    raise exception 'clinic_reception_command / journey_request_service / commands غير موجودة'; end if;
  if to_regprocedure('clinic_reception.command_before_dup_service(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- business day of a timestamp (the 04:00 cut-off when 20261127340000 is applied, else the Cairo date)
do $d$ begin
  if to_regprocedure('clinic_reception.business_day(timestamptz)') is not null then
    execute $f$create function clinic_reception.dup_service_day(p_at timestamptz) returns date language sql stable
      security definer set search_path = pg_catalog, public as 'select clinic_reception.business_day(p_at)'$f$;
  else
    execute $f$create function clinic_reception.dup_service_day(p_at timestamptz) returns date language sql stable
      set search_path = pg_catalog as $b$select (p_at at time zone 'Africa/Cairo')::date$b$$f$;
  end if;
end $d$;

create function clinic_reception.dup_service_clock(p_at timestamptz) returns text language sql stable set search_path = pg_catalog as $$
  select ltrim(to_char(p_at at time zone 'Africa/Cairo', 'HH12:MI'), '0') || case when extract(hour from p_at at time zone 'Africa/Cairo') < 12 then ' ص' else ' م' end
$$;

-- the existing same-code service for this patient (visit first, then today's visits, then today's bookings); null when none
create function clinic_reception.dup_service_find(p_workspace uuid, p_patient uuid, p_visit uuid, p_service uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_code text; v_name text; r record;
begin
  select s.code, s.name into v_code, v_name from clinic_reception.services s where s.id = p_service and s.workspace_id = p_workspace;
  if v_code is null or p_patient is null then return null; end if;
  select o.created_at, o.created_by, v.id visit_id, v.visit_no, (v.id = p_visit) same_visit into r
    from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id
    join clinic_reception.services s on s.id = o.service_id
   where o.workspace_id = p_workspace and v.patient_id = p_patient and o.status <> 'cancelled' and s.code = v_code
     and (v.id = p_visit or clinic_reception.dup_service_day(v.opened_at) = p_day)
   order by (v.id = p_visit) desc, o.created_at desc limit 1;
  if found then
    return jsonb_build_object('service', v_name, 'code', v_code, 'where', case when r.same_visit then 'visit' else 'today' end,
      'visit_no', r.visit_no, 'at', clinic_reception.dup_service_clock(r.created_at),
      'by', coalesce((select coalesce(to_jsonb(a)->>'name', to_jsonb(a)->>'email') from public.admins a where a.id = r.created_by), ''));
  end if;
  select a.starts_at, a.created_by into r
    from clinic_reception.appointments a join clinic_reception.services s on s.id = a.service_id
   where a.workspace_id = p_workspace and a.patient_id = p_patient and a.status not in ('cancelled', 'no_show') and s.code = v_code
     and clinic_reception.dup_service_day(a.starts_at) = p_day
     and not exists (select 1 from clinic_reception.visits v where v.appointment_id = a.id)
   order by a.starts_at limit 1;
  if found then
    return jsonb_build_object('service', v_name, 'code', v_code, 'where', 'booking', 'at', clinic_reception.dup_service_clock(r.starts_at),
      'by', coalesce((select coalesce(to_jsonb(x)->>'name', to_jsonb(x)->>'email') from public.admins x where x.id = r.created_by), ''));
  end if;
  return null;
end $$;

create function clinic_reception.dup_service_message(d jsonb, p_booking boolean) returns text language sql immutable set search_path = pg_catalog as $$
  select 'الخدمة دي (' || (d->>'service') || ') ' ||
      case d->>'where'
        when 'visit' then 'موجودة بالفعل على الزيارة دي — اتضافت الساعة ' || (d->>'at')
        when 'today' then 'موجودة بالفعل للمريض ده النهارده (زيارة ' || coalesce(d->>'visit_no', '') || ') — اتضافت الساعة ' || (d->>'at')
        else 'محجوزة بالفعل للمريض ده النهارده الساعة ' || (d->>'at') end ||
      case when coalesce(d->>'by', '') <> '' then ' بواسطة ' || (d->>'by') else '' end ||
      '. عايز ' || case when p_booking then 'تحجزها' else 'تضيفها' end || ' تاني فعلاً؟'
$$;

create function clinic_reception.dup_service_refuse(d jsonb, p_booking boolean) returns void language plpgsql set search_path = pg_catalog as $$
begin
  raise exception '%', clinic_reception.dup_service_message(d, p_booking) using errcode = 'P0001', hint = 'duplicate_service', detail = d::text;
end $$;

-- «أثناء التسجيل» (owner 2026-11-28: «يطلع له تنبيه … قبل ما يضيف اصلا عشان نقضي على التكرار من بابه»): the screens ask this read-only
-- check the moment a service is chosen (before «حفظ»). payload: service_id + one of visit_id / appointment_id / patient_id (+ day or
-- starts_at for a booking). Returns {duplicate:false} or {duplicate:true, message, booking, …detail}. Saves nothing.
create function public.clinic_reception_duplicate_service_check(p_workspace uuid, p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); v_patient uuid; v_visit uuid; v_service uuid; v_day date; d jsonb; booking boolean := true;
begin
  if me is null or not exists (select 1 from clinic_reception.workspaces where id = p_workspace) then raise exception 'غير مسموح'; end if;
  if not (public.has_role('super_admin') or exists (select 1 from clinic_reception.members m where m.workspace_id = p_workspace and m.admin_id = me)
          or exists (select 1 from clinic_reception.workspaces x where x.id = p_workspace and x.owner_id = me)) then raise exception 'غير مسموح'; end if;
  v_service := nullif(p_payload->>'service_id', '')::uuid;
  if nullif(p_payload->>'visit_id', '') is not null then
    select v.id, v.patient_id, clinic_reception.dup_service_day(v.opened_at) into v_visit, v_patient, v_day
      from clinic_reception.visits v where v.id = (p_payload->>'visit_id')::uuid and v.workspace_id = p_workspace;
    booking := false;
  elsif nullif(p_payload->>'appointment_id', '') is not null then
    select v.id, v.patient_id, clinic_reception.dup_service_day(v.opened_at) into v_visit, v_patient, v_day
      from clinic_reception.visits v where v.appointment_id = (p_payload->>'appointment_id')::uuid and v.workspace_id = p_workspace and v.status = 'open';
    booking := false;
  else
    v_patient := nullif(p_payload->>'patient_id', '')::uuid;
    v_day := coalesce(nullif(p_payload->>'day', '')::date, clinic_reception.dup_service_day(coalesce(nullif(p_payload->>'starts_at', '')::timestamptz, now())));
  end if;
  if v_service is null or v_patient is null or v_day is null then return jsonb_build_object('duplicate', false); end if;
  d := clinic_reception.dup_service_find(p_workspace, v_patient, v_visit, v_service, v_day);
  if d is null then return jsonb_build_object('duplicate', false); end if;
  return d || jsonb_build_object('duplicate', true, 'booking', booking, 'message', clinic_reception.dup_service_message(d, booking));
end $$;
revoke all on function public.clinic_reception_duplicate_service_check(uuid, jsonb) from public, anon;
grant execute on function public.clinic_reception_duplicate_service_check(uuid, jsonb) to authenticated;

alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_dup_service;
alter function public.command_before_dup_service(uuid, text, jsonb, uuid) set schema clinic_reception;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); v_patient uuid; v_visit uuid; v_service uuid; v_day date; d jsonb;
begin
  if p_action not in ('order_add', 'book', 'walk_in') or jsonb_typeof(p_payload) is distinct from 'object'
     or coalesce((p_payload->>'confirm_duplicate')::boolean, false) then
    return clinic_reception.command_before_dup_service(p_workspace, p_action, p_payload, p_token);
  end if;
  -- a replayed token returns the stored answer, never a duplicate warning
  if me is not null and p_token is not null
     and exists (select 1 from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token) then
    return clinic_reception.command_before_dup_service(p_workspace, p_action, p_payload, p_token);
  end if;
  begin
    v_service := nullif(p_payload->>'service_id', '')::uuid;
    if p_action = 'order_add' then
      v_visit := nullif(p_payload->>'visit_id', '')::uuid;
      select v.patient_id, clinic_reception.dup_service_day(v.opened_at) into v_patient, v_day
        from clinic_reception.visits v where v.id = v_visit and v.workspace_id = p_workspace;
    else
      v_patient := nullif(p_payload->>'patient_id', '')::uuid;
      v_day := clinic_reception.dup_service_day(coalesce(nullif(p_payload->>'starts_at', '')::timestamptz, now()));
    end if;
  exception when others then v_service := null; end;
  if v_service is not null and v_patient is not null and v_day is not null then
    d := clinic_reception.dup_service_find(p_workspace, v_patient, v_visit, v_service, v_day);
    if d is not null then perform clinic_reception.dup_service_refuse(d, p_action <> 'order_add'); end if;
  end if;
  return clinic_reception.command_before_dup_service(p_workspace, p_action, p_payload, p_token);
end $$;

alter function public.clinic_reception_journey_request_service(uuid, uuid, uuid, uuid) rename to journey_request_service_before_dup;
alter function public.journey_request_service_before_dup(uuid, uuid, uuid, uuid) set schema clinic_reception;

create function public.clinic_reception_journey_request_service(p_workspace uuid, p_appointment uuid, p_service uuid, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v clinic_reception.visits%rowtype; d jsonb;
begin
  -- a replayed token returns the stored answer (the inner function finds its journey event)
  if p_token is not null and exists (select 1 from clinic_reception.journey_events e
       where e.workspace_id = p_workspace and e.idempotency_key = 'service-request:' || p_token::text) then
    return clinic_reception.journey_request_service_before_dup(p_workspace, p_appointment, p_service, p_token);
  end if;
  select * into v from clinic_reception.visits where appointment_id = p_appointment and workspace_id = p_workspace and status = 'open';
  if found then
    d := clinic_reception.dup_service_find(p_workspace, v.patient_id, v.id, p_service, clinic_reception.dup_service_day(v.opened_at));
    if d is not null then perform clinic_reception.dup_service_refuse(d, false); end if;
  end if;
  return clinic_reception.journey_request_service_before_dup(p_workspace, p_appointment, p_service, p_token);
end $$;

-- «أيوه، ضيفها تاني»: the same request without the duplicate check (the inner function still checks access 'execute')
create function public.clinic_reception_journey_request_service_again(p_workspace uuid, p_appointment uuid, p_service uuid, p_token uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public as $$
  select clinic_reception.journey_request_service_before_dup(p_workspace, p_appointment, p_service, p_token)
$$;

-- the wrappers get exactly the privileges of the functions they wrap
do $$ declare r record; pair text[]; begin
  foreach pair slice 1 in array array[
      ['public.clinic_reception_command(uuid,text,jsonb,uuid)', 'clinic_reception.command_before_dup_service(uuid,text,jsonb,uuid)'],
      ['public.clinic_reception_journey_request_service(uuid,uuid,uuid,uuid)', 'clinic_reception.journey_request_service_before_dup(uuid,uuid,uuid,uuid)'],
      ['public.clinic_reception_journey_request_service_again(uuid,uuid,uuid,uuid)', 'clinic_reception.journey_request_service_before_dup(uuid,uuid,uuid,uuid)']] loop
    execute format('revoke all on function %s from public, anon, authenticated', pair[1]);
    for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = pair[2]::regprocedure and a.grantee <> p.proowner loop
      execute format('grant %s on function %s to %s', r.privilege_type, pair[1],
                     case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
    end loop;
  end loop;
  execute 'revoke all on function clinic_reception.command_before_dup_service(uuid,text,jsonb,uuid) from public, anon, authenticated';
  execute 'revoke all on function clinic_reception.journey_request_service_before_dup(uuid,uuid,uuid,uuid) from public, anon, authenticated';
end $$;
revoke all on function clinic_reception.dup_service_day(timestamptz), clinic_reception.dup_service_clock(timestamptz),
  clinic_reception.dup_service_find(uuid, uuid, uuid, uuid, date), clinic_reception.dup_service_refuse(jsonb, boolean),
  clinic_reception.dup_service_message(jsonb, boolean)
  from public, anon, authenticated;

commit;
