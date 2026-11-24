-- Rollback of 20261125070000_payout_reference_message.sql: restores the saved function body (message-only change).
begin;
do $$ declare r record; begin for r in select def from clinic_finance.payout_ref_saved_defs loop execute r.def; end loop; end $$;
drop table clinic_finance.payout_ref_saved_defs;
commit;
