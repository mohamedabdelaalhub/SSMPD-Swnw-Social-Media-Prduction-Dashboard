-- Add only. Existing speech profiles and sessions are retained.
alter table public.patient_speech_profiles
  add column if not exists assessment_details jsonb not null default '{}'::jsonb
  check (jsonb_typeof(assessment_details) = 'object');

create table if not exists public.patient_development_assessments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  assessment_kind text not null check (assessment_kind in ('behavior','skills')),
  assessment_date date,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_by uuid not null references public.admins(id),
  updated_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(details->>'assessment_date','') = coalesce(assessment_date::text,''))
);
create index if not exists patient_development_assessments_patient_date_idx
  on public.patient_development_assessments(patient_id, assessment_date desc, created_at desc);
alter table public.patient_development_assessments enable row level security;
revoke all on public.patient_development_assessments from anon;
revoke all on public.patient_development_assessments from authenticated;
grant select, insert, update on public.patient_development_assessments to authenticated;
grant all on public.patient_development_assessments to service_role;

drop policy if exists "development assessments read" on public.patient_development_assessments;
create policy "development assessments read" on public.patient_development_assessments
  for select to authenticated using (public.has_archive_access() or public.has_archive_review_access());
drop policy if exists "development assessments insert" on public.patient_development_assessments;
create policy "development assessments insert" on public.patient_development_assessments
  for insert to authenticated with check (public.has_archive_access());
drop policy if exists "development assessments update" on public.patient_development_assessments;
create policy "development assessments update" on public.patient_development_assessments
  for update to authenticated using (public.has_archive_access()) with check (public.has_archive_access());

create or replace function public.stamp_development_assessment()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if current_user <> 'service_role' and public.my_admin_id() is null then
    raise exception 'An active staff account is required';
  end if;
  if tg_op = 'UPDATE' then
    if new.patient_id is distinct from old.patient_id or new.assessment_kind is distinct from old.assessment_kind then
      raise exception 'Assessment patient and type cannot be changed';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := coalesce(public.my_admin_id(),new.created_by);
    new.created_at := clock_timestamp();
  end if;
  new.updated_by := coalesce(public.my_admin_id(),new.updated_by);
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.stamp_development_assessment() from public,anon,authenticated;
drop trigger if exists stamp_development_assessment on public.patient_development_assessments;
create trigger stamp_development_assessment before insert or update on public.patient_development_assessments
  for each row execute function public.stamp_development_assessment();
