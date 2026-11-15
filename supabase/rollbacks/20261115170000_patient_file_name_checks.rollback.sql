-- Rollback of 20261115170000_patient_file_name_checks (stop the server worker first).
begin;
drop function if exists public.patient_file_name_check_review(uuid, text);
drop function if exists public.patient_file_name_check_record(uuid, text, numeric, text, text);
drop function if exists public.patient_file_name_check_queue(integer, integer);
drop table if exists public.patient_file_name_checks;
commit;
