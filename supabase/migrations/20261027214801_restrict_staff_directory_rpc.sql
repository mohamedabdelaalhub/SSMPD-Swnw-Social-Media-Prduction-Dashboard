-- Staff directory RPCs must not expose admin/designer lists to patient accounts.
-- Public booking keeps doctor IDs and display names, but no employee email.
CREATE OR REPLACE FUNCTION public.list_admins_basic()
 RETURNS TABLE(id uuid, name text, role text, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.name, a.role, a.active
  from public.admins a
  where public.my_admin_id() is not null
  order by a.name;
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
  where a.active = true
    and (a.role = 'designer' or e.role = 'designer')
    and public.my_admin_id() is not null
  order by a.name;
$function$;

CREATE OR REPLACE FUNCTION public.list_active_sono_doctors()
 RETURNS TABLE(id uuid, name text, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.name, null::text as email
  from public.admins a
  where a.has_archive_view_only and a.active
  order by a.name;
$function$;
