-- Staff patient screens: make patient_visits RLS cheaper (owner: "نحسنها").
-- Same rules as live (verified 2026-11-15); only the evaluation changes: the no-argument helpers
-- are wrapped in (select ...) so Postgres runs them ONCE per query (initplan) instead of once per
-- row. is_assigned_doctor_for_patient(patient_id) depends on the row and stays as is, evaluated
-- last. Plus an index for "latest visits" lists ordered by created_at (live had a seq scan).

begin;

drop policy if exists "visits read" on public.patient_visits;
create policy "visits read" on public.patient_visits
  for select using (
    (select public.has_archive_access()) or (select public.has_archive_review_access())
    or (select public.can_access_leads()) or public.is_assigned_doctor_for_patient(patient_id)
  );

drop policy if exists "visits write" on public.patient_visits;
create policy "visits write" on public.patient_visits
  for insert with check (
    (select public.has_archive_access()) or (select public.can_manage_all_content())
    or public.is_assigned_doctor_for_patient(patient_id)
  );

drop policy if exists "visits update" on public.patient_visits;
create policy "visits update" on public.patient_visits
  for update using (
    (select public.has_archive_access()) or (select public.can_manage_all_content())
    or public.is_assigned_doctor_for_patient(patient_id)
  );

drop policy if exists "visits delete" on public.patient_visits;
create policy "visits delete" on public.patient_visits
  for delete using ((select public.has_archive_access()) or (select public.can_manage_all_content()));

create index if not exists patient_visits_created_idx on public.patient_visits (created_at desc);

commit;
