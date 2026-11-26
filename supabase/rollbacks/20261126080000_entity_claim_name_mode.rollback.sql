-- Rollback of 20261126080000_entity_claim_name_mode.sql: drops the two functions and the per-entity default table.
-- Claim documents keep working: the screen falls back to «الاتنين» when entity_claim_name_mode is missing.
begin;
drop function if exists public.entity_claim_name_mode_save(uuid, text);
drop function if exists public.entity_claim_name_mode(uuid);
drop table if exists clinic_finance.entity_claim_name_modes;
commit;
