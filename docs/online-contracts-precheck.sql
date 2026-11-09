-- READ-ONLY pre-check before applying 20261109110000_online_contracts.sql. Every row must show ok = true.
select chk, ok from (
  select 1 n, 'doctor_contracts exists' chk, to_regclass('clinic_finance.doctor_contracts') is not null ok
  union all select 2, 'HR people table exists', to_regclass('clinic_people.people') is not null
  union all select 3, 'admins table exists', to_regclass('public.admins') is not null
  union all select 4, 'finance helpers exist (require_access, lock_day)', (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'clinic_finance' and p.proname in ('require_access', 'lock_day')) >= 2
  union all select 5, 'public.my_admin_id exists', exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'my_admin_id')
  union all select 6, 'NOT applied yet (no contract_templates)', to_regclass('clinic_finance.contract_templates') is null
  union all select 7, 'no function-name collision', not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname in ('public', 'clinic_finance') and p.proname in ('doctor_contract_inbox', 'doctor_contract_decide', 'doctor_consent_accept', 'clinic_finance_contract_signature_command', 'clinic_finance_contract_signature_status',
        'clinic_finance_contract_signed_document', 'contract_signature_command', 'contract_signature_status', 'contract_signed_document', 'contract_render', 'contract_schedule', 'contract_scope_label', 'contract_sha',
        'current_template', 'request_stale', 'template_text', 'check_signature', 'enforcement_active', 'doctor_compliance', 'my_doctor_key'))
  union all select 8, 'no table-name collision', not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'clinic_finance' and c.relname in ('signature_requests', 'acceptances', 'contract_settings'))
) t order by n;
