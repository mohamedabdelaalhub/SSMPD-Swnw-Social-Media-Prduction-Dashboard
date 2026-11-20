-- New staff role «مساعد طبيب» (doctor_assistant) — owner «موافق على دور مساعد طبيب» (main chat 4, 2026-11-20).
-- For staff who assist a doctor but are not nurses (no cannula / wound care). First user: set by docs/ops SQL, not here.
-- * admins.role and admin_extra_roles.role accept 'doctor_assistant' (both checks rebuilt from their LIVE value lists, so no
--   live role is dropped).
-- * Today's operations: the same reception access as nursing / head nursing. Every reception function (schema
--   clinic_reception or name clinic_reception_*) that grants public.has_role('head_nursing') now also grants
--   public.has_role('doctor_assistant') — in-place text patch, old bodies saved for rollback. Archive / review / nursing
--   functions are NOT touched: the nurse picker (clinic_reception_nurses, is_nurse) and nursing reports test role in
--   ('nursing','head_nursing') directly, so an assistant never appears as a nurse.
-- * public.clinic_reception_my_departments(workspace): the departments of the caller's own provider record(s) (provider
--   department + departments of the services in its provider scopes), so the today's-operations board can show a doctor
--   assistant only his departments. Display filter only; access is unchanged.
-- Rollback: supabase/rollbacks/20261120290000_doctor_assistant_role.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_my_departments(uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table if not exists clinic_reception.doctor_assistant_saved_defs(oid_name text primary key, def text not null);
revoke all on clinic_reception.doctor_assistant_saved_defs from public, anon, authenticated;

-- 1. role checks (rebuilt from the live list + doctor_assistant)
do $$
declare t text; c text; d text; vals text[];
begin
  foreach t in array array['public.admins:admins_role_check', 'public.admin_extra_roles:admin_extra_roles_role_check'] loop
    c := split_part(t, ':', 2);
    select pg_get_constraintdef(oid) into d from pg_constraint where conname = c and conrelid = split_part(t, ':', 1)::regclass;
    if d is null then raise exception 'constraint % not found', c; end if;
    insert into clinic_reception.doctor_assistant_saved_defs values ('constraint:' || t, d) on conflict (oid_name) do update set def = excluded.def;
    select array_agg(distinct m[1] order by m[1]) into vals from regexp_matches(d, '''([a-z_]+)''', 'g') m;
    if not 'nursing' = any(vals) then raise exception 'unexpected % definition', c; end if;
    vals := array(select distinct x from unnest(vals || array['doctor_assistant']) x order by 1);
    execute format('alter table %s drop constraint %I', split_part(t, ':', 1), c);
    execute format('alter table %s add constraint %I check (role = any (%L::text[]))', split_part(t, ':', 1), c, vals);
  end loop;
end $$;

-- 2. reception access: wherever head nursing is granted in a reception function, the doctor assistant is too
do $$
declare r record; d text; a constant text := $a$public.has_role('head_nursing')$a$;
  b constant text := $b$(public.has_role('head_nursing') or public.has_role('doctor_assistant'))$b$; n int := 0;
begin
  for r in select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.prokind = 'f' and (n.nspname = 'clinic_reception' or (n.nspname = 'public' and p.proname like 'clinic_reception%'))
              and position(a in p.prosrc) > 0 and position('doctor_assistant' in p.prosrc) = 0 loop
    d := pg_get_functiondef(r.oid);
    insert into clinic_reception.doctor_assistant_saved_defs values (r.sig, d) on conflict (oid_name) do update set def = excluded.def;
    execute replace(d, a, b);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'no reception function grants head_nursing — check the live definitions'; end if;
  raise notice 'doctor_assistant: % reception functions patched', n;
end $$;

-- 3. departments of my own provider record(s)
create function public.clinic_reception_my_departments(p_workspace uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, public as $$
  with me as (select p.code from clinic_people.people p where p.admin_id = public.my_admin_id() and p.code is not null),
       pr as (select x.id, x.department from clinic_reception.providers x join me on me.code = x.doctor_key
               where x.workspace_id = p_workspace and x.active)
  select coalesce(array_agg(distinct d order by d), '{}') from (
    select department d from pr where department is not null
    union select s.department from pr join clinic_reception.provider_service_scopes sc on sc.provider_id = pr.id
      join clinic_reception.services s on s.workspace_id = p_workspace and s.code = sc.service_code and s.active
     where s.department is not null) q
$$;
revoke all on function public.clinic_reception_my_departments(uuid) from public, anon;
grant execute on function public.clinic_reception_my_departments(uuid) to authenticated;

commit;
