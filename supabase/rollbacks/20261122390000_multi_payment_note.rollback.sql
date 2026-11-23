-- Rollback of 20261122390000_multi_payment_note.sql (read-only additions; no data changes).
begin;
do $$ declare r record; begin
  if to_regclass('clinic_reception.multi_note_saved_defs') is null then raise exception 'لم يُطبّق الملف'; end if;
  for r in select def from clinic_reception.multi_note_saved_defs loop execute r.def; end loop;
end $$;
drop function public.clinic_reception_multi_payments(jsonb);
drop table clinic_reception.multi_note_saved_defs;
commit;
