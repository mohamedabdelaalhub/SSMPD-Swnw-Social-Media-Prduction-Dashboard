-- Rollback for 20261108120000_partner_lab_links.sql. Drops ONLY objects that migration created.
-- WARNING: deletes every imported partner-lab price and every staff decision. Export first if any were made:
--   select * from clinic_labs.item_links where status <> 'suggested';
begin;
drop function if exists public.lab_links_workspace(uuid);
drop function if exists public.lab_links_command(text, jsonb);
drop schema if exists clinic_labs cascade;
commit;
