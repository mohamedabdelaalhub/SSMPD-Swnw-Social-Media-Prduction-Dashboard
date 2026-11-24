-- Rollback of 20261123150000_provider_scope_from_contracts.sql: drops the two triggers and functions and removes ONLY the scope rows
-- this migration added (logged in clinic_reception.provider_scope_autofill). Rows that existed before, or were added by hand, stay.
begin;
drop trigger if exists scope_from_contract on clinic_finance.doctor_contracts;
drop trigger if exists scope_from_provider on clinic_reception.providers;
do $$ declare n integer; begin
  if to_regclass('clinic_reception.provider_scope_autofill') is not null then
    delete from clinic_reception.provider_service_scopes sc using clinic_reception.provider_scope_autofill a
     where sc.provider_id = a.provider_id and sc.service_code = a.service_code;
    get diagnostics n = row_count; raise notice 'removed % auto-filled scope rows', n;
  end if;
end $$;
drop function if exists clinic_reception.scope_from_contract_trg();
drop function if exists clinic_reception.scope_from_provider_trg();
drop function if exists clinic_reception.sync_scope_from_contracts(text, text);
drop table if exists clinic_reception.provider_scope_autofill;
commit;
