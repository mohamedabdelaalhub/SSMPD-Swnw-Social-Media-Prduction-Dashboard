-- Owner 2026-11-20 «ملاحظاته يعتمدها الدكتور زي التمريض بالظبط»: the new role doctor_assistant (migration 20261120290000) gets
--  (a) the nursing day screen for HIS departments only (clinic_reception_my_departments), file-open log and notices for his departments;
--  (b) clinical drafts save/list_mine with the same case-doctor approval as nurses.
-- He is NOT a nurse: clinic_reception.is_nurse() is unchanged, so he stays out of the nurse settings/lists/reports and has no
-- head-nursing/manager actions. Existing function bodies are patched in place (each patch must match exactly once or the file aborts);
-- the old bodies are saved in clinic_reception.doctor_assistant_saved_defs under '300000:<signature>' for the rollback.
begin;

do $$ begin
  if to_regprocedure('clinic_reception.is_doctor_assistant(uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('public.clinic_reception_my_departments(uuid)') is null then raise exception 'apply 20261120290000 first'; end if;
end $$;

create or replace function clinic_reception.is_doctor_assistant(p_admin uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.admins a where a.id = p_admin and a.active
    and (a.role = 'doctor_assistant' or exists(select 1 from public.admin_extra_roles r where r.admin_id = a.id and r.role = 'doctor_assistant')))
$$;

-- departments of one admin's own provider record(s) (same rule as public.clinic_reception_my_departments, for any admin)
create or replace function clinic_reception.admin_departments(p_admin uuid, p_workspace uuid)
returns text[] language sql stable security definer set search_path = pg_catalog, public as $$
  with me as (select k from clinic_people.people p, unnest(array[p.doctor_key, p.code]) k where p.admin_id = p_admin and k is not null),
       pr as (select x.id, x.department from clinic_reception.providers x join me on me.k = x.doctor_key
               where x.workspace_id = p_workspace and x.active)
  select coalesce(array_agg(distinct d order by d), '{}') from (
    select department d from pr where department is not null
    union select s.department from pr join clinic_reception.provider_service_scopes sc on sc.provider_id = pr.id
      join clinic_reception.services s on s.workspace_id = p_workspace and s.code = sc.service_code and s.active
     where s.department is not null) q
$$;
revoke all on function clinic_reception.is_doctor_assistant(uuid), clinic_reception.admin_departments(uuid, uuid) from public, anon, authenticated;

-- same rule as 20261120290000's helper (a provider belongs to a person when providers.doctor_key equals the person's doctor_key OR employee code,
-- as live data has employees with code only), now for any admin; my_departments delegates to it.
create or replace function public.clinic_reception_my_departments(p_workspace uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_reception.admin_departments(public.my_admin_id(), p_workspace)
$$;

create or replace function clinic_reception.patch_fn(p_sig regprocedure, p_edits text[])
returns void language plpgsql set search_path = pg_catalog, public as $$
declare d text := pg_get_functiondef(p_sig); i int := 1; old_s text; new_s text;
begin
  insert into clinic_reception.doctor_assistant_saved_defs values ('300000:' || p_sig::text, d) on conflict (oid_name) do update set def = excluded.def;
  while i < array_length(p_edits, 1) loop
    old_s := p_edits[i]; new_s := p_edits[i + 1];
    if (length(d) - length(replace(d, old_s, ''))) <> length(old_s) then raise exception 'patch % does not match exactly once in %', i, p_sig::text; end if;
    d := replace(d, old_s, new_s);
    i := i + 2;
  end loop;
  execute d;
end $$;

-- nursing day screen + triage + notices (assistant counts as "nurse screen" user; the day list is filtered to his departments)
select clinic_reception.patch_fn('public.clinic_reception_nursing(uuid,text,jsonb)'::regprocedure, array[
  'nrs := clinic_reception.is_nurse(me);',
  'nrs := clinic_reception.is_nurse(me) or clinic_reception.is_doctor_assistant(me);',
  'pr.name doctor, q.status qstatus',
  'pr.name doctor, pr.department dept, q.status qstatus',
  'where x.sec = any(secs)) y)',
  'where case when clinic_reception.is_doctor_assistant(me) and not clinic_reception.is_nurse(me) then x.dept = any(public.clinic_reception_my_departments(p_workspace)) else x.sec = any(secs) end) y)'
]);

-- clinical drafts: same save / list_mine / approval path
select clinic_reception.patch_fn('public.clinical_drafts(text,jsonb)'::regprocedure, array[
  'nrs := clinic_reception.is_nurse(me);',
  'nrs := clinic_reception.is_nurse(me) or clinic_reception.is_doctor_assistant(me);'
]);

-- every file he opens is logged with his name, like the nurses
select clinic_reception.patch_fn('public.log_patient_file_open(uuid,text,uuid)'::regprocedure, array[
  'not clinic_reception.is_nurse(me)',
  'not (clinic_reception.is_nurse(me) or clinic_reception.is_doctor_assistant(me))'
]);

-- booking / arrival notices also go to assistants of the booking's department
select clinic_reception.patch_fn('clinic_reception.notify_nursing()'::regprocedure, array[
  E'    end loop;\n  exception when others then',
  E'    end loop;\n    for r in select a.id from public.admins a where clinic_reception.is_doctor_assistant(a.id) and not clinic_reception.is_nurse(a.id)\n               and exists (select 1 from clinic_reception.providers pv where pv.id = new.provider_id and pv.department is not null\n                           and pv.department = any(clinic_reception.admin_departments(a.id, new.workspace_id)))\n    loop\n      insert into public.staff_notifications(recipient_admin_id, kind, appointment_id, archive_patient_id, title)\n      values (r.id, kind, new.id, ap.id, t);\n    end loop;\n  exception when others then'
]);

drop function clinic_reception.patch_fn(regprocedure, text[]);
commit;
