-- Name-mismatch warning for uploaded patient files (owner request 2026-11-15).
-- A worker ON THE CLINIC SERVER reads each new file locally (tesseract / pdftotext — the file
-- never leaves our infrastructure), compares the name in it with the patient record and stores
-- a verdict here. Staff see a warning badge in the archive and mark it reviewed. Warning only:
-- nothing blocks uploads or changes files.

begin;

create table if not exists public.patient_file_name_checks (
  file_id         uuid primary key references public.patient_files(id) on delete cascade,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  verdict         text not null check (verdict in ('match','mismatch','no_name_found','unreadable','error')),
  score           numeric,
  detected_name   text,           -- the name printed on the document (internal staff view only)
  engine          text,
  checked_at      timestamptz not null default now(),
  reviewed_by     uuid references public.admins(id),
  reviewed_at     timestamptz,
  review_note     text
);
create index if not exists patient_file_name_checks_open_idx
  on public.patient_file_name_checks (patient_id) where verdict = 'mismatch' and reviewed_at is null;

alter table public.patient_file_name_checks enable row level security;
drop policy if exists "file name checks read" on public.patient_file_name_checks;
create policy "file name checks read" on public.patient_file_name_checks
  for select using (
    public.has_archive_access() or public.has_archive_review_access()
    or public.is_assigned_doctor_for_patient(patient_id)
  );
-- no insert/update/delete policies: the worker writes with service_role; staff review via RPC.
revoke all on table public.patient_file_name_checks from anon;

-- Worker queue: recent files without a verdict (service_role only).
create or replace function public.patient_file_name_check_queue(p_limit integer default 20, p_days integer default 30)
returns table (file_id uuid, patient_id uuid, patient_name text, file_name text, mime_type text, drive_file_id text, is_encrypted boolean, uploaded_at timestamptz)
language sql security definer stable set search_path = public as $$
  select f.id, f.patient_id, p.full_name, f.file_name, f.mime_type, f.drive_file_id, f.is_encrypted, f.uploaded_at
  from public.patient_files f
  join public.patients p on p.id = f.patient_id
  left join public.patient_file_name_checks c on c.file_id = f.id
  where c.file_id is null
    and f.uploaded_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
    and (f.mime_type ilike 'image/%' or f.mime_type = 'application/pdf'
         or f.mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
         -- many uploads carry an empty/generic mime type: fall back to the file extension
         or lower(f.file_name) ~ '\.(jpe?g|png|webp|tiff?|bmp|pdf|xlsx)$')
    and coalesce(f.mime_type, '') not in ('image/heic', 'image/heif')
  order by f.uploaded_at desc
  limit greatest(1, least(p_limit, 200));
$$;

create or replace function public.patient_file_name_check_record(
  p_file_id uuid, p_verdict text, p_score numeric, p_detected_name text, p_engine text)
returns void language plpgsql security definer set search_path = public as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.patient_files where id = p_file_id;
  if v_patient is null then raise exception 'FILE_NOT_FOUND'; end if;
  insert into public.patient_file_name_checks (file_id, patient_id, verdict, score, detected_name, engine)
  values (p_file_id, v_patient, p_verdict, p_score, left(p_detected_name, 120), left(p_engine, 60))
  on conflict (file_id) do update set verdict = excluded.verdict, score = excluded.score,
    detected_name = excluded.detected_name, engine = excluded.engine, checked_at = now(),
    reviewed_by = null, reviewed_at = null, review_note = null;
end
$$;

-- Staff: mark a warning as reviewed (e.g. "same patient, maiden name" or "moved to right patient").
create or replace function public.patient_file_name_check_review(p_file_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_patient uuid; v_admin uuid := public.my_admin_id();
begin
  select patient_id into v_patient from public.patient_file_name_checks where file_id = p_file_id;
  if v_patient is null then raise exception 'CHECK_NOT_FOUND'; end if;
  if v_admin is null or not (public.is_super() or public.has_archive_access() or public.is_assigned_doctor_for_patient(v_patient)) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.patient_file_name_checks
     set reviewed_by = v_admin, reviewed_at = now(), review_note = left(p_note, 300)
   where file_id = p_file_id;
end
$$;

revoke all on function public.patient_file_name_check_queue(integer, integer) from public, anon, authenticated;
revoke all on function public.patient_file_name_check_record(uuid, text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.patient_file_name_check_review(uuid, text) from public, anon;
grant execute on function public.patient_file_name_check_queue(integer, integer) to service_role;
grant execute on function public.patient_file_name_check_record(uuid, text, numeric, text, text) to service_role;
grant execute on function public.patient_file_name_check_review(uuid, text) to authenticated, service_role;

commit;
