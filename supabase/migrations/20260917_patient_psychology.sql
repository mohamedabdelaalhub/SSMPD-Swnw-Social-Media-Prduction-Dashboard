-- قسم الصحة النفسية داخل ملف المريض
create table if not exists public.patient_psychology_profiles (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  first_session_date date,
  session_type text check (session_type in ('individual','family','couple','child')),
  booking_reason text,
  main_issues text[] not null default '{}'::text[],
  main_issue_other text,
  presenting_complaint text,
  problem_started text,
  current_symptoms text,
  previous_treatment boolean,
  psychiatric_medications jsonb not null default '[]'::jsonb,
  current_stressors text,
  life_impact text check (life_impact in ('mild','moderate','severe')),
  treatment_goal text,
  specialist_notes text,
  created_by uuid references public.admins(id),
  updated_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_psychology_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_number integer not null check (session_number between 1 and 999),
  session_at timestamptz not null default now(),
  duration_minutes integer check (duration_minutes is null or duration_minutes in (30,45,50,60,75,90,120)),
  improvement_level text check (improvement_level is null or improvement_level in ('none','slight','moderate','good','major')),
  session_goal text,
  interventions text[] not null default '{}'::text[],
  intervention_other text,
  adherence_level text check (adherence_level is null or adherence_level in ('good','average','weak')),
  attendance_status text not null default 'attended' check (attendance_status in ('attended','absent','excused')),
  next_session_plan text,
  specialist_notes text,
  created_by uuid references public.admins(id),
  updated_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(patient_id, session_number)
);

create index if not exists patient_psychology_sessions_patient_date_idx
  on public.patient_psychology_sessions(patient_id, session_at desc);

alter table public.patient_psychology_profiles enable row level security;
alter table public.patient_psychology_sessions enable row level security;

drop policy if exists "psychology profiles read" on public.patient_psychology_profiles;
create policy "psychology profiles read" on public.patient_psychology_profiles
for select to authenticated
using (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads());

drop policy if exists "psychology profiles write" on public.patient_psychology_profiles;
create policy "psychology profiles write" on public.patient_psychology_profiles
for all to authenticated
using (public.has_archive_access() or public.can_manage_all_content())
with check (public.has_archive_access() or public.can_manage_all_content());

drop policy if exists "psychology sessions read" on public.patient_psychology_sessions;
create policy "psychology sessions read" on public.patient_psychology_sessions
for select to authenticated
using (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads());

drop policy if exists "psychology sessions write" on public.patient_psychology_sessions;
create policy "psychology sessions write" on public.patient_psychology_sessions
for all to authenticated
using (public.has_archive_access() or public.can_manage_all_content())
with check (public.has_archive_access() or public.can_manage_all_content());