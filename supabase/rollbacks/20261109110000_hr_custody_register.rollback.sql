-- Rollback of 20261109110000_hr_custody_register.sql.
-- WARNING: this drops the custody register tables and every row in them. Export first if any custody was recorded:
--   copy (select * from clinic_people.custody_items) to ... ; copy (select * from clinic_people.custody_movements) to ... ;
-- The clinic_people.audit rows written by the register (action like 'custody_%') are kept on purpose.
begin;
drop function if exists public.hr_custody_outstanding(uuid);
drop function if exists public.hr_custody_workspace();
drop function if exists public.hr_custody_command(text, jsonb);
drop function if exists clinic_people.custody_view_all();
drop table if exists clinic_people.custody_movements;
drop table if exists clinic_people.custody_items;
drop sequence if exists clinic_people.custody_code;
commit;
