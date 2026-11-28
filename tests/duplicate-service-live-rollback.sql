-- Live rollback test for 20261128180000_duplicate_service_warn.sql («تنبيه الخدمة المكررة», owner 2026-11-28).
-- Run the WHOLE file as postgres, BEFORE the apply. ONE transaction, ends with ROLLBACK — no booking, no visit, no order kept.
-- Applies the migration inside the txn, then acts as Mazen (reception, auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb) on the LIVE
-- reception workspace with a rolled-back test patient (linked archive file) and a real doctor + a real service he serves today:
--   check at choose (read-only) · book (ok) · same token replay (same answer) · same service again today (refused, hint duplicate_service, the owner's message)
--   · confirm_duplicate (saved) · arrive · «+ إضافة خدمة» same service on the visit (refused) · confirm (saved) · another service (ok)
--   · journey «طلب خدمة» same service (refused) · «again» RPC (saved) · Mazen can execute the «again» RPC · rollback body restores.
-- Reads of clinic_reception.* happen as postgres only; the impersonated user calls the public RPCs only (like the browser).
-- Output: one table (step, ok, detail). No patient names.
do $g$ begin
  if to_regprocedure('clinic_reception.command_before_dup_service(uuid,text,jsonb,uuid)') is not null then
    raise exception '20261128180000 already applied — this dry-run is for before the apply'; end if;
end $g$;
begin;
create temp table _r(n serial, step text, ok boolean, detail text) on commit drop;
grant select, insert on _r to authenticated; grant usage on sequence _r_n_seq to authenticated;   -- the steps run as Mazen (authenticated) write their rows here

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
  if p_action not in ('order_add', 'book', 'walk_in') or jsonb_typeof(p_payload) is distinct from 'object' then
    return clinic_reception.command_before_dup_service(p_workspace, p_action, p_payload, p_token);
  end if;
  if coalesce((p_payload->>'confirm_duplicate')::boolean, false) then
    -- one answer is enough: «أيوه، احجزها تاني» also answers the older «نفس المريض في نفس اليوم» question (20261120140000)
    if p_action in ('book', 'walk_in') then p_payload := p_payload || jsonb_build_object('same_day_ok', true); end if;
    return clinic_reception.command_before_dup_service(p_workspace, p_action, p_payload, p_token);
  end if;
  -- a replayed token returns the stored first answer straight away — no guard (this one, or the older «same patient same day» one,
  -- which would otherwise see the booking the first call made) can refuse a network retry / double click
  if me is not null and p_token is not null then
    select c.response into d from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token;
    if found then return d; end if;
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

do $t$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; pr uuid; svc uuid; svc2 uuid; person uuid; pat uuid;
  slots timestamptz[]; slot timestamptz; r jsonb; r2 jsonb; ap uuid; ap2 uuid; v uuid; k uuid := gen_random_uuid(); booked boolean; last text; n0 int; n1 int;
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select id into me from public.admins where user_id = mazen;
  insert into _r(step, ok, detail) values ('live workspace + Mazen', w is not null and me is not null, null);
  -- a real active doctor with free time today and two different services he serves (consultations first)
  select p.id into pr from clinic_reception.providers p
   where p.workspace_id = w and p.active
     and exists (select 1 from clinic_reception.availability av where av.provider_id = p.id and av.ends_at > now() + interval '90 minutes'
                  and clinic_reception.dup_service_day(av.starts_at) = clinic_reception.dup_service_day(now()))
     and (select count(*) from clinic_reception.services s where s.workspace_id = w and s.active and s.price > 0
           and clinic_reception.serves_service(p.id, s.department, s.code)) >= 2
   order by p.name limit 1;
  insert into _r(step, ok, detail) values ('doctor with free time today', pr is not null, null);
  if pr is null then return; end if;
  select s.id into svc from clinic_reception.services s where s.workspace_id = w and s.active and s.price > 0 and clinic_reception.serves_service(pr, s.department, s.code)
   order by (coalesce(clinic_reception.consult_kind(s.name), '') = 'K') desc, s.price limit 1;
  select s.id into svc2 from clinic_reception.services s where s.workspace_id = w and s.active and s.price > 0 and clinic_reception.serves_service(pr, s.department, s.code)
     and s.code <> (select code from clinic_reception.services where id = svc) order by s.price limit 1;
  select array_agg(gs order by gs) into slots from (select gs from clinic_reception.availability av,
      generate_series(greatest(av.starts_at, now() + interval '30 minutes'), av.ends_at - interval '30 minutes', interval '15 minutes') gs
     where av.provider_id = pr and av.ends_at > now() and clinic_reception.dup_service_day(gs) = clinic_reception.dup_service_day(now()) order by gs limit 80) x;
  insert into _r(step, ok, detail) values ('two services + free slots', svc2 is not null and coalesce(array_length(slots, 1), 0) > 2, coalesce(array_length(slots, 1), 0)::text || ' slots');
  -- rolled-back test patient with an archive file (arrival needs it)
  insert into public.patients(full_name, phone, age, created_by) values ('مريض اختبار تراجع تكرار', '010' || lpad((floor(random() * 1e8))::bigint::text, 8, '0'), 30, me) returning id into person;
  insert into clinic_reception.patients(workspace_id, patient_id, file_no, name, phone, created_by)
    select w, id, coalesce(patient_code, 'DUP-' || left(gen_random_uuid()::text, 8)), full_name, phone, me from public.patients where id = person returning id into pat;

  perform set_config('request.jwt.claims', json_build_object('sub', mazen, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  -- 1) first booking
  booked := false;
  foreach slot in array coalesce(slots, '{}') loop
    begin r := public.clinic_reception_command(w, 'book', jsonb_build_object('patient_id', pat, 'provider_id', pr, 'service_id', svc, 'starts_at', slot, 'payer_kind', 'cash'), k); booked := true; exit;
    exception when others then last := sqlerrm; end;
  end loop;
  insert into _r(step, ok, detail) values ('Mazen books the service', booked, case when booked then null else last end);
  ap := (r->>'id')::uuid;
  -- 2) same token replay
  begin r2 := public.clinic_reception_command(w, 'book', jsonb_build_object('patient_id', pat, 'provider_id', pr, 'service_id', svc, 'starts_at', slot, 'payer_kind', 'cash'), k);
    insert into _r(step, ok, detail) values ('same token replay → same answer, no warning', r2->>'id' = r->>'id', null);
  exception when others then insert into _r(step, ok, detail) values ('same token replay', false, left(sqlerrm, 160)); end;
  -- 3) same service again today → refused with the owner's message
  begin r2 := public.clinic_reception_command(w, 'book', jsonb_build_object('patient_id', pat, 'provider_id', pr, 'service_id', svc, 'starts_at', slots[array_length(slots, 1)], 'payer_kind', 'cash'), gen_random_uuid());
    insert into _r(step, ok, detail) values ('same service again today → refused', false, 'NOT refused');
  exception when others then
    insert into _r(step, ok, detail) values ('same service again today → refused (hint duplicate_service)', sqlerrm like 'الخدمة دي (%) محجوزة بالفعل للمريض ده النهارده الساعة %عايز تحجزها تاني فعلاً؟', left(sqlerrm, 200));
  end;
  -- 4) confirmed → saved
  begin r2 := public.clinic_reception_command(w, 'book', jsonb_build_object('patient_id', pat, 'provider_id', pr, 'service_id', svc, 'starts_at', slots[array_length(slots, 1)], 'payer_kind', 'cash', 'confirm_duplicate', true), gen_random_uuid());
    ap2 := (r2->>'id')::uuid; insert into _r(step, ok, detail) values ('«أيوه، احجزها تاني» (confirm_duplicate) → saved, the older same-day question not asked again', ap2 is not null, null);
  exception when others then insert into _r(step, ok, detail) values ('confirm_duplicate booking', false, left(sqlerrm, 160)); end;
  -- 5) arrive the first booking
  begin v := (public.clinic_reception_command(w, 'arrive', jsonb_build_object('id', ap), gen_random_uuid())->>'id')::uuid;
    insert into _r(step, ok, detail) values ('Mazen: arrive', v is not null, null);
  exception when others then insert into _r(step, ok, detail) values ('Mazen: arrive', false, left(sqlerrm, 160)); end;
  if v is not null then
    -- 5b) «أثناء التسجيل»: the check the screen calls the moment the service is chosen (Mazen) → duplicate + the message, saves nothing
    begin r2 := public.clinic_reception_duplicate_service_check(w, jsonb_build_object('visit_id', v, 'service_id', svc));
      insert into _r(step, ok, detail) values ('check at choose (Mazen) → duplicate + message', (r2->>'duplicate')::boolean and r2->>'message' like 'الخدمة دي (%) موجودة بالفعل على الزيارة دي%', left(r2->>'message', 200));
      r2 := public.clinic_reception_duplicate_service_check(w, jsonb_build_object('visit_id', v, 'service_id', svc2));
      insert into _r(step, ok, detail) values ('check at choose, another service → no warning', not (r2->>'duplicate')::boolean, null);
    exception when others then insert into _r(step, ok, detail) values ('check at choose (Mazen)', false, left(sqlerrm, 160)); end;
    -- 6) «+ إضافة خدمة» same service on the visit → refused
    begin perform public.clinic_reception_command(w, 'order_add', jsonb_build_object('visit_id', v, 'service_id', svc, 'provider_id', pr, 'quantity', 1), gen_random_uuid());
      insert into _r(step, ok, detail) values ('«+ إضافة خدمة» same service → refused', false, 'NOT refused');
    exception when others then
      insert into _r(step, ok, detail) values ('«+ إضافة خدمة» same service → refused', sqlerrm like 'الخدمة دي (%) موجودة بالفعل على الزيارة دي — اتضافت الساعة %عايز تضيفها تاني فعلاً؟', left(sqlerrm, 200));
    end;
    -- 7) confirmed → saved
    begin perform public.clinic_reception_command(w, 'order_add', jsonb_build_object('visit_id', v, 'service_id', svc, 'provider_id', pr, 'quantity', 1, 'confirm_duplicate', true), gen_random_uuid());
      insert into _r(step, ok, detail) values ('«أيوه، ضيفها تاني» → saved', true, null);
    exception when others then insert into _r(step, ok, detail) values ('«أيوه، ضيفها تاني»', false, left(sqlerrm, 160)); end;
    -- 8) another service → no warning
    begin perform public.clinic_reception_command(w, 'order_add', jsonb_build_object('visit_id', v, 'service_id', svc2, 'provider_id', pr, 'quantity', 1), gen_random_uuid());
      insert into _r(step, ok, detail) values ('another service → added, no warning', true, null);
    exception when others then insert into _r(step, ok, detail) values ('another service', sqlerrm not like 'الخدمة دي%', 'refused for another reason: ' || left(sqlerrm, 140)); end;
    -- 9) journey «طلب خدمة» same service → refused; «again» → saved
    begin r2 := public.clinic_reception_journey_request_service(w, ap, svc, gen_random_uuid());
      insert into _r(step, ok, detail) values ('journey «طلب خدمة» same service → refused', false, 'NOT refused');
    exception when others then insert into _r(step, ok, detail) values ('journey «طلب خدمة» same service → refused', sqlerrm like 'الخدمة دي (%) موجودة بالفعل%', left(sqlerrm, 200)); end;
    begin r2 := public.clinic_reception_journey_request_service_again(w, ap, svc, gen_random_uuid());
      insert into _r(step, ok, detail) values ('journey «again» (Mazen) → saved', r2 ? 'order_id', null);
    exception when others then insert into _r(step, ok, detail) values ('journey «again» (Mazen)', false, left(sqlerrm, 160)); end;
  end if;
  execute 'reset role';
  if v is not null then
    select count(*) filter (where o.service_id = svc), count(*) into n0, n1 from clinic_reception.orders o where o.visit_id = v and o.status <> 'cancelled';
    insert into _r(step, ok, detail) values ('orders on the visit: same service ×3 (arrival + confirm + again) + another', n0 = 3 and n1 = 4, n0 || ' / ' || n1);
  end if;
  insert into _r(step, ok, detail) values ('second booking kept only after confirm', (select count(*) from clinic_reception.appointments where patient_id = pat and status <> 'cancelled') = 2, null);
end $t$;

-- the rollback body restores the previous functions (still inside the txn)
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_dup_service(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_dup_service(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function if exists public.clinic_reception_journey_request_service_again(uuid, uuid, uuid, uuid);
drop function if exists public.clinic_reception_journey_request_service(uuid, uuid, uuid, uuid);
alter function clinic_reception.journey_request_service_before_dup(uuid, uuid, uuid, uuid) set schema public;
alter function public.journey_request_service_before_dup(uuid, uuid, uuid, uuid) rename to clinic_reception_journey_request_service;
revoke all on function public.clinic_reception_journey_request_service(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_journey_request_service(uuid, uuid, uuid, uuid) to authenticated;
drop function if exists public.clinic_reception_duplicate_service_check(uuid, jsonb);
drop function if exists clinic_reception.dup_service_refuse(jsonb, boolean);
drop function if exists clinic_reception.dup_service_message(jsonb, boolean);
drop function if exists clinic_reception.dup_service_find(uuid, uuid, uuid, uuid, date);
drop function if exists clinic_reception.dup_service_clock(timestamptz);
drop function if exists clinic_reception.dup_service_day(timestamptz);
insert into _r(step, ok, detail) values ('rollback body restores', to_regprocedure('clinic_reception.command_before_dup_service(uuid,text,jsonb,uuid)') is null
  and to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is not null and to_regprocedure('public.clinic_reception_journey_request_service(uuid,uuid,uuid,uuid)') is not null, null);
select step, ok, detail from _r order by n;
rollback;
