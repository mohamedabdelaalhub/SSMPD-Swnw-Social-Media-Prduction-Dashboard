-- Rollback of 20261109140000_reception_booking_external.sql: restores clinic_reception_command exactly (it was only moved), removes the trigger, function and table.
-- REFUSED while any booking carries an external extra (an applied extra is already part of an invoice amount and the ledger).
begin;
do $$ begin
  if to_regprocedure('clinic_reception.command_before_external_booking(uuid,text,jsonb,uuid)') is null then raise exception 'الملف غير مطبق؛ لا يوجد ما يُتراجع عنه'; end if;
  if exists (select 1 from clinic_reception.appointment_external) then raise exception 'توجد حجوزات بخدمة خارجية؛ لا يمكن التراجع'; end if;
end $$;
drop function public.clinic_reception_external_enabled();
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_external_booking(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_external_booking(uuid, text, jsonb, uuid) rename to clinic_reception_command;
drop trigger invoices_apply_external_extra on clinic_reception.invoices;
drop function clinic_reception.apply_external_extra();
drop table clinic_reception.appointment_external;
commit;
