-- Move the existing «Instinct» dashboard account (admins.id 6bc2a2ff-9947-4a3f-a06d-e10b5130a526, created by the owner
-- 2026-11-24 19:28Z as page_manager + has_hr_access + has_price_lists_access) to role ai_assistant and clear every access.
-- One-off ops step, NOT part of the migration. Needs 20261124200000_instinct_assistant.sql applied first.
-- * Runs with the OWNER's identity (request.jwt.claim.sub = the owner's user_id) because guard_admin_changes refuses a role
--   change unless is_super(); nothing else is impersonated. No auth user is created or changed; the login stays as it is.
-- * Removes its extra roles and per-module finance permissions; sets role ai_assistant and EVERY boolean has_* / can_* column
--   of admins to false in one update (instinct_guard_ai_admin refuses an ai_assistant row with any of them true).
-- * Memberships elsewhere (reception workspace members, task projects, HR person link) are listed in the preview and left in
--   place: the restrictive policy + my_admin_id() make them unusable for an ai_assistant account.

-- ===================== 0. PREVIEW (read-only dry-run select) =====================
select a.id, a.name, a.email, a.role, a.active, a.user_id is not null as linked, a.is_system_identity,
       (select string_agg(e.key, ', ') from jsonb_each(to_jsonb(a)) e where (e.key like 'has\_%' or e.key like 'can\_%') and e.value = 'true'::jsonb) as flags_on,
       (select array_agg(x.role) from public.admin_extra_roles x where x.admin_id = a.id) as extra_roles,
       (select count(*) from public.admin_module_permissions m where m.admin_id = a.id) as module_permissions,
       (select count(*) from clinic_reception.members m where m.admin_id = a.id) as reception_memberships,
       (select count(*) from public.task_project_members m where m.admin_id = a.id) as task_projects,
       (select count(*) from clinic_people.people p where p.admin_id = a.id) as hr_people,
       pg_get_constraintdef((select oid from pg_constraint where conname = 'admins_role_check' and conrelid = 'public.admins'::regclass)) like '%ai_assistant%' as migration_applied
  from public.admins a where a.id = '6bc2a2ff-9947-4a3f-a06d-e10b5130a526';

-- ===================== 1. APPLY =====================
begin;
do $$
declare acc constant uuid := '6bc2a2ff-9947-4a3f-a06d-e10b5130a526'; owner_sub uuid; sets text;
begin
  if to_regprocedure('public.instinct_context()') is null then raise exception 'apply migration 20261124200000_instinct_assistant.sql first'; end if;
  if not exists (select 1 from public.admins where id = acc) then raise exception 'account % not found', acc; end if;
  if exists (select 1 from public.admins where id = acc and is_system_identity) then raise exception 'unexpected: system identity'; end if;
  select a.user_id into owner_sub from public.administrative_assistant_config c join public.admins a on a.id = c.owner_admin_id where c.id = 1 and a.active;
  if owner_sub is null then raise exception 'owner not found'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', owner_sub::text, true);
  delete from public.admin_extra_roles where admin_id = acc;
  if to_regclass('public.admin_module_permissions') is not null then delete from public.admin_module_permissions where admin_id = acc; end if;
  select string_agg(format('%I = false', column_name), ', ' order by column_name) into sets
    from information_schema.columns where table_schema = 'public' and table_name = 'admins' and data_type = 'boolean'
     and (column_name like 'has\_%' or column_name like 'can\_%');
  execute format('update public.admins set role = %L%s where id = %L', 'ai_assistant', coalesce(', ' || sets, ''), acc);
  if not exists (select 1 from public.admins where id = acc and role = 'ai_assistant') then raise exception 'role not changed'; end if;
end $$;
-- check (same row as the preview): role ai_assistant, flags_on null, no extra roles / module permissions
select a.id, a.name, a.role, a.active,
       (select string_agg(e.key, ', ') from jsonb_each(to_jsonb(a)) e where (e.key like 'has\_%' or e.key like 'can\_%') and e.value = 'true'::jsonb) as flags_on,
       (select count(*) from public.admin_extra_roles x where x.admin_id = a.id) as extra_roles,
       (select count(*) from public.admin_module_permissions m where m.admin_id = a.id) as module_permissions
  from public.admins a where a.id = '6bc2a2ff-9947-4a3f-a06d-e10b5130a526';
commit;
