-- Owner 2026-11-20: reception drives visits (only 2/50 providers have doctor accounts), so «بدأ الكشف» / «إنهاء الزيارة» must work for reception;
-- the doctor payout chip must offer «صرف الحساب» for the completed + fully-paid cases even while other cases are still pending.
begin;

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
    when p_action in ('consultation_start','visit_complete') then public.has_role('reception') or public.has_role('sono_doctor') or public.has_role('nursing') or public.has_role('head_nursing')
    when p_action in ('hold','resume','request_service') then public.has_role('sono_doctor') or public.has_role('nursing') or public.has_role('head_nursing')
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

-- desk_payable: a finance invoice linked to a reception visit counts only once that visit is completed (invoices without a visit stay eligible).
do $m$
declare d text;
begin
  if to_regprocedure('clinic_finance.desk_payable(text)') is null then return; end if;
  d:=pg_get_functiondef('clinic_finance.desk_payable(text)'::regprocedure);
  if position('clinic_reception.visits' in d)=0 then
    d:=replace(d,'where clinic_finance.invoice_fully_paid(i.id)'||chr(10),
      'where clinic_finance.invoice_fully_paid(i.id)'||chr(10)||
      '      and not exists (select 1 from clinic_reception.invoices ri join clinic_reception.visits rv on rv.id = ri.visit_id where ri.finance_invoice_id = i.id and rv.status <> ''completed'')'||chr(10));
    if position('clinic_reception.visits' in d)=0 then raise exception 'desk_payable pattern not found'; end if;
    execute d;
    revoke all on function clinic_finance.desk_payable(text) from public, anon, authenticated;
  end if;
end
$m$;

commit;
