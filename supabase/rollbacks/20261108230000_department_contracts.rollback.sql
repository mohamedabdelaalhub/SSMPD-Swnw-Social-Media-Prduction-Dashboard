-- Rollback for 20261108230000_department_contracts.sql.
-- Restores the two re-created functions to their previous text (verbatim from 20261017130324 / 20261018005957) and unwraps clinic_finance_doctor_command.
-- Contracts already created with a 'قسم:...' scope stay in the table (they simply stop matching anything and the original exact-code logic ignores them);
-- review/retire them manually if needed:  select * from clinic_finance.doctor_contracts where service_scope like 'قسم:%';
begin;
drop function if exists public.clinic_finance_doctor_command(text, jsonb, uuid);
do $$ begin
  if to_regprocedure('clinic_finance.doctor_command_before_departments(text,jsonb,uuid)') is not null then
    alter function clinic_finance.doctor_command_before_departments(text, jsonb, uuid) rename to clinic_finance_doctor_command;
    alter function clinic_finance.clinic_finance_doctor_command(text, jsonb, uuid) set schema public;
  end if;
end $$;
revoke all on function public.clinic_finance_doctor_command(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_doctor_command(text, jsonb, uuid) to authenticated;
create or replace function clinic_reception.sync_doctor_contract(p_workspace uuid,p_order uuid,p_provider uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o clinic_reception.orders%rowtype;p clinic_reception.providers%rowtype;c clinic_finance.doctor_contracts%rowtype;n integer;begin
 select * into o from clinic_reception.orders where workspace_id=p_workspace and id=p_order;
 select * into p from clinic_reception.providers where workspace_id=p_workspace and id=coalesce(p_provider,o.provider_id);
 select count(*) into n from clinic_finance.doctor_contracts where doctor_key=p.doctor_key and service_scope=o.snapshot->>'code' and status='active' and clinic_reception.today() between valid_from and valid_to;
 if n<>1 then raise exception 'حدد عقدًا واحدًا معتمدًا للطبيب والخدمة % داخل الحسابات',o.snapshot->>'code';end if;
 select * into c from clinic_finance.doctor_contracts where doctor_key=p.doctor_key and service_scope=o.snapshot->>'code' and status='active' and clinic_reception.today() between valid_from and valid_to;
 if c.basis<>'performed' or c.base_scope<>'service' or c.deduction not in ('none','cost') then raise exception 'عقد الخدمة بالحسابات يجب أن يستحق عند التنفيذ على الخدمة مع خصم تكلفة المشمول أو بدون خصم';end if;
 if exists(select 1 from clinic_reception.doctor_agreements where workspace_id=p_workspace and provider_id=p.id and service_code=o.snapshot->>'code' and finance_contract_id=c.id and status='active' and rate=c.rate and deduct_material_cost=(c.deduction='cost')) then return;end if;
 update clinic_reception.doctor_agreements set status='rejected' where workspace_id=p_workspace and provider_id=p.id and service_code=o.snapshot->>'code' and status='active';
 insert into clinic_reception.doctor_agreements(workspace_id,provider_id,service_code,rate,deduct_material_cost,valid_from,valid_to,reference,status,created_by,reviewed_by,finance_contract_id)
 values(p_workspace,p.id,o.snapshot->>'code',c.rate,c.deduction='cost',c.valid_from,c.valid_to,c.reference,'active',c.created_by,c.reviewed_by,c.id);
end $$;
create or replace function public.pricing_doctor_contracts()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $$
begin
  perform clinic_finance.require_access('view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'doctor_key', c.doctor_key, 'doctor_name', c.doctor_name,
      'service_scope', c.service_scope, 'valid_from', c.valid_from,
      'valid_to', c.valid_to, 'rate', c.rate, 'basis', c.basis,
      'base_scope', c.base_scope, 'deduction', c.deduction,
      'reference', c.reference
    ) order by c.doctor_name, c.service_scope, c.valid_from, c.id)
    from clinic_finance.doctor_contracts c
    where c.status = 'active'
      and (now() at time zone 'Africa/Cairo')::date between c.valid_from and c.valid_to
  ), '[]'::jsonb);
end;
$$;
drop function if exists public.clinic_finance_contract_departments();
drop function if exists clinic_finance.doctor_contract_for_service(text, text, text, text, date);
drop function if exists clinic_finance.contract_departments();
drop function if exists clinic_finance.department_scope_name(text);
revoke all on function public.pricing_doctor_contracts() from public, anon;
grant execute on function public.pricing_doctor_contracts() to authenticated;
commit;
