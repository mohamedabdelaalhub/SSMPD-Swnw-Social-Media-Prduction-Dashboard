alter table public.patient_visits
  add column if not exists encounter_type text;

alter table public.patient_visits
  drop constraint if exists patient_visits_encounter_type_check;

alter table public.patient_visits
  add constraint patient_visits_encounter_type_check
  check (
    encounter_type is null or encounter_type in (
      'checkup',
      'follow_up',
      'emergency',
      'session',
      'lab',
      'radiology',
      'home_visit'
    )
  );

comment on column public.patient_visits.encounter_type is
  'Encounter classification: checkup, follow_up, emergency, session, lab, radiology, or home_visit. Nullable for legacy rows until reviewed.';
