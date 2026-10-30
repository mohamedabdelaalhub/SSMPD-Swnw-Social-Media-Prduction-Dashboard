-- Snapshot of the already-deployed Journey backend, for local tests only.
-- No production data. Captured 2026-10-31 from project uuijfbpgvtdxgaosqpxo.
create table clinic_reception.doctor_sessions (id uuid default gen_random_uuid() not null,workspace_id uuid not null,provider_id uuid not null,session_date date not null,status text default 'scheduled'::text not null,eta_minutes integer,delay_reason text,arrived_at timestamp with time zone,started_at timestamp with time zone,ended_at timestamp with time zone,updated_by uuid,created_at timestamp with time zone default now() not null,updated_at timestamp with time zone default now() not null);
create table clinic_reception.help_requests (id uuid default gen_random_uuid() not null,workspace_id uuid not null,appointment_id uuid not null,visit_id uuid,patient_id uuid not null,kind text default 'assistance'::text not null,status text default 'open'::text not null,message text,metadata jsonb default '{}'::jsonb not null,created_by uuid,created_at timestamp with time zone default now() not null,resolved_by uuid,resolved_at timestamp with time zone);
create table clinic_reception.journey_events (id uuid default gen_random_uuid() not null,workspace_id uuid not null,appointment_id uuid not null,visit_id uuid,patient_id uuid not null,provider_id uuid not null,event_type text not null,event_at timestamp with time zone default now() not null,actor_id uuid,source text default 'dashboard'::text not null,idempotency_key text,metadata jsonb default '{}'::jsonb not null);
create table clinic_reception.journey_settings (workspace_id uuid not null,clinic_lat double precision,clinic_lng double precision,radius_meters integer default 180 not null,location_required boolean default true not null,qr_enabled boolean default true not null,feedback_enabled boolean default true not null,max_wait_minutes integer default 20 not null,doctor_delay_minutes integer default 10 not null,updated_by uuid,updated_at timestamp with time zone default now() not null);
create table clinic_reception.queue_entries (id uuid default gen_random_uuid() not null,workspace_id uuid not null,appointment_id uuid not null,visit_id uuid,patient_id uuid not null,provider_id uuid not null,status text default 'expected'::text not null,priority smallint default 0 not null,priority_reason text,scheduled_at timestamp with time zone not null,queued_at timestamp with time zone,called_at timestamp with time zone,service_started_at timestamp with time zone,service_ended_at timestamp with time zone,checkin_method text,location_verified boolean,updated_by uuid,created_at timestamp with time zone default now() not null,updated_at timestamp with time zone default now() not null);
alter table clinic_reception.journey_settings add constraint journey_settings_doctor_delay_minutes_check CHECK (((doctor_delay_minutes >= 1) AND (doctor_delay_minutes <= 180)));
alter table clinic_reception.journey_settings add constraint journey_settings_max_wait_minutes_check CHECK (((max_wait_minutes >= 1) AND (max_wait_minutes <= 240)));
alter table clinic_reception.journey_settings add constraint journey_settings_pkey PRIMARY KEY (workspace_id);
alter table clinic_reception.journey_settings add constraint journey_settings_radius_meters_check CHECK (((radius_meters >= 20) AND (radius_meters <= 5000)));
alter table clinic_reception.journey_settings add constraint journey_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admins(id);
alter table clinic_reception.journey_settings add constraint journey_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id) ON DELETE CASCADE;
alter table clinic_reception.queue_entries add constraint queue_entries_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES clinic_reception.appointments(id) ON DELETE CASCADE;
alter table clinic_reception.queue_entries add constraint queue_entries_appointment_id_key UNIQUE (appointment_id);
alter table clinic_reception.queue_entries add constraint queue_entries_checkin_method_check CHECK (((checkin_method IS NULL) OR (checkin_method = ANY (ARRAY['reception'::text, 'qr'::text, 'whatsapp'::text, 'manual'::text]))));
alter table clinic_reception.queue_entries add constraint queue_entries_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES clinic_reception.patients(id);
alter table clinic_reception.queue_entries add constraint queue_entries_pkey PRIMARY KEY (id);
alter table clinic_reception.queue_entries add constraint queue_entries_priority_check CHECK (((priority >= 0) AND (priority <= 5)));
alter table clinic_reception.queue_entries add constraint queue_entries_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES clinic_reception.providers(id);
alter table clinic_reception.queue_entries add constraint queue_entries_status_check CHECK ((status = ANY (ARRAY['expected'::text, 'on_the_way'::text, 'waiting'::text, 'called'::text, 'in_service'::text, 'on_hold'::text, 'completed'::text, 'no_show'::text, 'cancelled'::text])));
alter table clinic_reception.queue_entries add constraint queue_entries_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admins(id);
alter table clinic_reception.queue_entries add constraint queue_entries_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinic_reception.visits(id) ON DELETE SET NULL;
alter table clinic_reception.queue_entries add constraint queue_entries_visit_id_key UNIQUE (visit_id);
alter table clinic_reception.queue_entries add constraint queue_entries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id) ON DELETE CASCADE;
alter table clinic_reception.doctor_sessions add constraint doctor_sessions_eta_minutes_check CHECK (((eta_minutes IS NULL) OR ((eta_minutes >= 0) AND (eta_minutes <= 480))));
alter table clinic_reception.doctor_sessions add constraint doctor_sessions_pkey PRIMARY KEY (id);
alter table clinic_reception.doctor_sessions add constraint doctor_sessions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES clinic_reception.providers(id) ON DELETE CASCADE;
alter table clinic_reception.doctor_sessions add constraint doctor_sessions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'on_the_way'::text, 'arrived'::text, 'started'::text, 'delayed'::text, 'ended'::text, 'cancelled'::text])));
alter table clinic_reception.doctor_sessions add constraint doctor_sessions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admins(id);
alter table clinic_reception.doctor_sessions add constraint doctor_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id) ON DELETE CASCADE;
alter table clinic_reception.doctor_sessions add constraint doctor_sessions_workspace_id_provider_id_session_date_key UNIQUE (workspace_id, provider_id, session_date);
alter table clinic_reception.journey_events add constraint journey_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES admins(id);
alter table clinic_reception.journey_events add constraint journey_events_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES clinic_reception.appointments(id) ON DELETE CASCADE;
alter table clinic_reception.journey_events add constraint journey_events_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES clinic_reception.patients(id);
alter table clinic_reception.journey_events add constraint journey_events_pkey PRIMARY KEY (id);
alter table clinic_reception.journey_events add constraint journey_events_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES clinic_reception.providers(id);
alter table clinic_reception.journey_events add constraint journey_events_source_check CHECK ((source = ANY (ARRAY['dashboard'::text, 'whatsapp'::text, 'qr'::text, 'system'::text, 'doctor'::text, 'patient_portal'::text])));
alter table clinic_reception.journey_events add constraint journey_events_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinic_reception.visits(id) ON DELETE SET NULL;
alter table clinic_reception.journey_events add constraint journey_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id) ON DELETE CASCADE;
alter table clinic_reception.help_requests add constraint help_requests_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES clinic_reception.appointments(id) ON DELETE CASCADE;
alter table clinic_reception.help_requests add constraint help_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES admins(id);
alter table clinic_reception.help_requests add constraint help_requests_kind_check CHECK ((kind = ANY (ARRAY['assistance'::text, 'checkin_failure'::text, 'location_verification'::text, 'priority'::text, 'complaint'::text, 'other'::text])));
alter table clinic_reception.help_requests add constraint help_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES clinic_reception.patients(id);
alter table clinic_reception.help_requests add constraint help_requests_pkey PRIMARY KEY (id);
alter table clinic_reception.help_requests add constraint help_requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES admins(id);
alter table clinic_reception.help_requests add constraint help_requests_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text, 'dismissed'::text])));
alter table clinic_reception.help_requests add constraint help_requests_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinic_reception.visits(id) ON DELETE SET NULL;
alter table clinic_reception.help_requests add constraint help_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION clinic_reception.sync_queue_from_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare qstatus text;
begin
  qstatus := case new.status when 'completed' then 'completed' when 'cancelled' then 'cancelled' when 'no_show' then 'no_show' when 'arrived' then 'waiting' else 'expected' end;
  insert into clinic_reception.queue_entries(workspace_id,appointment_id,patient_id,provider_id,status,scheduled_at,queued_at,updated_at)
  values(new.workspace_id,new.id,new.patient_id,new.provider_id,qstatus,new.starts_at,case when new.status='arrived' then coalesce(new.arrived_at,now()) end,now())
  on conflict(appointment_id) do update set
    patient_id=excluded.patient_id,
    provider_id=excluded.provider_id,
    scheduled_at=excluded.scheduled_at,
    status=case
      when excluded.status in ('completed','cancelled','no_show') then excluded.status
      when excluded.status='waiting' and clinic_reception.queue_entries.status in ('expected','on_the_way') then 'waiting'
      when excluded.status='expected' and clinic_reception.queue_entries.status in ('completed','cancelled','no_show') then 'expected'
      else clinic_reception.queue_entries.status
    end,
    queued_at=case when excluded.status='waiting' then coalesce(clinic_reception.queue_entries.queued_at,excluded.queued_at) else clinic_reception.queue_entries.queued_at end,
    updated_at=now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION clinic_reception.queue_journey_message(p_workspace uuid, p_appointment uuid, p_kind text, p_body text, p_version text, p_actor uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v uuid;
begin
  insert into clinic_reception.outbox(workspace_id,appointment_id,kind,version,body,status,created_by,approved_by,payload)
  values(p_workspace,p_appointment,p_kind,p_version,p_body,'approved',p_actor,p_actor,coalesce(p_payload,'{}'::jsonb))
  on conflict(appointment_id,kind,version) do update set body=excluded.body,payload=excluded.payload
  returning id into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_journey_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
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
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_message_claim(p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare result jsonb;begin
 if p_limit not between 1 and 50 then raise exception 'Invalid batch';end if;
 with eligible as(
   select o.id from clinic_reception.outbox o
   join clinic_reception.workspaces w on w.id=o.workspace_id
   join clinic_reception.appointments a on a.id=o.appointment_id
   join clinic_reception.patients p on p.id=a.patient_id
   join clinic_reception.consents consent on consent.workspace_id=w.id and consent.patient_id=p.id
   join clinic_reception.settings settings on settings.id
   where settings.live_enabled and settings.communications_enabled and w.mode='live' and o.status='approved' and o.delivered_at is null and o.attempts<5 and (o.lease_until is null or o.lease_until<now()) and consent.allowed and nullif(trim(p.phone),'') is not null
     and not exists(select 1 from public.leads l where l.patient_id=p.patient_id and l.do_not_contact)
     and (
       (o.kind in ('confirmation','reminder','reschedule') and a.status='booked' and a.starts_at>now() and o.version=a.starts_at::text||':'||a.status)
       or (o.kind='cancellation' and a.status='cancelled' and o.version=a.starts_at::text||':'||a.status)
       or (o.kind='journey_arrived' and a.status in ('arrived','completed'))
       or (o.kind='queue_called' and a.status='arrived')
       or (o.kind='doctor_delay' and a.status in ('booked','arrived'))
       or (o.kind='feedback_request' and a.status='completed')
       or (o.kind in ('help_ack','followup_reminder') and a.status not in ('cancelled','no_show'))
     )
   order by o.created_at,o.id for update of o skip locked limit p_limit
 ),claimed as(
   update clinic_reception.outbox o set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1 from eligible where o.id=eligible.id returning o.*
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease_token',c.lease_token,'idempotency_key','rx:'||c.id,'phone',p.phone,'body',c.body,'kind',c.kind,'appointment_id',c.appointment_id,'payload',c.payload)),'[]') into result
 from claimed c join clinic_reception.appointments a on a.id=c.appointment_id join clinic_reception.patients p on p.id=a.patient_id;
 return result;
end $function$;

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
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_agent_event(p_appointment uuid, p_event_type text, p_payload jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a clinic_reception.appointments%rowtype; v clinic_reception.visits%rowtype; ev uuid; h uuid; rating int; actor uuid;
begin
  if p_event_type not in ('patient.on_the_way','patient.help_requested','feedback.completed') then
    raise exception 'Unsupported agent event';
  end if;
  if p_idempotency_key is not null then
    select id into ev from clinic_reception.journey_events where idempotency_key=p_idempotency_key limit 1;
    if ev is not null then return jsonb_build_object('event_id',ev,'duplicate',true); end if;
  end if;
  select * into a from clinic_reception.appointments where id=p_appointment;
  if not found then raise exception 'Appointment not found'; end if;
  select * into v from clinic_reception.visits where appointment_id=a.id;
  select owner_id into actor from clinic_reception.workspaces where id=a.workspace_id;

  if p_event_type='patient.on_the_way' then
    update clinic_reception.queue_entries set status='on_the_way',updated_at=now() where appointment_id=a.id and status='expected';
  elsif p_event_type='patient.help_requested' then
    insert into clinic_reception.help_requests(workspace_id,appointment_id,visit_id,patient_id,kind,message,metadata)
    values(a.workspace_id,a.id,v.id,a.patient_id,coalesce(nullif(p_payload->>'kind',''),'assistance'),nullif(p_payload->>'message',''),coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('source','whatsapp')) returning id into h;
  elsif p_event_type='feedback.completed' then
    rating:=nullif(p_payload->>'rating','')::int;
    if rating not between 1 and 5 then raise exception 'Rating must be 1-5'; end if;
    if exists(select 1 from clinic_reception.patients p where p.id=a.patient_id and p.patient_id is not null) then
      insert into public.patient_experience_ratings(patient_id,visit_date,ratings,comment,created_by,patient_visit_id,source)
      select p.patient_id,(coalesce(v.opened_at,a.starts_at) at time zone 'Africa/Cairo')::date,jsonb_build_array(jsonb_build_object('metric','overall','rating',rating)),coalesce(p_payload->>'comment',''),null,v.archive_visit_id,'whatsapp'
      from clinic_reception.patients p where p.id=a.patient_id;
    end if;
  end if;

  insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,actor_id,source,idempotency_key,metadata)
  values(a.workspace_id,a.id,v.id,a.patient_id,a.provider_id,p_event_type,null,'whatsapp',p_idempotency_key,coalesce(p_payload,'{}'::jsonb)||case when h is not null then jsonb_build_object('help_request_id',h) else '{}'::jsonb end)
  returning id into ev;

  if p_event_type='patient.help_requested' then
    perform clinic_reception.queue_journey_message(
      a.workspace_id,
      a.id,
      'help_ack',
      'وصل طلب مساعدتك لفريق الاستقبال وسيتم التعامل معه.',
      ev::text,
      actor,
      jsonb_build_object('event_id',ev,'source','whatsapp','help_request_id',h)
    );
  end if;

  return jsonb_build_object('event_id',ev,'appointment_id',a.id,'help_request_id',h);
end $function$;

CREATE TRIGGER trg_sync_journey_queue AFTER INSERT OR UPDATE OF patient_id,provider_id,starts_at,status,arrived_at ON clinic_reception.appointments FOR EACH ROW EXECUTE FUNCTION clinic_reception.sync_queue_from_appointment();
CREATE UNIQUE INDEX journey_events_idempotency_uq ON clinic_reception.journey_events(workspace_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE clinic_reception.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE clinic_reception.outbox ADD CONSTRAINT outbox_kind_check CHECK(kind IN ('confirmation','reminder','cancellation','reschedule','journey_arrived','queue_called','doctor_delay','feedback_request','help_ack','followup_reminder'));

