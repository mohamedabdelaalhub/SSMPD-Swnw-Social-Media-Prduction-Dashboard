-- Rollback of 20261127250000_website_booking_attach_approval.sql
begin;
drop function if exists public.website_booking_attach_approval(text, text, text);
commit;
