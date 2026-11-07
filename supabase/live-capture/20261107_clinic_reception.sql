-- LIVE CAPTURE (2026-11-07): definitions read from production with pg_get_functiondef (read-only).
-- Reference snapshot of objects that had no CREATE under supabase/. NOT a migration: do not apply blindly.
-- Grants, owners and triggers are not included.

CREATE OR REPLACE FUNCTION clinic_reception.capture_diagnostic_followup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_type text;
  v_visit clinic_reception.visits%rowtype;
begin
  if new.status='completed' and old.status is distinct from 'completed' then
    v_type:=clinic_reception.diagnostic_result_type(new.snapshot);
    if v_type is not null then
      select * into v_visit from clinic_reception.visits where id=new.visit_id;
      if found then
        insert into clinic_reception.diagnostic_followups(
          workspace_id,visit_id,appointment_id,patient_id,result_type,created_by
        ) values(
          new.workspace_id,new.visit_id,v_visit.appointment_id,v_visit.patient_id,v_type,new.created_by
        )
        on conflict(visit_id,result_type) do update
          set requested_at=least(clinic_reception.diagnostic_followups.requested_at,excluded.requested_at),
              updated_at=now();
      end if;
    end if;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION clinic_reception.diagnostic_result_type(p_snapshot jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
select case
  when lower(coalesce(p_snapshot->>'department','')||' '||coalesce(p_snapshot->>'name','')||' '||coalesce(p_snapshot->>'code','')) ~ '(تحاليل|معمل|مختبر|lab|patholog)' then 'lab_result'
  when lower(coalesce(p_snapshot->>'department','')||' '||coalesce(p_snapshot->>'name','')||' '||coalesce(p_snapshot->>'code','')) ~ '(أشعة|اشعة|radiolog|imaging|سونار|موجات|x-ray|xray|mri|ct scan|ct-sc)' then 'radiology'
  else null
end
$function$;

CREATE OR REPLACE FUNCTION clinic_reception.journey_event_exists(p_workspace uuid, p_key text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
select id from clinic_reception.journey_events where workspace_id=p_workspace and (idempotency_key=p_key or idempotency_key like p_key||':%') order by event_at limit 1
$function$;

CREATE OR REPLACE FUNCTION clinic_reception.order_ext_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare ok boolean;
begin
  if tg_op='UPDATE' and new.status is distinct from old.status then
    ok := (old.status,new.status) in (
      ('referred','scheduled'),('referred','cancelled'),
      ('scheduled','attended'),('scheduled','cancelled'),('scheduled','no_show'),
      ('attended','done'),('done','report_uploaded'),('report_uploaded','patient_notified'));
    if not ok then raise exception 'invalid order status transition % -> %',old.status,new.status; end if;
    new.status_at := now();
    insert into clinic_reception.order_status_log(order_id,from_status,to_status) values(new.order_id,old.status,new.status);
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION clinic_reception.publish_diagnostic_result()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  f clinic_reception.diagnostic_followups%rowtype;
  p clinic_reception.patients%rowtype;
  actor uuid;
  result_body text;
  followup_body text;
  ev uuid;
begin
  if new.review_status<>'approved' or new.category not in ('lab_result','radiology') then
    return new;
  end if;

  select df.* into f
  from clinic_reception.diagnostic_followups df
  join clinic_reception.patients rp on rp.id=df.patient_id
  where rp.patient_id=new.patient_id
    and df.result_type=new.category
    and df.status='pending'
    and df.requested_at::date <= coalesce(new.issued_at,new.uploaded_at::date)
    and df.requested_at::date >= coalesce(new.issued_at,new.uploaded_at::date)-90
  order by df.requested_at desc
  limit 1
  for update of df;

  if not found then return new; end if;

  select * into p from clinic_reception.patients where id=f.patient_id;
  actor:=f.created_by;

  update clinic_reception.diagnostic_followups
  set status='ready',result_file_id=new.id,ready_at=now(),updated_at=now()
  where id=f.id;

  insert into public.patient_portal_visibility(patient_id,entity_type,entity_id,portal_status)
  values(new.patient_id,'patient_file',new.id,'approved')
  on conflict(entity_type,entity_id) do update
    set patient_id=excluded.patient_id,portal_status='approved',updated_at=now();

  result_body:=case when new.category='lab_result'
    then 'ظهرت نتائج التحاليل الخاصة بزيارتك في سونو. يمكنك الاطلاع عليها من خلال حسابك في بوابة سونو.'
    else 'ظهرت نتيجة الأشعة الخاصة بزيارتك في سونو. يمكنك الاطلاع عليها من خلال حسابك في بوابة سونو.' end;

  followup_body:='نتيجتك أصبحت متاحة. يمكنك الآن حجز موعد متابعة مع الطبيب لمراجعتها. اختر حجز متابعة لبدء مسار الحجز العادي.';

  insert into clinic_reception.journey_events(
    workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,actor_id,source,idempotency_key,metadata
  )
  select f.workspace_id,f.appointment_id,f.visit_id,f.patient_id,a.provider_id,'result.ready',actor,'system','result-file:'||new.id::text,
         jsonb_build_object('patient_file_id',new.id,'result_type',new.category,'diagnostic_followup_id',f.id)
  from clinic_reception.appointments a where a.id=f.appointment_id
  on conflict do nothing
  returning id into ev;

  perform clinic_reception.queue_journey_message(
    f.workspace_id,f.appointment_id,'result_ready',result_body,'result:'||new.id::text,actor,
    jsonb_build_object('patient_file_id',new.id,'result_type',new.category,'diagnostic_followup_id',f.id,'action','open_patient_portal')
  );

  perform clinic_reception.queue_journey_message(
    f.workspace_id,f.appointment_id,'followup_booking_offer',followup_body,'followup:'||new.id::text,actor,
    jsonb_build_object('patient_file_id',new.id,'result_type',new.category,'diagnostic_followup_id',f.id,'action','start_booking','encounter_type','follow_up','origin_appointment_id',f.appointment_id)
  );

  update clinic_reception.diagnostic_followups
  set result_message_queued_at=now(),followup_message_queued_at=now(),updated_at=now()
  where id=f.id;

  return new;
end
$function$;

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
