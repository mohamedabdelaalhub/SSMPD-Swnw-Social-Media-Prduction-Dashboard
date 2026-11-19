-- Rollback of 20261120080000_reception_auto_book.sql. Appointments already booked stay (they are normal appointments).
begin;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'reception-auto-book-5m'$q$;
  end if;
end $$;
drop trigger if exists auto_book_from_masa on clinic_reception.masa_bookings;
drop trigger if exists auto_book_from_agent on public.customer_bookings;
drop trigger if exists auto_book_from_fallback on clinic_reception.fallback_bookings;
drop function if exists public.clinic_reception_auto_book_service_api(text, jsonb);
drop function if exists public.clinic_reception_auto_book(uuid, text, jsonb);
drop function if exists clinic_reception.auto_book_run(int);
drop function if exists clinic_reception.auto_book_one(uuid);
drop function if exists clinic_reception.auto_book_review(uuid, text, text, uuid);
drop function if exists clinic_reception.auto_book_service(uuid, uuid);
drop function if exists clinic_reception.auto_book_from_masa();
drop function if exists clinic_reception.auto_book_from_agent();
drop function if exists clinic_reception.auto_book_from_fallback();
drop function if exists clinic_reception.auto_book_enqueue(jsonb);
drop function if exists clinic_reception.cairo_day(timestamptz);
drop table if exists clinic_reception.external_bookings;
drop table if exists clinic_reception.auto_book_services;
drop table if exists clinic_reception.auto_book_settings;
commit;
