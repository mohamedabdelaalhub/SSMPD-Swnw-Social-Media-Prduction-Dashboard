-- Rollback of 20261119130000 (data kept in renamed tables, never dropped).
begin;
drop function if exists public.clinic_reception_patient_extras(uuid, text, jsonb);
drop function if exists clinic_reception.can_manage(uuid);
drop function if exists clinic_reception.clean_address(jsonb);
alter table clinic_reception.patient_note_requests rename to patient_note_requests_rolled_back;
alter table clinic_reception.appointment_extras rename to appointment_extras_rolled_back;
alter table clinic_reception.patient_profile rename to patient_profile_rolled_back;
alter table clinic_reception.services rename column is_home to is_home_rolled_back;
commit;
