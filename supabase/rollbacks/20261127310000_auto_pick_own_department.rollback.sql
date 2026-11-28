-- Rollback of 20261127310000_auto_pick_own_department.sql: restores serves_service, auto_time_service (v4), auto_book_one and
-- auto_book_place_day_only exactly as saved, drops auto_book_pick and the saved table. Bookings already placed as
-- «الخدمة تتحدد عند الحضور» stay as they are (staff choose the service at «وصل», unchanged 20261122060000 rule).
begin;
do $$ declare r record; n int := 0; begin
  if to_regclass('clinic_reception.auto_pick_saved_defs') is null then raise exception 'الملف مش متطبق'; end if;
  for r in select sig, def from clinic_reception.auto_pick_saved_defs loop execute r.def; n := n + 1; end loop;
  if n <> 4 then raise exception 'النسخ المحفوظة ناقصة (لقيت % من 4)', n; end if;
end $$;
revoke all on function clinic_reception.serves_service(uuid, text, text), clinic_reception.auto_time_service(uuid, uuid, text)
  from public, anon, authenticated;
drop function clinic_reception.auto_book_pick(uuid, uuid, text);
drop table clinic_reception.auto_pick_saved_defs;
commit;
