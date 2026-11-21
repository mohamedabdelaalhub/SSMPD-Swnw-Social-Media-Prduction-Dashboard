-- Restores the function bodies (ready messages keep the corrected text on purpose).
begin;
do $$ declare r record; begin
  for r in select def from clinic_finance.center_text_saved_defs loop execute r.def; end loop;
end $$;
drop table clinic_finance.center_text_saved_defs;
commit;
