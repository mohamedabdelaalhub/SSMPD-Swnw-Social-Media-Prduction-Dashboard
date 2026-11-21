-- Rollback of 20261122040000_reception_visit_void.sql. Requests already filed stay ordinary service_void requests (reviewable as before);
-- appointments already marked no_show and visit notes stay as they are (history).
begin;
drop trigger if exists trg_visit_void_after_review on clinic_reception.requests;
drop function if exists clinic_reception.visit_void_after_review();
drop function if exists public.clinic_reception_visit_void_request(uuid, uuid, text, uuid);
commit;
