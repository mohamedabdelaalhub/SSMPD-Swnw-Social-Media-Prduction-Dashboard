-- Patient Portal: link experience ratings to a concrete completed visit/service.
-- Existing staff-created ratings remain valid and are marked source='staff'.

alter table public.patient_experience_ratings
  add column if not exists patient_visit_id uuid references public.patient_visits(id) on delete set null,
  add column if not exists portal_account_id uuid references public.patient_accounts(id) on delete set null,
  add column if not exists encounter_type text,
  add column if not exists source text not null default 'staff';

alter table public.patient_experience_ratings
  drop constraint if exists patient_experience_ratings_source_check;
alter table public.patient_experience_ratings
  add constraint patient_experience_ratings_source_check
  check (source in ('staff','patient_portal'));

alter table public.patient_experience_ratings
  drop constraint if exists patient_experience_ratings_encounter_type_check;
alter table public.patient_experience_ratings
  add constraint patient_experience_ratings_encounter_type_check
  check (
    encounter_type is null or encounter_type in (
      'checkup','follow_up','emergency','session','lab','radiology','home_visit'
    )
  );

create unique index if not exists uq_patient_experience_ratings_visit
  on public.patient_experience_ratings(patient_visit_id)
  where patient_visit_id is not null;

create index if not exists idx_patient_experience_ratings_portal_account
  on public.patient_experience_ratings(portal_account_id, created_at desc)
  where portal_account_id is not null;

comment on column public.patient_experience_ratings.patient_visit_id is
  'Concrete completed patient visit/service being rated. One rating per visit.';
comment on column public.patient_experience_ratings.portal_account_id is
  'Patient portal account that submitted the rating when source=patient_portal.';
comment on column public.patient_experience_ratings.encounter_type is
  'Snapshot of the rated service type at submission time.';
comment on column public.patient_experience_ratings.source is
  'staff for dashboard-entered legacy/current ratings, patient_portal for self-service ratings.';
