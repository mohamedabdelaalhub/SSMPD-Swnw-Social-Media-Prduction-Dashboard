create or replace function clinic_reception.access_before_management_pilot(p_workspace uuid, p_action text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare me uuid:=public.my_admin_id();allowed boolean:=false;
begin
 if me is not null and exists(select 1 from public.admins where id=me and active) and exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') and (select live_enabled from clinic_reception.settings where id) then
  allowed:=case
    when p_action='view' then clinic_finance.allowed('view') or public.has_role('reception') or public.has_role('customer_service') or public.has_role('nursing') or public.has_role('head_nursing') or public.has_role('sono_doctor')
    when p_action='execute' then public.has_role('reception') or public.has_role('nursing') or public.has_role('head_nursing') or public.has_role('sono_doctor')
    when p_action='collect' then clinic_finance.allowed('create')
    when p_action in ('review','finance_review') then clinic_finance.allowed('review')
    when p_action='reports' then clinic_finance.allowed('view')
    when p_action='book' then public.has_role('reception') or public.has_role('customer_service')
    else false
  end;
  if allowed then return me;end if;
 end if;
 return clinic_reception.workspace_access(p_workspace,p_action);
end
$$;

do $$
begin
 if to_regprocedure('public.clinic_reception_journey_command_core(uuid,text,jsonb,uuid)') is null then
   alter function public.clinic_reception_journey_command(uuid,text,jsonb,uuid) rename to clinic_reception_journey_command_core;
 end if;
end
$$;

create or replace function public.clinic_reception_journey_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  me uuid:=public.my_admin_id();
  allowed boolean:=false;
begin
  if me is null or not exists(select 1 from public.admins where id=me and active) then raise exception 'سجل الدخول' using errcode='42501'; end if;
  allowed := public.has_role('super_admin') or public.has_role('general_manager') or case
    when p_action='settings' then false
    when p_action in ('arrive','call','priority') then public.has_role('reception') or public.has_role('nursing') or public.has_role('head_nursing')
    when p_action in ('consultation_start','hold','resume','request_service','visit_complete') then public.has_role('sono_doctor') or public.has_role('nursing') or public.has_role('head_nursing')
    when p_action in ('no_show','cancel','on_the_way','checkin_token') then public.has_role('reception') or public.has_role('customer_service')
    when p_action in ('patient_help','resolve_help') then public.has_role('reception') or public.has_role('customer_service') or public.has_role('nursing') or public.has_role('head_nursing')
    when p_action='doctor_status' then public.has_role('reception') or public.has_role('nursing') or public.has_role('head_nursing')
    else false
  end;
  if not allowed then raise exception 'ليس لديك صلاحية هذا الإجراء' using errcode='42501'; end if;
  return public.clinic_reception_journey_command_core(p_workspace,p_action,p_payload,p_token);
end
$$;

grant execute on function public.clinic_reception_journey_command(uuid,text,jsonb,uuid) to authenticated;