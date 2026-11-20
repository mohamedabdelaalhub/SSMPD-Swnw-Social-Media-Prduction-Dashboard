-- Rollback of 20261120250000_auto_book_masa_age_requeue.sql. Ages already copied stay (they are the Masa values).
begin;
drop trigger if exists auto_book_masa_age on clinic_reception.masa_bookings;
drop function if exists clinic_reception.auto_book_masa_age();
commit;
