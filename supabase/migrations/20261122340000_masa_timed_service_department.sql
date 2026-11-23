-- Follow-up to 20261122330000 (owner «طبق حل الحجوزات», 2026-11-23): Masa bookings WITH a time used the Masa service text
-- mapping directly, which can pick a service of another department; reception then refuses «الطبيب خارج تخصص الخدمة»
-- (live: Dr. Ahmed Samir, a row of 2026-11-23). auto_book_one's timed path now uses the same department-safe picker as the
-- day-only path (clinic_reception.auto_time_service: Masa text → saved → most used → «كشف», own department only).
-- One in-place anchor (the service call, once); the old body is saved in clinic_reception.auto_time_saved_defs
-- ('auto_book_one_timed'). Waiting 'slot' reviews with that reason are re-queued once.
-- Rollback: supabase/rollbacks/20261122340000_masa_timed_service_department.rollback.sql
begin;

do $$ declare d text := pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure);
  a1 constant text := 'clinic_reception.auto_book_service_for(ws, b.provider_id, b.needed_service)';
  a2 constant text := 'clinic_reception.auto_book_service(ws, b.provider_id)';
  n1 int; n2 int;
begin
  if to_regprocedure('clinic_reception.auto_time_service(uuid,uuid,text)') is null then raise exception 'طبّق 20261122330000 أولاً'; end if;
  if exists (select 1 from clinic_reception.auto_time_saved_defs where name = 'auto_book_one_timed') then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  n1 := (length(d) - length(replace(d, a1, ''))) / length(a1);
  n2 := (length(d) - length(replace(d, a2, ''))) / length(a2);
  if not ((n1 = 1 and n2 = 0) or (n1 = 0 and n2 = 1)) then raise exception 'auto_book_one changed: service anchor not found once (% / %)', n1, n2; end if;
  insert into clinic_reception.auto_time_saved_defs values ('auto_book_one_timed', d);
  execute replace(d, case when n1 = 1 then a1 else a2 end, 'clinic_reception.auto_time_service(ws, b.provider_id, b.needed_service)');
end $$;

-- rows already parked by that refusal get one more try (auto_book_run picks pending rows from today on)
update clinic_reception.external_bookings set state = 'pending', review_kind = null, reason = null, attempts = 0, updated_at = now()
 where state = 'review' and review_kind = 'slot' and reason like '%الطبيب خارج تخصص الخدمة%' and day >= clinic_reception.cairo_day(now());

commit;
