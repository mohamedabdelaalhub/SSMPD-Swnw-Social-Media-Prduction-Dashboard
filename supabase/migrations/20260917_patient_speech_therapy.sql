-- قسم التخاطب داخل ملف المريض
create table if not exists public.patient_speech_profiles (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  first_session_date date,
  issue_types text[] not null default '{}'::text[],
  issue_other text,
  planned_sessions integer check (planned_sessions is null or planned_sessions between 1 and 999),
  created_by uuid references public.admins(id),
  updated_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_speech_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_number integer not null check (session_number between 1 and 999),
  session_type text not null default 'follow_up' check (session_type in ('assessment','follow_up')),
  session_at timestamptz not null default now(),
  duration_minutes integer check (duration_minutes is null or duration_minutes in (30,45,60,90,120)),
  response_level text check (response_level is null or response_level in ('excellent','good','average','weak')),
  goals text,
  training_done text,
  homework text,
  attendance_status text not null default 'attended' check (attendance_status in ('attended','absent','excused')),
  specialist_notes text,
  next_session_at timestamptz,
  created_by uuid references public.admins(id),
  updated_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(patient_id, session_number)
);

create index if not exists patient_speech_sessions_patient_date_idx
  on public.patient_speech_sessions(patient_id, session_at desc);

alter table public.patient_speech_profiles enable row level security;
alter table public.patient_speech_sessions enable row level security;

drop policy if exists "speech profiles read" on public.patient_speech_profiles;
create policy "speech profiles read" on public.patient_speech_profiles
for select to authenticated
using (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads());

drop policy if exists "speech profiles write" on public.patient_speech_profiles;
create policy "speech profiles write" on public.patient_speech_profiles
for all to authenticated
using (public.has_archive_access() or public.can_manage_all_content())
with check (public.has_archive_access() or public.can_manage_all_content());

drop policy if exists "speech sessions read" on public.patient_speech_sessions;
create policy "speech sessions read" on public.patient_speech_sessions
for select to authenticated
using (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads());

drop policy if exists "speech sessions write" on public.patient_speech_sessions;
create policy "speech sessions write" on public.patient_speech_sessions
for all to authenticated
using (public.has_archive_access() or public.can_manage_all_content())
with check (public.has_archive_access() or public.can_manage_all_content());