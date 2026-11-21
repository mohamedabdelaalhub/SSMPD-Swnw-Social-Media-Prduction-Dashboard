begin;
drop function if exists public.clinic_reception_reminders(uuid, text, jsonb);
drop table if exists clinic_reception.booking_reminders;
commit;
