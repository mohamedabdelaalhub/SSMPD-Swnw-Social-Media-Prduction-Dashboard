-- Automatic bookings: Masa age reaches every waiting booking (main chat diagnosis 2026-11-20 15:09Z).
-- 20261120160000 copies patient_age to the automatic-booking row only inside the masa_import call that carries it, and only
-- for that call's items. A Masa booking whose age is stored by any other path, or before its automatic-booking row existed,
-- never re-reads it, so a booking waiting only for the age («مريض جديد — اكتب سنه») stays waiting.
-- * Trigger auto_book_masa_age (AFTER INSERT OR UPDATE OF patient_age on masa_bookings; runs after auto_book_from_masa, so the
--   row exists): copies the age to the Masa automatic-booking row when it has no patient file yet; a row waiting only for the
--   age goes back to the queue (next 5-minute run opens the file through check_basics as before).
-- * One-shot backfill of the same rule for bookings already stored.
-- Unchanged: rows waiting for another reason, rows already linked to a file, agent/website bookings (owner: never a file from
-- agent data), Masa bookings without an age (new patients without BirthDate in Masa still need reception to type it).
-- No screen change. Rollback: supabase/rollbacks/20261120250000_auto_book_masa_age_requeue.rollback.sql (the backfill stays).
begin;

do $$ begin
  if to_regclass('clinic_reception.external_bookings') is null or not exists (select 1 from information_schema.columns
       where table_schema = 'clinic_reception' and table_name = 'masa_bookings' and column_name = 'patient_age') then
    raise exception 'مكونات الحجز التلقائي غير موجودة';
  end if;
  if to_regprocedure('clinic_reception.auto_book_masa_age()') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function clinic_reception.auto_book_masa_age() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.patient_age is null then return new; end if;
  update clinic_reception.external_bookings e set age = new.patient_age,
      state = case when e.state = 'review' and e.review_kind = 'age' then 'pending' else e.state end,
      reason = case when e.state = 'review' and e.review_kind = 'age' then null else e.reason end,
      review_kind = case when e.state = 'review' and e.review_kind = 'age' then null else e.review_kind end,
      updated_at = now()
    where e.source = 'masa' and e.external_id = new.official_booking_id and e.public_patient_id is null
      and e.age is distinct from new.patient_age;
  return new;
exception when others then
  raise warning 'auto-book age copy skipped: %', sqlerrm;  -- never block the Masa write
  return new;
end $$;
revoke all on function clinic_reception.auto_book_masa_age() from public, anon, authenticated;
create trigger auto_book_masa_age after insert or update of patient_age on clinic_reception.masa_bookings
  for each row execute function clinic_reception.auto_book_masa_age();

-- backfill
update clinic_reception.external_bookings e set age = m.patient_age,
    state = case when e.state = 'review' and e.review_kind = 'age' then 'pending' else e.state end,
    reason = case when e.state = 'review' and e.review_kind = 'age' then null else e.reason end,
    review_kind = case when e.state = 'review' and e.review_kind = 'age' then null else e.review_kind end,
    updated_at = now()
  from clinic_reception.masa_bookings m
  where e.source = 'masa' and e.external_id = m.official_booking_id and m.patient_age is not null
    and e.public_patient_id is null and e.age is distinct from m.patient_age
    and e.state in ('pending', 'review', 'failed', 'needs_time');

commit;
