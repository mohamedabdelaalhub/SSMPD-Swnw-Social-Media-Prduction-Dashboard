-- Rollback of 20261122210000_auto_booking_actions.sql (drops the local auto-booking decisions; the Masa mirror is untouched).
begin;
drop function if exists public.clinic_reception_auto_booking(uuid, text, jsonb);
drop table if exists clinic_reception.auto_booking_events;
drop table if exists clinic_reception.auto_booking_state;
commit;
