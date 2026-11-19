-- Rollback of 20261120070000 (the flag column is kept, renamed; log rows with action 'edit' are kept).
begin;
drop trigger if exists patients_basic_scope_guard on public.patients;
drop function if exists public.patients_basic_scope_guard();
drop function if exists public.archive_log_patient_edit(uuid);
drop function if exists public.has_archive_reception_access();
alter table public.admins rename column has_archive_reception_access to has_archive_reception_access_rolled_back;
commit;
