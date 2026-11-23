-- Rollback of 20261122340000_masa_timed_service_department.sql: restores auto_book_one as it was before.
begin;
do $$ declare d text; begin
  select def into d from clinic_reception.auto_time_saved_defs where name = 'auto_book_one_timed';
  if d is null then raise exception 'لم يُطبّق الملف'; end if;
  execute d;
  delete from clinic_reception.auto_time_saved_defs where name = 'auto_book_one_timed';
end $$;
commit;
