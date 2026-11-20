-- Rollback for 20261120300000: restores the saved bodies of the four patched functions and drops the helpers.
-- Run BEFORE 20261120290000's rollback (that one drops the saved-defs table).
begin;
do $$ declare r record; begin
  for r in select oid_name, def from clinic_reception.doctor_assistant_saved_defs where oid_name like '300000:%' loop
    execute r.def;
  end loop;
  delete from clinic_reception.doctor_assistant_saved_defs where oid_name like '300000:%';
end $$;
create or replace function public.clinic_reception_my_departments(p_workspace uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, public as $f$
  with me as (select p.code from clinic_people.people p where p.admin_id = public.my_admin_id() and p.code is not null),
       pr as (select x.id, x.department from clinic_reception.providers x join me on me.code = x.doctor_key
               where x.workspace_id = p_workspace and x.active)
  select coalesce(array_agg(distinct d order by d), '{}') from (
    select department d from pr where department is not null
    union select s.department from pr join clinic_reception.provider_service_scopes sc on sc.provider_id = pr.id
      join clinic_reception.services s on s.workspace_id = p_workspace and s.code = sc.service_code and s.active
     where s.department is not null) q
$f$;
drop function if exists clinic_reception.admin_departments(uuid, uuid);
drop function if exists clinic_reception.is_doctor_assistant(uuid);
commit;
