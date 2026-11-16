-- Rollback for 20261117130000_reception_masa_links_fallback_booking.sql
-- Check first that no fallback booking is still waiting (they hold patient bookings that exist nowhere else):
--   select status, count(*) from clinic_reception.fallback_bookings group by 1;
drop trigger if exists appointments_respect_fallback on clinic_reception.appointments;
drop function if exists clinic_reception.appointments_respect_fallback();
drop function if exists public.clinic_reception_fallback(uuid,text,jsonb);
drop function if exists public.clinic_reception_fallback_api(text,jsonb);
drop function if exists clinic_reception.fallback_api(text,jsonb);
drop function if exists clinic_reception.fallback_cancel(clinic_reception.fallback_bookings,text,uuid);
drop function if exists clinic_reception.fallback_row(clinic_reception.fallback_bookings);
drop function if exists clinic_reception.fallback_slot_ok(uuid,timestamptz,timestamptz);
drop function if exists clinic_reception.center_closed(date);
drop function if exists clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid);
drop function if exists clinic_reception.slot_lock(uuid);
drop function if exists clinic_reception.fallback_holds(clinic_reception.fallback_bookings);
drop table if exists clinic_reception.fallback_bookings;
drop function if exists clinic_reception.masa_link_seed(uuid);
drop table if exists clinic_reception.masa_doctor_links;
drop function if exists clinic_reception.masa_norm(text);
-- The provider «راضي منصور» added by the migration is kept (appointments may reference him); deactivate by hand if needed.
