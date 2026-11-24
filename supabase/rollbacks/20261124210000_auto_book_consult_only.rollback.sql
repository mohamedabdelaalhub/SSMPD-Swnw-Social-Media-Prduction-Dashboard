-- Rollback of 20261124210000_auto_book_consult_only.sql: restores the saved auto_time_service body.
begin;
do $$ declare d text; begin
  select def into d from clinic_reception.auto_time_saved_defs where name = 'auto_time_service_before_consult';
  if d is null then raise exception 'الملف مش متطبق'; end if;
  execute d;
  delete from clinic_reception.auto_time_saved_defs where name = 'auto_time_service_before_consult';
end $$;
revoke all on function clinic_reception.auto_time_service(uuid, uuid, text) from public, anon, authenticated;
drop function clinic_reception.is_consult_name(text);
drop function clinic_reception.consult_rank(text);
commit;
