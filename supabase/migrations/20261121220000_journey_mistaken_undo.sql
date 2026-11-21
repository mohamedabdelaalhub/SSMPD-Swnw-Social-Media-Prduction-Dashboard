-- Mistaken-action undo (owner 2026-11-22): hold -> resume by the same user within 120s restores the queue entry
-- (status + called_at) and marks both events metadata.mistaken=true; the RPC returns mistaken:true.
-- Only clinic_reception_journey_command_core changes; based on the live definition captured 2026-11-21.
begin;
CREATE OR REPLACE FUNCTION public.clinic_reception_journey_command_core(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid; a clinic_reception.appointments%rowtype; v clinic_reception.visits%rowtype; q clinic_reception.queue_entries%rowtype; ev uuid; out jsonb; kind text; body text; hold_ev clinic_reception.journey_events%rowtype; undo boolean:=false; extra jsonb:='{}'::jsonb; ds clinic_reception.doctor_sessions%rowtype; settings clinic_reception.journey_settings%rowtype;
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
    extra:=jsonb_build_object('prev_status',q.status,'prev_called_at',q.called_at);
  elsif p_action='resume' then
    -- mistaken-action rule (owner 2026-11-22): a resume by the same user within 120s of that user's hold is an undo, not real work.
    select * into hold_ev from clinic_reception.journey_events where appointment_id=a.id and event_type='consultation.on_hold' and actor_id=me and event_at>now()-interval '120 seconds' and coalesce(metadata->>'mistaken','')<>'true' order by event_at desc limit 1;
    undo:=found and q.status='on_hold';
    if undo then
      update clinic_reception.queue_entries set status=coalesce(nullif(hold_ev.metadata->>'prev_status',''),'called'),called_at=case when hold_ev.metadata ? 'prev_called_at' then nullif(hold_ev.metadata->>'prev_called_at','')::timestamptz else called_at end,updated_by=me,updated_at=now() where id=q.id;
      update clinic_reception.journey_events set metadata=metadata||jsonb_build_object('mistaken',true) where id=hold_ev.id;
      extra:=jsonb_build_object('mistaken',true,'undoes_event',hold_ev.id);
    else
      update clinic_reception.queue_entries set status='called',called_at=now(),updated_by=me,updated_at=now() where id=q.id and status='on_hold';
    end if;
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
      values(p_workspace,a.id,v.id,a.patient_id,a.provider_id,kind,me,'dashboard',p_token::text,coalesce(p_payload->'metadata','{}'::jsonb)||jsonb_build_object('action',p_action)||extra) returning id into ev;
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
  return jsonb_build_object('event_id',ev,'appointment_id',a.id,'visit_id',v.id,'event_type',kind)||case when undo then jsonb_build_object('mistaken',true) else '{}'::jsonb end;
end $function$;
notify pgrst,'reload schema';
commit;
