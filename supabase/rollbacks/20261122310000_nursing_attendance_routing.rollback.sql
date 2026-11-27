-- Rollback of 20261122310000_nursing_attendance_routing.sql: restores the saved bodies, drops the new helpers.
begin;
do $$ declare r record; begin
  if to_regclass('clinic_reception.nursing_presence_saved_defs') is null then raise exception 'لم يُطبّق الملف'; end if;
  for r in select def from clinic_reception.nursing_presence_saved_defs loop execute r.def; end loop;
end $$;
drop function clinic_reception.taken_by_general(uuid, text);
drop function clinic_reception.nurse_presence(uuid, date);
drop table clinic_reception.nursing_presence_saved_defs;
revoke all on function clinic_reception.nurse_absent(uuid, date), clinic_reception.section_covered(text, date) from public, anon, authenticated;
commit;
