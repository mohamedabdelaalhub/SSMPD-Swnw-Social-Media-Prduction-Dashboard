-- تراجع 20261108210000: يرجّع التعريفات القديمة (بالـregex القديم) والصلاحيات القديمة.

CREATE OR REPLACE FUNCTION public.clinic_reception_checkin_candidates(p_phone text, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare s clinic_reception.journey_settings%rowtype; ws uuid; dist double precision; result jsonb;
begin
  select w.id into ws
  from clinic_reception.workspaces w
  join clinic_reception.settings st on st.id=w.id
  where w.mode='live' and st.live_enabled
  order by w.created_at
  limit 1;
  if ws is null then return '[]'::jsonb; end if;
  select * into s from clinic_reception.journey_settings where workspace_id=ws;
  if coalesce(s.location_required,true) then
    if s.clinic_lat is null or s.clinic_lng is null then raise exception 'موقع المركز لم يتم اعتماده بعد لتسجيل الوصول بالـ QR'; end if;
    if p_lat is null or p_lng is null then raise exception 'فعّل الموقع لإكمال تسجيل الوصول'; end if;
    dist:=6371000*2*asin(sqrt(power(sin(radians(p_lat-s.clinic_lat)/2),2)+cos(radians(s.clinic_lat))*cos(radians(p_lat))*power(sin(radians(p_lng-s.clinic_lng)/2),2)));
    if dist>s.radius_meters+least(coalesce(p_accuracy,0),100) then raise exception 'أنت خارج نطاق المركز المسموح لتسجيل الوصول'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('appointment_id',a.id,'starts_at',a.starts_at,'provider_name',pr.name,'service_name',sv.name) order by a.starts_at),'[]'::jsonb)
  into result
  from clinic_reception.appointments a
  join clinic_reception.workspaces w on w.id=a.workspace_id and w.mode='live'
  join clinic_reception.patients p on p.id=a.patient_id
  join clinic_reception.providers pr on pr.id=a.provider_id
  join clinic_reception.services sv on sv.id=a.service_id
  where a.workspace_id=ws
    and regexp_replace(p.phone,'\\D','','g')=regexp_replace(p_phone,'\\D','','g')
    and length(regexp_replace(p_phone,'\\D','','g'))>=8
    and (a.starts_at at time zone 'Africa/Cairo')::date=clinic_reception.today()
    and a.status in ('booked','arrived');
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_checkin_static(p_appointment uuid, p_phone text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_accuracy double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a clinic_reception.appointments%rowtype; actor uuid; tok uuid;begin
  select a.* into a
  from clinic_reception.appointments a
  join clinic_reception.workspaces w on w.id=a.workspace_id and w.mode='live'
  join clinic_reception.patients p on p.id=a.patient_id
  where a.id=p_appointment
    and a.status in ('booked','arrived')
    and (a.starts_at at time zone 'Africa/Cairo')::date=clinic_reception.today()
    and regexp_replace(p.phone,'\\D','','g')=regexp_replace(p_phone,'\\D','','g')
    and length(regexp_replace(p_phone,'\\D','','g'))>=8
  for update of a;
  if not found then raise exception 'لم نجد حجز اليوم بهذه البيانات'; end if;
  select owner_id into actor from clinic_reception.workspaces where id=a.workspace_id;
  insert into clinic_reception.checkin_tokens(workspace_id,appointment_id,expires_at,created_by)
  values(a.workspace_id,a.id,now()+interval '10 minutes',actor) returning token into tok;
  return public.clinic_reception_checkin_public(tok,p_lat,p_lng,p_accuracy);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_pbx_event(p_provider text, p_external_call_id text, p_direction text, p_status text, p_caller text DEFAULT NULL::text, p_callee text DEFAULT NULL::text, p_started_at timestamp with time zone DEFAULT now(), p_answered_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ended_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_duration_seconds integer DEFAULT NULL::integer, p_recording_url text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ws uuid; phone text; pat clinic_reception.patients%rowtype; appt clinic_reception.appointments%rowtype; callid uuid; ev uuid;
begin
  if p_direction not in ('inbound','outbound') then raise exception 'Invalid direction'; end if;
  if p_status not in ('ringing','answered','missed','completed','failed','busy','cancelled') then raise exception 'Invalid status'; end if;
  if nullif(trim(p_external_call_id),'') is null then raise exception 'External call id required'; end if;
  if not exists(select 1 from clinic_reception.settings s where s.id and s.live_enabled) then raise exception 'Reception live mode is disabled'; end if;
  select w.id into ws from clinic_reception.workspaces w where w.mode='live' order by w.created_at limit 1;
  if ws is null then raise exception 'No live workspace'; end if;
  phone:=case when p_direction='inbound' then p_caller else p_callee end;
  if nullif(regexp_replace(coalesce(phone,''),'\\D','','g'),'') is not null then
    select * into pat from clinic_reception.patients p where p.workspace_id=ws and right(regexp_replace(p.phone,'\\D','','g'),10)=right(regexp_replace(phone,'\\D','','g'),10) order by p.updated_at desc limit 1;
  end if;
  if pat.id is not null then
    select * into appt from clinic_reception.appointments a where a.workspace_id=ws and a.patient_id=pat.id and a.starts_at between p_started_at-interval '2 days' and p_started_at+interval '14 days' order by abs(extract(epoch from (a.starts_at-p_started_at))) limit 1;
  end if;

  insert into clinic_reception.call_events(workspace_id,appointment_id,patient_id,direction,status,provider,external_call_id,caller,callee,started_at,answered_at,ended_at,duration_seconds,recording_url,metadata,updated_at)
  values(ws,appt.id,pat.id,p_direction,p_status,coalesce(nullif(p_provider,''),'pbx'),p_external_call_id,p_caller,p_callee,coalesce(p_started_at,now()),p_answered_at,p_ended_at,p_duration_seconds,p_recording_url,coalesce(p_metadata,'{}'::jsonb),now())
  on conflict(provider,external_call_id) do update set
    status=excluded.status,appointment_id=coalesce(clinic_reception.call_events.appointment_id,excluded.appointment_id),patient_id=coalesce(clinic_reception.call_events.patient_id,excluded.patient_id),
    caller=coalesce(excluded.caller,clinic_reception.call_events.caller),callee=coalesce(excluded.callee,clinic_reception.call_events.callee),
    answered_at=coalesce(excluded.answered_at,clinic_reception.call_events.answered_at),ended_at=coalesce(excluded.ended_at,clinic_reception.call_events.ended_at),
    duration_seconds=coalesce(excluded.duration_seconds,clinic_reception.call_events.duration_seconds),recording_url=coalesce(excluded.recording_url,clinic_reception.call_events.recording_url),
    metadata=clinic_reception.call_events.metadata||excluded.metadata,updated_at=now()
  returning id into callid;

  if appt.id is not null and p_status in ('missed','completed','answered') then
    insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,source,idempotency_key,metadata)
    values(ws,appt.id,(select id from clinic_reception.visits where appointment_id=appt.id),appt.patient_id,appt.provider_id,'call.'||p_status,'system','pbx:'||coalesce(nullif(p_provider,''),'pbx')||':'||p_external_call_id||':'||p_status,jsonb_build_object('call_id',callid,'direction',p_direction,'phone',phone))
    on conflict(workspace_id,idempotency_key) where idempotency_key is not null do nothing
    returning id into ev;
  end if;
  return jsonb_build_object('call_id',callid,'workspace_id',ws,'patient_id',pat.id,'appointment_id',appt.id,'event_id',ev);
end $function$;

grant execute on function public.staff_kpis_admin(timestamp with time zone, timestamp with time zone) to authenticated;
grant execute on function public.claude_autoschedule_approved() to authenticated;
