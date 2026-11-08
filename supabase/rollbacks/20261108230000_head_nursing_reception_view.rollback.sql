-- تراجع 20261108230000: يرجّع التعريفين من غير head_nursing.

CREATE OR REPLACE FUNCTION clinic_reception.access_before_journey_sandbox(p_workspace uuid, p_action text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$begin
 if (select pilot_only from clinic_reception.settings where id) then
  if not clinic_reception.is_pilot_participant() then raise exception 'اطلب صلاحية الاستقبال والخدمات من الإدارة' using errcode='42501';end if;
  if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then raise exception 'استخدم مساحة الحجز المتصلة بملفات المرضى';end if;
 end if;
 if p_action='view' and (public.has_role('nursing') or public.has_role('sono_doctor')) and exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') and (select live_enabled from clinic_reception.settings where id) then return public.my_admin_id();end if;
 return clinic_reception.access_before_management_pilot(p_workspace,p_action);
end $function$;

CREATE OR REPLACE FUNCTION clinic_reception.is_pilot_participant()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select public.my_admin_id() is not null and exists(select 1 from public.admins where id=public.my_admin_id() and active)
 and (public.can_access_leads() or public.has_role('nursing') or public.has_role('sono_doctor') or clinic_finance.allowed('view')
 or exists(select 1 from clinic_reception.members m join clinic_reception.workspaces w on w.id=m.workspace_id where m.admin_id=public.my_admin_id() and w.mode='live' and cardinality(m.capabilities)>0));
$function$;
