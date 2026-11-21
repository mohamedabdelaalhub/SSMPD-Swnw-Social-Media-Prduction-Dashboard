clinic_reception_auto_book(uuid,text,jsonb)
CREATE OR REPLACE FUNCTION public.clinic_reception_auto_book(p_workspace uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid; cfg clinic_reception.auto_book_settings%rowtype; b clinic_reception.external_bookings%rowtype; f date; t date;
  pid uuid; res text; ph text; svc clinic_reception.services%rowtype;
begin
  me := clinic_reception.access(p_workspace, case when p_action = 'list' then 'view' else 'book' end);
  select * into cfg from clinic_reception.auto_book_settings where id;
  if cfg.workspace_id is distinct from p_workspace then
    if p_action = 'list' then return jsonb_build_object('enabled', false, 'rows', '[]'::jsonb); end if;
    raise exception 'الحجز التلقائي مش شغال على المساحة دي';
  end if;
  if p_action = 'list' then
    f := coalesce(nullif(p_payload->>'from', '')::date, clinic_reception.cairo_day(now()));
    t := coalesce(nullif(p_payload->>'to', '')::date, f);
    if t < f or t - f > 31 then raise exception 'اختر فترة حتى ٣١ يوم'; end if;
    return jsonb_build_object('enabled', cfg.enabled,
      'synced_at', (select max(synced_at) from clinic_reception.fallback_sync_state where key = 'bookings'),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'source', e.source, 'state', e.state, 'review_kind', e.review_kind,
          'reason', e.reason, 'day', e.day, 'starts_at', e.starts_at, 'day_only', e.day_only, 'customer_name', e.customer_name, 'phone', e.phone,
          'age', e.age, 'provider_id', e.provider_id, 'doctor_name', pr.name, 'appointment_id', e.appointment_id,
          'patient_created', e.patient_created, 'patient_code', pp.patient_code, 'created_at', e.created_at,
          'candidate', case when c.id is not null then jsonb_build_object('id', c.id, 'patient_code', c.patient_code, 'full_name', c.full_name,
             'last_visit_date', c.last_visit_date) end) order by e.day, e.starts_at nulls last)
        from clinic_reception.external_bookings e left join clinic_reception.providers pr on pr.id = e.provider_id
        left join public.patients pp on pp.id = e.public_patient_id left join public.patients c on c.id = e.candidate_patient_id
        where (e.day between f and t and e.state not in ('skipped'))
           or (e.state in ('review', 'failed', 'needs_time') and e.day >= clinic_reception.cairo_day(now()))), '[]'::jsonb),
      'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'department', s.department) order by s.department, s.name)
        from clinic_reception.services s where s.workspace_id = p_workspace and s.active), '[]'::jsonb));
  end if;

  select * into b from clinic_reception.external_bookings where id = nullif(p_payload->>'id', '')::uuid for update;
  if not found then raise exception 'الحجز غير موجود'; end if;
  if p_action = 'resolve_patient' then
    if b.state <> 'review' or b.review_kind not in ('patient', 'age') then raise exception 'الحجز ده مش مستني اختيار مريض'; end if;
    if p_payload->>'choice' = 'existing' then
      pid := coalesce(nullif(p_payload->>'patient_id', '')::uuid, b.candidate_patient_id);
      if pid is null or not exists (select 1 from public.patients where id = pid and status = 'active') then raise exception 'اختار ملف مريض نشط'; end if;
    elsif p_payload->>'choice' = 'new' then
      ph := psychcare.phone(coalesce(nullif(p_payload->>'phone', ''), b.phone));
      perform psychcare.check_basics(coalesce(nullif(trim(p_payload->>'full_name'), ''), b.customer_name), coalesce(nullif(p_payload->>'phone', ''), b.phone),
        nullif(p_payload->>'age', '')::int);
      perform clinic_reception.require_phone_owner(coalesce(nullif(p_payload->>'phone', ''), b.phone), p_payload->>'phone_owner');
      insert into public.patients(full_name, phone, phone_normalized, age, created_by, phone_owner, phone_owner_note)
        values (regexp_replace(trim(coalesce(nullif(trim(p_payload->>'full_name'), ''), b.customer_name)), '\s+', ' ', 'g'),
          coalesce(nullif(p_payload->>'phone', ''), b.phone), '+' || ph, (p_payload->>'age')::int, me, nullif(p_payload->>'phone_owner', ''), left(nullif(btrim(p_payload->>'phone_owner_note'), ''), 60)) returning id into pid;
      update clinic_reception.external_bookings set patient_created = true where id = b.id;
    else raise exception 'اختار: نفس المريض أو ملف جديد'; end if;
    update clinic_reception.external_bookings set public_patient_id = pid, reception_patient_id = null, state = 'pending', review_kind = null,
      reason = null, resolved_by = me, updated_at = now() where id = b.id;
  elsif p_action = 'set_service' then
    select * into svc from clinic_reception.services where id = nullif(p_payload->>'service_id', '')::uuid and workspace_id = p_workspace and active;
    if not found then raise exception 'اختار الخدمة'; end if;
    if b.provider_id is null then raise exception 'اربط الدكتور الأول'; end if;
    insert into clinic_reception.auto_book_services(provider_id, service_code, set_by) values (b.provider_id, svc.code, me)
      on conflict (provider_id) do update set service_code = excluded.service_code, set_by = me, set_at = now();
    update clinic_reception.external_bookings set state = 'pending', review_kind = null, reason = null, resolved_by = me, updated_at = now()
      where id = b.id or (state = 'review' and review_kind = 'service' and provider_id = b.provider_id);
  elsif p_action = 'set_time' then
    if b.state not in ('needs_time', 'review', 'failed') then raise exception 'الحجز ده متسجّل بالفعل'; end if;
    if nullif(p_payload->>'starts_at', '') is null or clinic_reception.cairo_day((p_payload->>'starts_at')::timestamptz) <> b.day then
      raise exception 'اختار ساعة في نفس يوم الحجز'; end if;
    update clinic_reception.external_bookings set starts_at = (p_payload->>'starts_at')::timestamptz, ends_at = null, day_only = false,
      state = 'pending', review_kind = null, reason = null, resolved_by = me, updated_at = now() where id = b.id;
  elsif p_action = 'retry' then
    if b.state not in ('review', 'failed') then raise exception 'الحجز ده مش محتاج إعادة'; end if;
    update clinic_reception.external_bookings set state = 'pending', review_kind = null, reason = null, attempts = 0, resolved_by = me,
      updated_at = now() where id = b.id;
  elsif p_action = 'dismiss' then
    if b.state not in ('review', 'failed', 'needs_time', 'pending') then raise exception 'الحجز ده متسجّل بالفعل'; end if;
    if length(trim(coalesce(p_payload->>'reason', ''))) < 3 then raise exception 'اكتب السبب'; end if;
    update clinic_reception.external_bookings set state = 'skipped', review_kind = null, reason = left(trim(p_payload->>'reason'), 300),
      resolved_by = me, updated_at = now() where id = b.id;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'auto_booking_dismissed', b.id, jsonb_build_object('source', b.source, 'reason', p_payload->>'reason'));
    return jsonb_build_object('id', b.id, 'state', 'skipped');
  else
    raise exception 'إجراء غير معروف';
  end if;
  if not cfg.enabled then return jsonb_build_object('id', b.id, 'state', 'pending'); end if;
  res := clinic_reception.auto_book_one(b.id);
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'auto_booking_' || p_action, b.id, jsonb_build_object('source', b.source, 'result', res));
  return jsonb_build_object('id', b.id, 'state', res);
end $function$

