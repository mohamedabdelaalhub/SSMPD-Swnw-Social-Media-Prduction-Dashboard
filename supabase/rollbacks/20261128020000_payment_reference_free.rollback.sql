-- Rollback of 20261128020000_payment_reference_free.sql (read-only helper; nothing else to restore).
begin;
drop function public.clinic_reception_reference_free(text, text);
commit;
