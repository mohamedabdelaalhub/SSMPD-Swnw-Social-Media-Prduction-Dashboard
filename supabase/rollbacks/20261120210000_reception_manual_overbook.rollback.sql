-- Rollback of 20261120210000_reception_manual_overbook.sql. Columns stay; overbook rows stay as normal bookings.
begin;
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_overbook(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_overbook(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function if exists clinic_reception.overbook_can_manage(uuid);
do $$ declare r record; begin
  for r in select * from clinic_reception.overbook_saved_defs loop execute r.def; end loop;
end $$;
drop table if exists clinic_reception.overbook_saved_defs;
commit;
