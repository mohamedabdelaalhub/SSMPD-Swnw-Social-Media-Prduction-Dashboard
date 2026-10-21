-- تعديل البيانات الأساسية لليد مع تسجيل كل تغيير واسم الموظف المنفذ.
create or replace function public.rpc_update_lead_details(
  p_lead_id uuid,
  p_caller_id uuid,
  p_customer_name text,
  p_phone_raw text,
  p_phone_normalized text,
  p_source text,
  p_message_text text default null,
  p_interested_service text default null,
  p_requested_department text default null,
  p_acquisition_type text default null,
  p_patient_id uuid default null,
  p_patient_type text default null
)
returns public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.leads;
  v_new public.leads;
begin
  select * into v_old
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'lead not found';
  end if;

  perform set_config('app.caller_admin_id', p_caller_id::text, true);

  update public.leads
  set customer_name = p_customer_name,
      phone_raw = p_phone_raw,
      phone_normalized = p_phone_normalized,
      source = p_source,
      message_text = p_message_text,
      interested_service = p_interested_service,
      requested_department = p_requested_department,
      acquisition_type = p_acquisition_type,
      patient_id = p_patient_id,
      patient_type = p_patient_type,
      updated_at = now()
  where id = p_lead_id
  returning * into v_new;

  if v_new.customer_name is distinct from v_old.customer_name then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (p_lead_id, p_caller_id, 'customer_name', v_old.customer_name, v_new.customer_name);
  end if;
  if v_new.phone_raw is distinct from v_old.phone_raw then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (p_lead_id, p_caller_id, 'phone_raw', v_old.phone_raw, v_new.phone_raw);
  end if;
  if v_new.phone_normalized is distinct from v_old.phone_normalized then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (p_lead_id, p_caller_id, 'phone_normalized', v_old.phone_normalized, v_new.phone_normalized);
  end if;
  if v_new.source is distinct from v_old.source then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (p_lead_id, p_caller_id, 'source', v_old.source, v_new.source);
  end if;
  if v_new.interested_service is distinct from v_old.interested_service then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (p_lead_id, p_caller_id, 'interested_service', v_old.interested_service, v_new.interested_service);
  end if;
  if v_new.requested_department is distinct from v_old.requested_department then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (p_lead_id, p_caller_id, 'requested_department', v_old.requested_department, v_new.requested_department);
  end if;
  if v_new.acquisition_type is distinct from v_old.acquisition_type then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (p_lead_id, p_caller_id, 'acquisition_type', v_old.acquisition_type, v_new.acquisition_type);
  end if;
  if v_new.message_text is distinct from v_old.message_text then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (p_lead_id, p_caller_id, 'message_text', v_old.message_text, v_new.message_text);
  end if;
  if v_new.patient_id is distinct from v_old.patient_id then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (p_lead_id, p_caller_id, 'patient_id', v_old.patient_id::text, v_new.patient_id::text);
  end if;
  if v_new.patient_type is distinct from v_old.patient_type then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (p_lead_id, p_caller_id, 'patient_type', v_old.patient_type, v_new.patient_type);
  end if;

  return v_new;
end;
$$;

revoke all on function public.rpc_update_lead_details(uuid, uuid, text, text, text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_update_lead_details(uuid, uuid, text, text, text, text, text, text, text, text, uuid, text) to service_role;
