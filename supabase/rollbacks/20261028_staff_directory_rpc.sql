-- Restore the exact function bodies captured in security_backups/20261028_staff_directory_functions_before.sql.
CREATE OR REPLACE FUNCTION public.list_admins_basic()
 RETURNS TABLE(id uuid, name text, role text, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id, name, role, active from public.admins order by name;
$function$;

CREATE OR REPLACE FUNCTION public.list_designers_all()
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct a.id, a.name
  from public.admins a
  left join public.admin_extra_roles e on e.admin_id = a.id
  where a.active = true and (a.role = 'designer' or e.role = 'designer')
  order by a.name;
$function$;

CREATE OR REPLACE FUNCTION public.list_active_sono_doctors()
 RETURNS TABLE(id uuid, name text, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id, name, email from public.admins where has_archive_view_only and active order by name;
$function$;
