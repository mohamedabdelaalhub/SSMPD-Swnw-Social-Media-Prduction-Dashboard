-- Rollback of 20261122240000_reception_requests_finance_reviewer.sql: restore the saved controls_snapshot body.
begin;
do $$ declare d text; begin
  select def into d from clinic_reception.requests_reviewer_saved_defs where sig = 'clinic_reception.controls_snapshot(uuid,date,date)';
  if d is null then raise exception 'no saved definition'; end if;
  execute d;
end $$;
drop table clinic_reception.requests_reviewer_saved_defs;
notify pgrst, 'reload schema';
commit;
