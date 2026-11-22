begin;
do $$ declare r record; begin
  for r in select def from clinic_reception.service_later_saved_defs loop execute r.def; end loop;
end $$;
drop table clinic_reception.service_later_saved_defs;
commit;
