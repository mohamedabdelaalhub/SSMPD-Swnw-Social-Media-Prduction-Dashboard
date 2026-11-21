begin;
drop trigger if exists follow_up_link_booking on clinic_reception.appointments;
drop function if exists clinic_reception.follow_up_link_booking();
drop function if exists public.clinic_reception_follow_ups(uuid, text, jsonb);
drop function if exists clinic_reception.follow_up_can_change(uuid);
drop table if exists clinic_reception.follow_up_events;
drop table if exists clinic_reception.follow_ups;
commit;
