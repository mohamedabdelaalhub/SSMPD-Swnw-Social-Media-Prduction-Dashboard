-- Rollback of 20261120350000_masa_archive_lookup.sql (drops the lookup RPC and its audit log).
begin;
drop function if exists public.masa_archive_lookup(jsonb);
drop function if exists clinic_reception.masa_booking_state_label(int);
drop function if exists clinic_reception.masa_name_norm(text);
drop table if exists clinic_reception.masa_archive_lookup_log;
commit;
