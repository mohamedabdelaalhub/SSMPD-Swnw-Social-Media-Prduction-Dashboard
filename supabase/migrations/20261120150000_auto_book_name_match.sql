-- Automatic bookings: same patient with a differently written name (owner 2026-11-19 «٢ أ»).
-- First live run: 20 of 93 Masa bookings went to «الرقم متسجّل باسم مختلف», mostly the same person written longer or
-- shorter (e.g. «أحمد محمد» on Masa, «أحمد محمد علي» here). Rule now: when exactly ONE active file has the phone and the
-- first two words of the name match (after the usual Arabic letter normalisation), the booking links to that file.
-- A different first name on the same phone (child, wife) still goes to staff review, as before.
-- auto_book_one is patched in place (pg_get_functiondef + one inserted branch); the current patient reviews are re-queued
-- so they are checked again on the next 5-minute run. Rollback: supabase/rollbacks/20261120150000_auto_book_name_match.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.auto_book_one(uuid)') is null then raise exception 'الحجز التلقائي غير موجود'; end if;
  if to_regprocedure('clinic_reception.name_first_two(text)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- «أحمد محمد علي» -> «احمد محمد»; null when the name has fewer than two words.
create function clinic_reception.name_first_two(n text) returns text language sql immutable set search_path = pg_catalog as $$
  select case when cardinality(w) >= 2 then w[1] || ' ' || w[2] end
  from (select regexp_split_to_array(psychcare.name(n), ' ') as w) s
$$;
revoke all on function clinic_reception.name_first_two(text) from public, anon, authenticated;

do $$
declare def text; patched text;
  anchor text := E'      elsif n_phone > 0 then';
  branch text := E'      elsif n_same = 0 and n_phone = 1 and clinic_reception.name_first_two(b.customer_name) is not null\n'
              || E'            and exists (select 1 from public.patients x where x.status = ''active'' and psychcare.phone(x.phone) = ph\n'
              || E'                         and clinic_reception.name_first_two(x.full_name) = clinic_reception.name_first_two(b.customer_name)) then\n'
              || E'        -- owner 2026-11-19: one file on this phone, same first two names -> the same patient written differently\n'
              || E'        select x.id into pid from public.patients x where x.status = ''active'' and psychcare.phone(x.phone) = ph;\n';
begin
  def := pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure);
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then raise exception 'auto_book_one changed: anchor not found once'; end if;
  patched := replace(def, anchor, branch || anchor);
  execute patched;
end $$;

-- re-check the bookings waiting for a patient choice
update clinic_reception.external_bookings set state = 'pending', review_kind = null, reason = null, updated_at = now()
  where state = 'review' and review_kind = 'patient' and day >= (now() at time zone 'Africa/Cairo')::date;

commit;
