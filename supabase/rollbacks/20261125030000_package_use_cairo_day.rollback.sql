-- Rollback of 20261125030000_package_use_cairo_day.sql: restores the saved function bodies.
begin;
do $$ declare r record; begin
  if to_regclass('clinic_reception.package_use_cairo_saved') is null then raise exception 'الملف مش متطبق'; end if;
  for r in select def from clinic_reception.package_use_cairo_saved loop execute r.def; end loop;
end $$;
drop table clinic_reception.package_use_cairo_saved;
commit;
