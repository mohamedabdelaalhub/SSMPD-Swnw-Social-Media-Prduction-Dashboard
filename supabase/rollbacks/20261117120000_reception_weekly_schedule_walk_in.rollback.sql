drop function if exists public.clinic_reception_command(uuid,text,jsonb,uuid);
alter function clinic_reception.command_before_walk_in(uuid,text,jsonb,uuid) set schema public;
alter function public.command_before_walk_in(uuid,text,jsonb,uuid) rename to clinic_reception_command;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid) to authenticated;
drop function if exists public.clinic_reception_weekly(uuid,text,jsonb);
drop function if exists clinic_reception.weekly_generate_all(int);
drop function if exists clinic_reception.weekly_generate(uuid,uuid,int);
-- Keeps generated/walk-in availability rows (bookings may sit in them). Drop the template only if unused:
-- drop table clinic_reception.weekly_slots; alter table clinic_reception.availability drop column source;
