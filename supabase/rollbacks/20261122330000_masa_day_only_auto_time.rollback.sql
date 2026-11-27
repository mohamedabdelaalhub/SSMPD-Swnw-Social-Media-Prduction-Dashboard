-- Rollback of 20261122330000_masa_day_only_auto_time.sql. Appointments already placed stay booked; rows waiting on
-- «يوم الدكتور مليان» go back to «حجوزات من غير ساعة» (needs_time).
begin;
do $$ declare r record; begin
  if to_regclass('clinic_reception.auto_time_saved_defs') is null then raise exception 'لم يُطبّق الملف'; end if;
  if exists (select 1 from clinic_reception.auto_time_saved_defs where name = 'auto_book_one_timed') then
    raise exception 'رجّع 20261122340000 الأول'; end if;
  for r in select def from clinic_reception.auto_time_saved_defs where name in ('auto_book_one', 'auto_book_enqueue', 'clinic_reception_auto_book') loop execute r.def; end loop;
end $$;
update clinic_reception.external_bookings set state = 'needs_time', review_kind = null, reason = null, updated_at = now() where review_kind = 'full_day';
alter table clinic_reception.external_bookings drop constraint if exists external_bookings_review_kind_check;
alter table clinic_reception.external_bookings add constraint external_bookings_review_kind_check
  check (review_kind in ('patient','age','service','doctor','slot'));
drop function clinic_reception.auto_book_place_day_only(uuid, uuid);
drop function clinic_reception.day_capacity(uuid, uuid, date);
drop function clinic_reception.free_starts(uuid, date, int, int);
drop function clinic_reception.auto_time_service(uuid, uuid, text);
alter table clinic_reception.external_bookings drop column auto_timed, drop column time_told_at, drop column time_told_by, drop column pinned;
drop table clinic_reception.auto_time_saved_defs;
revoke all on function public.clinic_reception_auto_book(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_auto_book(uuid, text, jsonb) to authenticated;
commit;
