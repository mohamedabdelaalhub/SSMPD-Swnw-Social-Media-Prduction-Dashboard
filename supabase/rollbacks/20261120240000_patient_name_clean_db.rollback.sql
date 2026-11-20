-- Rollback of 20261120240000_patient_name_clean_db.sql (names already cleaned stay cleaned).
begin;
drop trigger if exists patient_basics_clean on public.patients;
drop function if exists psychcare.patient_name_clean();
do $$ declare d text; begin
  select def into d from psychcare.name_clean_saved_defs where name = 'check_basics';
  if d is not null then execute d; end if;
end $$;
drop table if exists psychcare.name_clean_saved_defs;
drop function if exists psychcare.clean_name(text);
commit;
