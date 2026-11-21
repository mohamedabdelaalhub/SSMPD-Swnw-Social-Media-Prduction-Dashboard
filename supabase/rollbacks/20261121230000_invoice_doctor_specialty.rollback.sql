-- Rollback of 20261121230000_invoice_doctor_specialty.sql: restores the saved invoice print function.
begin;
do $$ declare r record; begin for r in select def from clinic_reception.invoice_doctor_saved_defs loop execute r.def; end loop; end $$;
drop table clinic_reception.invoice_doctor_saved_defs;
commit;
