-- Masa comparison alerts (owner 2026-11-22): «حجز مش موجود في ماسا» alerts showed no patient/doctor/date because their
-- ref is the dash-less booking_request_id of public.customer_bookings (no masa row, no fallback row exists).
-- Only change vs the live public.clinic_reception_fallback captured 2026-11-21: the alerts rows also join
-- public.customer_bookings on replace(booking_request_id,'-','') = ref and fall back to its customer / doctor / date / time.
-- Anchors matched exactly once each.
begin;
CREATE OR REPLACE FUNCTION public.clinic_reception_fallback(p_workspace uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid; r jsonb; ws uuid := p_workspace;
begin
  if p_action = 'list' then
    r := clinic_reception.fallback_before_reconcile(p_workspace, p_action, p_payload);
    return r || jsonb_build_object(
      'alerts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'detail', a.detail, 'created_at', a.created_at,
          'customer_name', coalesce(f.customer_name, m.patient_name, cb.customer_name), 'doctor_name', coalesce(pr.name, cb.doctor_name),
          'appointment_date', coalesce(to_char(coalesce(f.starts_at, m.starts_at) at time zone 'Africa/Cairo', 'YYYY-MM-DD'), to_char(cb.appointment_date, 'YYYY-MM-DD')),
          'appointment_time', coalesce(to_char(coalesce(f.starts_at, m.starts_at) at time zone 'Africa/Cairo', 'HH24:MI'), left(cb.appointment_time, 5))) order by a.created_at), '[]')
        from clinic_reception.fallback_alerts a
        left join clinic_reception.fallback_bookings f on f.booking_request_id = a.ref
        left join clinic_reception.masa_bookings m on 'masa:' || m.official_booking_id = a.ref
        left join public.customer_bookings cb on replace(cb.booking_request_id, '-', '') = a.ref
        left join clinic_reception.providers pr on pr.id = coalesce(f.provider_id, m.provider_id)
        where a.workspace_id = ws and a.resolved_at is null),
      'masa_imports', (select coalesce(jsonb_agg(jsonb_build_object('official_booking_id', m.official_booking_id, 'patient_name', m.patient_name,
          'phone', m.phone, 'doctor_name', pr.name, 'department', pr.department, 'needed_service', m.needed_service,
          'appointment_date', to_char(m.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
          'appointment_time', case when m.day_only then null else to_char(m.starts_at at time zone 'Africa/Cairo', 'HH24:MI') end, 'day_only', m.day_only) order by m.starts_at), '[]')
        from clinic_reception.masa_bookings m left join clinic_reception.providers pr on pr.id = m.provider_id
        where m.workspace_id = ws and m.status = 'active' and (m.starts_at at time zone 'Africa/Cairo')::date between (now() at time zone 'Africa/Cairo')::date and (now() at time zone 'Africa/Cairo')::date + 2 and (m.day_only or m.starts_at > now() - interval '2 hours')));
  elsif p_action = 'alert_resolve' then
    me := clinic_reception.access(p_workspace, 'book');
    update clinic_reception.fallback_alerts set resolved_at = now(), resolved_by = me
     where id = nullif(p_payload->>'id', '')::uuid and workspace_id = p_workspace and resolved_at is null;
    if not found then raise exception 'التنبيه غير موجود أو اتراجع قبل كده'; end if;
    return jsonb_build_object('ok', true);
  end if;
  return clinic_reception.fallback_before_reconcile(p_workspace, p_action, p_payload);
end $function$;
notify pgrst,'reload schema';
commit;
