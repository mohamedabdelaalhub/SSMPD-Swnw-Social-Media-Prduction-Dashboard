-- Rollback of 20261127240000_website_payer_options.sql
begin;
drop function if exists public.website_payer_quote(uuid, numeric, date);
drop function if exists public.website_payer_options();
commit;
