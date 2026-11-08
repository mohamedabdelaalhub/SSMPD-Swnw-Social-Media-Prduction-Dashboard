-- Rollback for 20261109120000_partner_lab_link_remove.sql. Restores the reviewed 20261108120000 functions and DROPS the removal marks
-- (hidden rows become visible again; imported costs, candidates and decisions are untouched).
begin;
drop function public.lab_links_workspace(uuid);
drop function public.lab_links_command(text, jsonb);
alter function clinic_labs.workspace_before_remove(uuid) rename to lab_links_workspace;
alter function clinic_labs.lab_links_workspace(uuid) set schema public;
alter function clinic_labs.command_before_remove(text, jsonb) rename to lab_links_command;
alter function clinic_labs.lab_links_command(text, jsonb) set schema public;
alter table clinic_labs.price_items drop constraint price_items_removed_ck, drop column removed_at, drop column removed_by, drop column removed_note;
revoke all on function public.lab_links_workspace(uuid), public.lab_links_command(text, jsonb) from public, anon;
grant execute on function public.lab_links_workspace(uuid), public.lab_links_command(text, jsonb) to authenticated;
commit;
