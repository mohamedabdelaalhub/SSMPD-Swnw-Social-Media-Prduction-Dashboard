-- Rollback of 20261108280000_online_contracts.sql. Refused once any signature request or acceptance exists (those are signed records; export them first, then drop manually).
begin;
do $$ begin
  if exists (select 1 from clinic_finance.acceptances) or exists (select 1 from clinic_finance.signature_requests) then
    raise exception 'فيه طلبات توقيع أو موافقات مسجّلة؛ لا يتم الحذف تلقائيًا. صدّرها أولًا';
  end if;
end $$;
drop function if exists public.clinic_finance_contract_signature_command(text, jsonb, uuid);
drop function if exists public.clinic_finance_contract_signature_status();
drop function if exists public.doctor_contract_inbox();
drop function if exists public.clinic_finance_contract_signed_document(uuid);
drop function if exists public.doctor_contract_decide(uuid, boolean, text, text, text, text, text);
drop function if exists public.doctor_consent_accept(uuid, text, text, text, text);
drop function if exists clinic_finance.doctor_consent_accept(uuid, text, text, text, text);
drop function if exists clinic_finance.doctor_contract_decide(uuid, boolean, text, text, text, text, text);
drop function if exists clinic_finance.contract_signed_document(uuid);
drop function if exists clinic_finance.doctor_contract_inbox();
drop function if exists clinic_finance.contract_signature_status();
drop function if exists clinic_finance.contract_signature_command(text, jsonb, uuid);
drop function if exists clinic_finance.my_doctor_key();
drop function if exists clinic_finance.doctor_compliance(text);
drop function if exists clinic_finance.enforcement_active(text);
drop function if exists clinic_finance.check_signature(text, text);
drop function if exists clinic_finance.request_stale(clinic_finance.signature_requests);
drop function if exists clinic_finance.current_template(text);
drop function if exists clinic_finance.contract_sha(text);
drop function if exists clinic_finance.contract_render(uuid, text, text, text, jsonb);
drop function if exists clinic_finance.template_text(clinic_finance.contract_templates);
drop function if exists clinic_finance.contract_schedule(uuid[]);
drop function if exists clinic_finance.contract_scope_label(text);
drop table clinic_finance.acceptances;
drop table clinic_finance.signature_requests;
drop table clinic_finance.contract_templates;
drop table clinic_finance.contract_settings;
commit;
