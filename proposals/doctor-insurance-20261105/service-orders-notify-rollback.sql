begin;
drop function if exists public.clinic_reception_so_notify_result(uuid,boolean,text);
drop function if exists public.clinic_reception_so_notify_prepare(uuid,uuid);
drop table if exists clinic_reception.report_notifications;
commit;
