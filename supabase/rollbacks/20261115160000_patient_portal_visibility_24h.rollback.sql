-- Rollback of 20261115160000_patient_portal_visibility_24h. Deploy the previous patient-portal-*
-- functions first (they ignore the visibility table). Rows with entity_type 'visit' are removed.
begin;
drop function if exists public.set_patient_portal_visibility(text, uuid, text);
delete from public.patient_portal_visibility where entity_type = 'visit';
alter table public.patient_portal_visibility drop constraint if exists patient_portal_visibility_entity_type_check;
alter table public.patient_portal_visibility add constraint patient_portal_visibility_entity_type_check check (entity_type in (
  'medical_report','echo_report','dental_report','physio_report',
  'prescription','lab_request','radiology_request','patient_file'));
alter table public.patient_portal_visibility drop column if exists updated_by;
drop policy if exists "portal visibility read" on public.patient_portal_visibility;
create policy "portal visibility read" on public.patient_portal_visibility
  for select using (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads());
create policy "portal visibility write" on public.patient_portal_visibility
  for all using (public.has_archive_access() or public.can_manage_all_content())
  with check (public.has_archive_access() or public.can_manage_all_content());
commit;
