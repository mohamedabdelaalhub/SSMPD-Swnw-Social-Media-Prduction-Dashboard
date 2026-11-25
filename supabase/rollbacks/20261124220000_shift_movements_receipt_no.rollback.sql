-- Rollback of 20261124220000_shift_movements_receipt_no.sql (read-only change): restores the previous function body.
begin;
do $$ begin execute (select def from clinic_finance.receipt_no_saved_defs where name = 'shift_movements'); end $$;
drop table clinic_finance.receipt_no_saved_defs;
commit;
