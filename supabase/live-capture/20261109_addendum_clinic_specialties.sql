-- Live capture addendum (2026-11-09). REFERENCE ONLY - not a migration, nothing here was applied.
-- Table public.clinic_specialties existed on production with no CREATE anywhere under supabase/.
-- Read-only structure captured from pg_attribute / pg_constraint / pg_policies. 17 rows live (seed rows not captured).
-- Not captured: grants (anon, authenticated, service_role, postgres all hold full table privileges; RLS is what protects it,
-- and no policy targets anon), triggers (none), dependent functions (none reference it).
create table if not exists public.clinic_specialties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  doctors text[] not null default '{}'::text[],
  notes text,
  sort integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.clinic_specialties enable row level security;
create policy clinic_specialties_read on public.clinic_specialties
  for select to authenticated using (clinic_info_access());
create policy clinic_specialties_write on public.clinic_specialties
  for all to authenticated using (clinic_info_edit()) with check (clinic_info_edit());
