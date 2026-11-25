-- Rollback for 20261125150000_leads_archive_grant_all.sql: grant holders go back to the role-based policies only, and the
-- activity log / report functions are removed.
-- (The edge functions keep honouring the grant until they are redeployed from the previous commit.)
drop policy if exists "leads archive grant select" on public.leads;
drop policy if exists "leads archive grant update" on public.leads;
do $$ declare t text; begin
  foreach t in array array['lead_attempts', 'lead_status_log', 'lead_field_changes', 'lead_invoices'] loop
    if to_regclass('public.' || t) is not null then execute format('drop policy if exists %I on public.%I', 'leads archive grant select', t); end if;
  end loop;
end $$;
drop function if exists public.has_leads_archive_grant();
drop function if exists public.leads_activity_feed(uuid, date, date, integer);
drop function if exists public.leads_activity_report(date, date);
drop function if exists public.leads_activity_events(timestamptz, timestamptz);
drop function if exists public.log_leads_export(text, integer, jsonb);
drop trigger if exists trg_log_lead_delete on public.leads;
drop function if exists public.log_lead_delete();
-- the activity rows (deletes / exports / missing-data completions) are dropped with the table
drop table if exists public.lead_activity_log;
drop function if exists public.leads_activity_manager();
