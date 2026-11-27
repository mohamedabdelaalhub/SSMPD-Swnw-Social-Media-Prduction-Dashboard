-- Rollback of 20261127010000_website_requests.sql (drops the table with its rows: export them first if any exist).
begin;
drop function if exists public.website_requests_mark(uuid, uuid, text);
drop function if exists public.website_requests_list(uuid, text, integer);
drop function if exists public.website_request_ingest(text, text, jsonb, text);
drop table if exists public.website_requests;
commit;
