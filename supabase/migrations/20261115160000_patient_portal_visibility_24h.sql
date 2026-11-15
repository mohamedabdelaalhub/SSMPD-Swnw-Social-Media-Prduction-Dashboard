-- Patient Portal — Phase 2: records reach the portal 24h after creation; a doctor or staff
-- member can show one earlier ("approved") or hide it ("hidden"). The 24h rule itself lives in
-- the patient-portal-* edge functions (no row = automatic). This migration:
--   1) adds 'visit' to the entity types patient_portal_visibility accepts;
--   2) adds set_patient_portal_visibility(entity_type, entity_id, status) — the only write path
--      for the dashboard: archive staff, the patient's assigned doctor, or super admin;
--      derives patient_id from the record itself and writes an audit row.
-- Direct client writes to patient_portal_visibility are removed (the RPC replaces them).

begin;

do $m$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.patient_portal_visibility'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%entity_type%'
  loop
    execute format('alter table public.patient_portal_visibility drop constraint %I', c);
  end loop;
end
$m$;

alter table public.patient_portal_visibility
  add constraint patient_portal_visibility_entity_type_check check (entity_type in (
    'visit','medical_report','echo_report','dental_report','physio_report',
    'prescription','lab_request','radiology_request','patient_file'));

alter table public.patient_portal_visibility
  add column if not exists updated_by uuid references public.admins(id);

drop policy if exists "portal visibility write" on public.patient_portal_visibility;

-- The patient's assigned doctor may also read the status (the dashboard shows it next to each record).
drop policy if exists "portal visibility read" on public.patient_portal_visibility;
create policy "portal visibility read" on public.patient_portal_visibility
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );

create or replace function public.set_patient_portal_visibility(
  p_entity_type text, p_entity_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table text;
  v_patient uuid;
  v_admin uuid := public.my_admin_id();
begin
  if v_admin is null then raise exception 'NOT_STAFF' using errcode = '42501'; end if;
  if p_status not in ('approved','hidden','auto') then raise exception 'INVALID_STATUS'; end if;
  v_table := case p_entity_type
    when 'visit' then 'patient_visits'
    when 'medical_report' then 'patient_medical_reports'
    when 'echo_report' then 'patient_echo_reports'
    when 'dental_report' then 'patient_dental_reports'
    when 'physio_report' then 'patient_physio_reports'
    when 'prescription' then 'patient_prescriptions'
    when 'lab_request' then 'patient_lab_requests'
    when 'radiology_request' then 'patient_radiology_requests'
    when 'patient_file' then 'patient_files'
  end;
  if v_table is null then raise exception 'INVALID_ENTITY_TYPE'; end if;
  execute format('select patient_id from public.%I where id = $1', v_table) into v_patient using p_entity_id;
  if v_patient is null then raise exception 'RECORD_NOT_FOUND'; end if;

  if not (public.is_super() or public.has_archive_access()
          or public.is_assigned_doctor_for_patient(v_patient)) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_status = 'auto' then
    delete from public.patient_portal_visibility where entity_type = p_entity_type and entity_id = p_entity_id;
  else
    insert into public.patient_portal_visibility (patient_id, entity_type, entity_id, portal_status, updated_by)
    values (v_patient, p_entity_type, p_entity_id, p_status, v_admin)
    on conflict (entity_type, entity_id)
    do update set portal_status = excluded.portal_status, updated_by = excluded.updated_by, updated_at = now();
  end if;

  insert into public.patient_portal_audit_log (patient_id, actor_admin_id, action, entity_type, entity_id, metadata)
  values (v_patient, v_admin, 'portal_visibility_' || p_status, p_entity_type, p_entity_id, '{}'::jsonb);

  return jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id, 'status', p_status);
end
$$;

revoke all on function public.set_patient_portal_visibility(text, uuid, text) from public, anon;
grant execute on function public.set_patient_portal_visibility(text, uuid, text) to authenticated, service_role;

commit;
