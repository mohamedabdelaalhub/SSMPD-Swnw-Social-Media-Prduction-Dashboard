-- Rollback of 20261127330000_contract_price_rules: un-patches clinic_prices.resolve (the one line), then drops the new
-- functions and tables and the admin_fee_percent column. Rules / mappings / audit rows are lost — export them first if needed.
begin;
do $rb$
declare fn regprocedure := to_regprocedure('clinic_prices.resolve(uuid,numeric,date,uuid)'); src text;
  new_line constant text := ' r:=coalesce(clinic_prices.resolve_contract_rules(p_service,base,p_date,p_contract),clinic_prices.resolve_before_offer(p_service,base,p_date,p_contract));';
  old_line constant text := ' r:=clinic_prices.resolve_before_offer(p_service,base,p_date,p_contract);';
begin
  select prosrc into src from pg_proc where oid = fn;
  if position(new_line in src) > 0 then
    execute format('create or replace function clinic_prices.resolve(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as %L', replace(src, new_line, old_line));
  end if;
end $rb$;
revoke all on function clinic_prices.resolve(uuid, numeric, date, uuid) from public, anon, authenticated;
drop function if exists public.contract_price_rules_workspace();
drop function if exists public.contract_price_rules_command(text, jsonb);
drop function if exists clinic_reception.claim_admin_fee(uuid);
drop function if exists clinic_prices.resolve_contract_rules(uuid, numeric, date, uuid);
drop function if exists clinic_prices.service_group(uuid);
drop table if exists clinic_prices.rule_audit, clinic_prices.contract_price_rules, clinic_prices.service_group_services, clinic_prices.service_group_categories, clinic_prices.service_groups;
alter table public.contracting_entity_contracts drop column if exists admin_fee_percent;
commit;
