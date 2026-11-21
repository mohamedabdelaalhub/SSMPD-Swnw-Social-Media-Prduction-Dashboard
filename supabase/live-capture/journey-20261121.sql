===== clinic_reception_journey_command(uuid,text,jsonb,uuid)
CREATE OR REPLACE FUNCTION public.clinic_reception_journey_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  me uuid:=public.my_admin_id();
  allowed boolean:=false;
begin
  if me is null or not exists(select 1 from public.admins where id=me and active) then raise exception 'سجل الدخول' using errcode='42501'; end if;
  allowed := public.has_role('super_admin') or public.has_role('general_manager') or case
    when p_action='settings' then false
    when p_action in ('arrive','call','priority') then public.has_role('reception') or (public.has_role('nursing') or public.has_role('doctor_assistant')) or public.has_role('head_nursing')
    when p_action in ('consultation_start','visit_complete') then public.has_role('reception') or public.has_role('sono_doctor') or (public.has_role('nursing') or public.has_role('doctor_assistant')) or public.has_role('head_nursing')
    when p_action in ('hold','resume','request_service') then public.has_role('sono_doctor') or (public.has_role('nursing') or public.has_role('doctor_assistant')) or public.has_role('head_nursing')
    when p_action in ('no_show','cancel','on_the_way','checkin_token') then public.has_role('reception') or public.has_role('customer_service')
    when p_action in ('patient_help','resolve_help') then public.has_role('reception') or public.has_role('customer_service') or (public.has_role('nursing') or public.has_role('doctor_assistant')) or public.has_role('head_nursing')
    when p_action='doctor_status' then public.has_role('reception') or (public.has_role('nursing') or public.has_role('doctor_assistant')) or public.has_role('head_nursing')
    else false
  end;
  if not allowed then raise exception 'ليس لديك صلاحية هذا الإجراء' using errcode='42501'; end if;
  return public.clinic_reception_journey_command_core(p_workspace,p_action,p_payload,p_token);
end
$function$

===== clinic_reception_journey_command_core(uuid,text,jsonb,uuid)
CREATE OR REPLACE FUNCTION public.clinic_reception_journey_command_core(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid; a clinic_reception.appointments%rowtype; v clinic_reception.visits%rowtype; q clinic_reception.queue_entries%rowtype; ev uuid; out jsonb; kind text; body text; ds clinic_reception.doctor_sessions%rowtype; settings clinic_reception.journey_settings%rowtype;
begin
  if p_token is null or jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) is distinct from 'object' then raise exception 'طلب غير صالح'; end if;
  me:=clinic_reception.access(p_workspace,case when p_action='settings' then 'manage' when p_action in ('arrive','call','consultation_start','hold','resume','visit_complete','request_service') then 'execute' else 'view' end);
  select id into ev from clinic_reception.journey_events where workspace_id=p_workspace and idempotency_key=p_token::text;
  if ev is not null then return jsonb_build_object('event_id',ev,'duplicate',true); end if;

  if p_action='settings' then
    insert into clinic_reception.journey_settings(workspace_id,clinic_lat,clinic_lng,radius_meters,location_required,qr_enabled,feedback_enabled,max_wait_minutes,doctor_delay_minutes,updated_by,updated_at)
    values(p_workspace,nullif(p_payload->>'clinic_lat','')::double precision,nullif(p_payload->>'clinic_lng','')::double precision,coalesce(nullif(p_payload->>'radius_meters','')::int,180),coalesce((p_payload->>'location_required')::boolean,true),coalesce((p_payload->>'qr_enabled')::boolean,true),coalesce((p_payload->>'feedback_enabled')::boolean,true),coalesce(nullif(p_payload->>'max_wait_minutes','')::int,20),coalesce(nullif(p_payload->>'doctor_delay_minutes','')::int,10),me,now())
    on conflict(workspace_id) do update set clinic_lat=excluded.clinic_lat,clinic_lng=excluded.clinic_lng,radius_meters=excluded.radius_meters,location_required=excluded.location_required,qr_enabled=excluded.qr_enabled,feedback_enabled=excluded.feedback_enabled,max_wait_minutes=excluded.max_wait_minutes,doctor_delay_minutes=excluded.doctor_delay_minutes,updated_by=me,updated_at=now();
    return jsonb_build_object('ok',true);
  end if;

  if p_action='resolve_help' then
    update clinic_reception.help_requests set status=coalesce(nullif(p_payload->>'status',''),'resolved'),resolved_by=me,resolved_at=now() where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and status in ('open','acknowledged') returning appointment_id into ev;
    if not found then raise exception 'طلب المساعدة غير متاح'; end if;
    return jsonb_build_object('id',p_payload->>'id');
  end if;

  if p_action='doctor_status' then
    select * into settings from clinic_reception.journey_settings where workspace_id=p_workspace;
    insert into clinic_reception.doctor_sessions(workspace_id,provider_id,session_date,status,eta_minutes,delay_reason,arrived_at,started_at,ended_at,updated_by,updated_at)
    values(p_workspace,(p_payload->>'provider_id')::uuid,coalesce(nullif(p_payload->>'session_date','')::date,clinic_reception.today()),p_payload->>'status',nullif(p_payload->>'eta_minutes','')::int,nullif(p_payload->>'delay_reason',''),case when p_payload->>'status'='arrived' then now() end,case when p_payload->>'status'='started' then now() end,case when p_payload->>'status'='ended' then now() end,me,now())
    on conflict(workspace_id,provider_id,session_date) do update set status=excluded.status,eta_minutes=excluded.eta_minutes,delay_reason=excluded.delay_reason,arrived_at=coalesce(clinic_reception.doctor_sessions.arrived_at,excluded.arrived_at),started_at=coalesce(clinic_reception.doctor_sessions.started_at,excluded.started_at),ended_at=coalesce(clinic_reception.doctor_sessions.ended_at,excluded.ended_at),updated_by=me,updated_at=now()
    returning * into ds;
    for a in select * from clinic_reception.appointments where workspace_id=p_workspace and provider_id=ds.provider_id and (starts_at at time zone 'Africa/Cairo')::date=ds.session_date and status in ('booked','arrived') loop
      insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,actor_id,source,idempotency_key,metadata)
      values(p_workspace,a.id,(select id from clinic_reception.visits where appointment_id=a.id),a.patient_id,a.provider_id,'doctor.'||ds.status,me,'dashboard',p_token::text||':'||a.id::text,jsonb_build_object('eta_minutes',ds.eta_minutes,'delay_reason',ds.delay_reason)) returning id into ev;
      if ds.status='delayed' then
        body:='نعتذر، يوجد تأخير حالي في عيادة الطبيب. التأخير المتوقع '||coalesce(ds.eta_minutes,settings.doctor_delay_minutes,10)||' دقيقة. سنحدثك إذا تغير الموعد.';
        perform clinic_reception.queue_journey_message(p_workspace,a.id,'doctor_delay',body,ev::text,me,jsonb_build_object('event_id',ev,'provider_id',a.provider_id,'eta_minutes',ds.eta_minutes));
      end if;
    end loop;
    return jsonb_build_object('id',ds.id,'status',ds.status);
  end if;

  select * into a from clinic_reception.appointments where id=(p_payload->>'appointment_id')::uuid and workspace_id=p_workspace for update;
  if not found then raise exception 'الحجز غير متاح'; end if;
  select * into v from clinic_reception.visits where appointment_id=a.id;
  select * into q from clinic_reception.queue_entries where appointment_id=a.id for update;
  if not found then
    insert into clinic_reception.queue_entries(workspace_id,appointment_id,visit_id,patient_id,provider_id,status,scheduled_at,updated_by)
    values(p_workspace,a.id,v.id,a.patient_id,a.provider_id,'expected',a.starts_at,me) returning * into q;
  end if;

  if p_action='on_the_way' then
    update clinic_reception.queue_entries set status='on_the_way',updated_by=me,updated_at=now() where id=q.id and status='expected';
    kind:='patient.on_the_way';
  elsif p_action='arrive' then
    if a.status='booked' then out:=public.clinic_reception_command(p_workspace,'arrive',jsonb_build_object('id',a.id,'encounter_type',coalesce(p_payload->>'encounter_type','checkup')),p_token); end if;
    select * into v from clinic_reception.visits where appointment_id=a.id;
    update clinic_reception.queue_entries set visit_id=v.id,status='waiting',queued_at=coalesce(queued_at,now()),checkin_method=coalesce(nullif(p_payload->>'method',''),'reception'),location_verified=coalesce((p_payload->>'location_verified')::boolean,location_verified),updated_by=me,updated_at=now() where id=q.id;
    kind:='patient.arrived';
  elsif p_action='call' then
    update clinic_reception.queue_entries set status='called',called_at=now(),updated_by=me,updated_at=now() where id=q.id and status in ('waiting','on_hold','called');
    kind:='queue.called';
    body:='دورك الآن. برجاء التوجه إلى عيادة '||(select name from clinic_reception.providers where id=a.provider_id)||'.';
  elsif p_action='consultation_start' then
    update clinic_reception.queue_entries set status='in_service',service_started_at=coalesce(service_started_at,now()),updated_by=me,updated_at=now() where id=q.id and status in ('waiting','called','on_hold','in_service');
    kind:='consultation.started';
  elsif p_action='hold' then
    update clinic_reception.queue_entries set status='on_hold',updated_by=me,updated_at=now() where id=q.id and status in ('called','in_service','waiting');
    kind:='consultation.on_hold';
  elsif p_action='resume' then
    update clinic_reception.queue_entries set status='called',called_at=now(),updated_by=me,updated_at=now() where id=q.id and status='on_hold';
    kind:='consultation.review';
  elsif p_action='visit_complete' then
    if v.id is null then raise exception 'سجل حضور المريض أولًا'; end if;
    out:=public.clinic_reception_command(p_workspace,'visit_close',jsonb_build_object('id',v.id,'reason',coalesce(p_payload->>'reason','')),p_token);
    update clinic_reception.queue_entries set status='completed',service_ended_at=now(),updated_by=me,updated_at=now() where id=q.id;
    kind:='visit.completed';
  elsif p_action='no_show' then
    out:=public.clinic_reception_command(p_workspace,'no_show',jsonb_build_object('id',a.id,'reason',coalesce(nullif(p_payload->>'reason',''),'لم يحضر المريض')),p_token);
    update clinic_reception.queue_entries set status='no_show',updated_by=me,updated_at=now() where id=q.id;
    kind:='appointment.no_show';
  elsif p_action='cancel' then
    out:=public.clinic_reception_command(p_workspace,'cancel',jsonb_build_object('id',a.id,'reason',coalesce(nullif(p_payload->>'reason',''),'إلغاء من تشغيل اليوم')),p_token);
    update clinic_reception.queue_entries set status='cancelled',updated_by=me,updated_at=now() where id=q.id;
    kind:='appointment.cancelled';
  elsif p_action='priority' then
    update clinic_reception.queue_entries set priority=coalesce(nullif(p_payload->>'priority','')::smallint,0),priority_reason=nullif(p_payload->>'reason',''),updated_by=me,updated_at=now() where id=q.id;
    kind:='queue.priority_changed';
  elsif p_action='patient_help' then
    insert into clinic_reception.help_requests(workspace_id,appointment_id,visit_id,patient_id,kind,message,metadata,created_by)
    values(p_workspace,a.id,v.id,a.patient_id,coalesce(nullif(p_payload->>'kind',''),'assistance'),nullif(p_payload->>'message',''),coalesce(p_payload->'metadata','{}'::jsonb),me) returning id into ev;
    kind:='patient.help_requested';
  elsif p_action='request_service' then
    if v.id is null then raise exception 'سجل حضور المريض أولًا'; end if;
    out:=public.clinic_reception_command(p_workspace,'order_add',jsonb_build_object('visit_id',v.id,'service_id',p_payload->>'service_id','provider_id',coalesce(nullif(p_payload->>'provider_id',''),a.provider_id::text),'quantity',coalesce(nullif(p_payload->>'quantity',''),'1')),p_token);
    kind:=case coalesce(p_payload->>'request_kind','service') when 'lab' then 'lab.requested' when 'imaging' then 'imaging.requested' when 'procedure' then 'procedure.requested' else 'service.requested' end;
  elsif p_action='checkin_token' then
    select * into settings from clinic_reception.journey_settings where workspace_id=p_workspace;
    if not coalesce(settings.qr_enabled,true) then raise exception 'تسجيل الوصول بالـ QR غير مفعل'; end if;
    insert into clinic_reception.checkin_tokens(workspace_id,appointment_id,expires_at,created_by)
    values(p_workspace,a.id,greatest(a.ends_at+interval '6 hours',now()+interval '30 minutes'),me) returning token,id into ev,q.id;
    return jsonb_build_object('token',(select token from clinic_reception.checkin_tokens where id=q.id),'expires_at',(select expires_at from clinic_reception.checkin_tokens where id=q.id));
  else
    raise exception 'إجراء رحلة غير معروف';
  end if;

  if p_action<>'patient_help' then
    select id into ev from clinic_reception.journey_events where workspace_id=p_workspace and idempotency_key=p_token::text;
    if ev is null then
      insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,actor_id,source,idempotency_key,metadata)
      values(p_workspace,a.id,v.id,a.patient_id,a.provider_id,kind,me,'dashboard',p_token::text,coalesce(p_payload->'metadata','{}'::jsonb)||jsonb_build_object('action',p_action)) returning id into ev;
    end if;
  else
    update clinic_reception.help_requests set metadata=metadata||jsonb_build_object('event_id',ev) where id=ev;
    insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,actor_id,source,idempotency_key,metadata)
    values(p_workspace,a.id,v.id,a.patient_id,a.provider_id,kind,me,'dashboard',p_token::text,jsonb_build_object('help_request_id',ev)) returning id into ev;
  end if;

  if p_action='arrive' then
    perform clinic_reception.queue_journey_message(p_workspace,a.id,'journey_arrived','تم تسجيل وصولك إلى المركز. أنت الآن ضمن قائمة الانتظار وسنبلغك عند دورك.',ev::text,me,jsonb_build_object('event_id',ev));
  elsif p_action='call' then
    perform clinic_reception.queue_journey_message(p_workspace,a.id,'queue_called',body,ev::text,me,jsonb_build_object('event_id',ev));
  elsif p_action='visit_complete' then
    select * into settings from clinic_reception.journey_settings where workspace_id=p_workspace;
    if coalesce(settings.feedback_enabled,true) then
      perform clinic_reception.queue_journey_message(p_workspace,a.id,'feedback_request','شكرًا لزيارتك سونو. قيّم تجربتك من 1 إلى 5 بالرد برقم واحد.',ev::text,me,jsonb_build_object('event_id',ev,'expects','rating_1_5'));
    end if;
  end if;
  return jsonb_build_object('event_id',ev,'appointment_id',a.id,'visit_id',v.id,'event_type',kind);
end $function$

===== clinic_reception_journey_snapshot(uuid,date)
CREATE OR REPLACE FUNCTION public.clinic_reception_journey_snapshot(p_workspace uuid, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid; d date; result jsonb;
begin
  me:=clinic_reception.access(p_workspace,'view');
  d:=coalesce(p_day,clinic_reception.today());
  select jsonb_build_object(
    'day',d,
    'settings',coalesce((select to_jsonb(s)-'updated_by' from clinic_reception.journey_settings s where s.workspace_id=p_workspace),'{}'::jsonb),
    'appointments',coalesce((select jsonb_agg(x order by x.starts_at,x.priority desc,x.patient_name) from (
      select a.id,a.patient_id,p.name patient_name,p.file_no,p.phone,a.provider_id,pr.name provider_name,pr.department,a.service_id,s.name service_name,a.starts_at,a.ends_at,a.status appointment_status,a.arrived_at,
             v.id visit_id,v.visit_no,v.status visit_status,
             q.id queue_id,coalesce(q.status,case when a.status='arrived' then 'waiting' when a.status='completed' then 'completed' when a.status='cancelled' then 'cancelled' when a.status='no_show' then 'no_show' else 'expected' end) queue_status,
             coalesce(q.priority,0) priority,q.priority_reason,q.queued_at,q.called_at,q.service_started_at,q.service_ended_at,q.checkin_method,q.location_verified,
             case when q.queued_at is not null and q.service_started_at is null and q.status in ('waiting','called','on_hold') then greatest(0,floor(extract(epoch from (now()-q.queued_at))/60))::int else 0 end wait_minutes
      from clinic_reception.appointments a
      join clinic_reception.patients p on p.id=a.patient_id
      join clinic_reception.providers pr on pr.id=a.provider_id
      join clinic_reception.services s on s.id=a.service_id
      left join clinic_reception.visits v on v.appointment_id=a.id
      left join clinic_reception.queue_entries q on q.appointment_id=a.id
      where a.workspace_id=p_workspace and (a.starts_at at time zone 'Africa/Cairo')::date=d
    ) x),'[]'::jsonb),
    'doctor_sessions',coalesce((select jsonb_agg(to_jsonb(ds)||jsonb_build_object('provider_name',pr.name,'department',pr.department) order by pr.name) from clinic_reception.doctor_sessions ds join clinic_reception.providers pr on pr.id=ds.provider_id where ds.workspace_id=p_workspace and ds.session_date=d),'[]'::jsonb),
    'help_requests',coalesce((select jsonb_agg(to_jsonb(h)||jsonb_build_object('patient_name',p.name,'provider_name',pr.name) order by h.created_at desc) from clinic_reception.help_requests h join clinic_reception.patients p on p.id=h.patient_id join clinic_reception.appointments a on a.id=h.appointment_id join clinic_reception.providers pr on pr.id=a.provider_id where h.workspace_id=p_workspace and h.status in ('open','acknowledged') and (a.starts_at at time zone 'Africa/Cairo')::date=d),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.event_at desc) from (select * from clinic_reception.journey_events where workspace_id=p_workspace and (event_at at time zone 'Africa/Cairo')::date=d order by event_at desc limit 300) e),'[]'::jsonb),
    'outbox',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'appointment_id',o.appointment_id,'kind',o.kind,'status',o.status,'created_at',o.created_at,'delivered_at',o.delivered_at,'last_error',o.last_error) order by o.created_at desc) from clinic_reception.outbox o join clinic_reception.appointments a on a.id=o.appointment_id where o.workspace_id=p_workspace and o.kind in ('journey_arrived','queue_called','doctor_delay','feedback_request','help_ack','followup_reminder') and (a.starts_at at time zone 'Africa/Cairo')::date between d-1 and d+1),'[]'::jsonb)
  ) into result;
  return result;
end $function$

===== journey_events columns
id uuid NO gen_random_uuid()
workspace_id uuid NO 
appointment_id uuid NO 
visit_id uuid YES 
patient_id uuid NO 
provider_id uuid NO 
event_type text NO 
event_at timestamp with time zone NO now()
actor_id uuid YES 
source text NO 'dashboard'::text
idempotency_key text YES 
metadata jsonb NO '{}'::jsonb
===== constraints
journey_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES admins(id)
journey_events_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES clinic_reception.appointments(id) ON DELETE CASCADE
journey_events_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES clinic_reception.patients(id)
journey_events_pkey PRIMARY KEY (id)
journey_events_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES clinic_reception.providers(id)
journey_events_source_check CHECK ((source = ANY (ARRAY['dashboard'::text, 'whatsapp'::text, 'qr'::text, 'system'::text, 'doctor'::text, 'patient_portal'::text])))
journey_events_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinic_reception.visits(id) ON DELETE SET NULL
journey_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id) ON DELETE CASCADE
===== indexes
CREATE UNIQUE INDEX journey_events_pkey ON clinic_reception.journey_events USING btree (id)
CREATE INDEX journey_events_appt_time_idx ON clinic_reception.journey_events USING btree (appointment_id, event_at DESC)
CREATE UNIQUE INDEX journey_events_idempotency_uq ON clinic_reception.journey_events USING btree (workspace_id, idempotency_key) WHERE (idempotency_key IS NOT NULL)
===== triggers
===== event types (count)
appointment.cancelled 1
appointment.no_show 2
consultation.on_hold 3
consultation.review 2
consultation.started 10
doctor.arrived 2
doctor.delayed 4
doctor.ended 8
doctor.on_the_way 22
doctor.started 2
feedback.completed 1
lab.requested 1
patient.arrived 11
patient.on_the_way 2
queue.called 14
queue.priority_changed 2
service.requested 2
visit.completed 5
