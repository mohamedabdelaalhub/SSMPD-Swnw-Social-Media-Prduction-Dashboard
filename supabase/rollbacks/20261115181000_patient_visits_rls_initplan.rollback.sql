-- Rollback: restore the live 2026-11-15 policy expressions (per-row helper calls).
begin;
drop policy if exists "visits read" on public.patient_visits;
create policy "visits read" on public.patient_visits for select using (
  public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
  or public.is_assigned_doctor_for_patient(patient_id));
drop policy if exists "visits write" on public.patient_visits;
create policy "visits write" on public.patient_visits for insert with check (
  public.has_archive_access() or public.can_manage_all_content() or public.is_assigned_doctor_for_patient(patient_id));
drop policy if exists "visits update" on public.patient_visits;
create policy "visits update" on public.patient_visits for update using (
  public.has_archive_access() or public.can_manage_all_content() or public.is_assigned_doctor_for_patient(patient_id));
drop policy if exists "visits delete" on public.patient_visits;
create policy "visits delete" on public.patient_visits for delete using (
  public.has_archive_access() or public.can_manage_all_content());
drop index if exists public.patient_visits_created_idx;
commit;
