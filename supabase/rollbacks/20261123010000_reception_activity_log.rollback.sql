-- Rollback of 20261123010000_reception_activity_log.sql (read-only; nothing to restore).
begin;
drop function public.clinic_reception_activity(uuid, jsonb);
drop function clinic_reception.activity_kind(text);
commit;
