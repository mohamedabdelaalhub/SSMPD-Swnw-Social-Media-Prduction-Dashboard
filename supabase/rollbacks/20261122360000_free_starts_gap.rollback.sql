-- Rollback of 20261122360000_free_starts_gap.sql: restores free_starts without the gap.
begin;
do $$ declare d text; begin
  select def into d from clinic_reception.auto_time_saved_defs where name = 'free_starts';
  if d is null then raise exception 'لم يُطبّق الملف'; end if;
  execute d;
  delete from clinic_reception.auto_time_saved_defs where name = 'free_starts';
end $$;
revoke all on function clinic_reception.free_starts(uuid, date, int, int) from public, anon, authenticated;
commit;
