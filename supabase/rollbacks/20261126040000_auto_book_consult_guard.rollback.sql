-- Rollback of 20261126040000_auto_book_consult_guard.sql: restores the saved bodies of auto_time_service,
-- public.clinic_reception_auto_book and sync_catalog, and drops the ops-clear helper.
-- The cleared saved defaults are NOT put back (they were procedures on «كشف» bookings); each one is in clinic_reception.audit
-- (action 'auto_book_default_cleared', detail provider / service_code / set_by / set_at) if someone must restore one by hand.
begin;
do $$ declare r record; n int := 0; begin
  for r in select name, def from clinic_reception.auto_time_saved_defs
            where name in ('auto_time_service_before_consult_guard', 'clinic_reception_auto_book_before_consult_guard', 'sync_catalog_before_consult_guard') loop
    execute r.def; n := n + 1;
  end loop;
  if n <> 3 then raise exception 'الملف مش متطبق (لقيت % من 3 نسخ محفوظة)', n; end if;
  delete from clinic_reception.auto_time_saved_defs
   where name in ('auto_time_service_before_consult_guard', 'clinic_reception_auto_book_before_consult_guard', 'sync_catalog_before_consult_guard');
end $$;
revoke all on function clinic_reception.auto_time_service(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.clinic_reception_auto_book(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_auto_book(uuid, text, jsonb) to authenticated;
drop function clinic_reception.auto_book_clear_bad_defaults();
notify pgrst, 'reload schema';
commit;
