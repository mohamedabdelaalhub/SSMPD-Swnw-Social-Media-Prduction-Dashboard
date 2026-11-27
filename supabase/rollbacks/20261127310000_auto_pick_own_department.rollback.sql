-- Rollback of 20261127310000_auto_pick_own_department.sql: restores serves_service as 20261126050000 left it, drops the saved table.
begin;
do $$ declare d text; begin
  if to_regclass('clinic_reception.auto_pick_saved_defs') is null then raise exception 'الملف مش متطبق'; end if;
  select def into d from clinic_reception.auto_pick_saved_defs where sig = 'clinic_reception.serves_service(uuid,text,text)';
  if d is null then raise exception 'النسخة المحفوظة مش موجودة'; end if;
  execute d;
end $$;
revoke all on function clinic_reception.serves_service(uuid, text, text) from public, anon, authenticated;
drop table clinic_reception.auto_pick_saved_defs;
commit;
