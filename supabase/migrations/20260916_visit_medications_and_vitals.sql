alter table public.patient_visits add column if not exists doctor_name text, add column if not exists specialty text, add column if not exists weight text, add column if not exists oxygen_percent text;

create table if not exists public.patient_visit_medications (
 id uuid primary key default gen_random_uuid(),
 visit_id uuid not null references public.patient_visits(id) on delete cascade,
 medicine_name text not null check (length(trim(medicine_name)) between 1 and 200),
 strength text, dosage text,
 frequency_hours integer not null check (frequency_hours between 1 and 336),
 duration_days integer not null check (duration_days between 1 and 365),
 start_date date not null default current_date,
 start_time time not null default time '08:00',
 instructions text, status text not null default 'active' check (status in ('active','stopped','completed')),
 created_by uuid references public.admins(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists patient_visit_medications_visit_idx on public.patient_visit_medications(visit_id,start_date);

create table if not exists public.patient_medication_dose_completions (
 id uuid primary key default gen_random_uuid(),
 medication_id uuid not null references public.patient_visit_medications(id) on delete cascade,
 scheduled_key text not null check (scheduled_key ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$'),
 scheduled_date date not null, scheduled_time time not null,
 status text not null check (status in ('taken','missed')), taken_at timestamptz,
 recorded_by_admin_id uuid references public.admins(id), recorded_by_account_id uuid references public.patient_accounts(id),
 updated_at timestamptz not null default now(), unique(medication_id,scheduled_key)
);
create index if not exists patient_medication_dose_completions_medication_idx on public.patient_medication_dose_completions(medication_id,scheduled_date desc);

create or replace function public.set_patient_visit_medications(p_visit_id uuid,p_medications jsonb)
returns setof public.patient_visit_medications language plpgsql security invoker set search_path=public as $$
declare v_patient_id uuid;
begin
 if jsonb_typeof(coalesce(p_medications,'[]'::jsonb)) <> 'array' then raise exception 'INVALID_MEDICATIONS'; end if;
 select patient_id into v_patient_id from public.patient_visits where id=p_visit_id;
 if v_patient_id is null then raise exception 'VISIT_NOT_FOUND'; end if;
 if not (public.has_archive_access() or public.can_manage_all_content() or public.is_assigned_doctor_for_patient(v_patient_id)) then raise exception 'NOT_ALLOWED'; end if;
 delete from public.patient_visit_medications where visit_id=p_visit_id;
 insert into public.patient_visit_medications(visit_id,medicine_name,strength,dosage,frequency_hours,duration_days,start_date,start_time,instructions,status)
 select p_visit_id,nullif(trim(x.medicine_name),''),nullif(trim(x.strength),''),nullif(trim(x.dosage),''),x.frequency_hours,x.duration_days,coalesce(x.start_date,current_date),coalesce(x.start_time,time '08:00'),nullif(trim(x.instructions),''),coalesce(nullif(x.status,''),'active')
 from jsonb_to_recordset(coalesce(p_medications,'[]'::jsonb)) as x(medicine_name text,strength text,dosage text,frequency_hours integer,duration_days integer,start_date date,start_time time,instructions text,status text);
 return query select * from public.patient_visit_medications where visit_id=p_visit_id order by created_at,id;
end $$;

alter table public.patient_visit_medications enable row level security;
drop policy if exists "visit medications read" on public.patient_visit_medications;
create policy "visit medications read" on public.patient_visit_medications for select to authenticated using(exists(select 1 from public.patient_visits v where v.id=visit_id and (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads() or public.is_assigned_doctor_for_patient(v.patient_id))));
drop policy if exists "visit medications write" on public.patient_visit_medications;
create policy "visit medications write" on public.patient_visit_medications for all to authenticated using(exists(select 1 from public.patient_visits v where v.id=visit_id and (public.has_archive_access() or public.can_manage_all_content() or public.is_assigned_doctor_for_patient(v.patient_id)))) with check(exists(select 1 from public.patient_visits v where v.id=visit_id and (public.has_archive_access() or public.can_manage_all_content() or public.is_assigned_doctor_for_patient(v.patient_id))));

alter table public.patient_medication_dose_completions enable row level security;
drop policy if exists "medication dose completions read" on public.patient_medication_dose_completions;
create policy "medication dose completions read" on public.patient_medication_dose_completions for select to authenticated using(exists(select 1 from public.patient_visit_medications m join public.patient_visits v on v.id=m.visit_id where m.id=medication_id and (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads() or public.is_assigned_doctor_for_patient(v.patient_id))));