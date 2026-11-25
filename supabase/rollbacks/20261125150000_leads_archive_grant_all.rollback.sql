-- Rollback for 20261125150000_leads_archive_grant_all.sql: grant holders go back to the role-based policies only.
-- (The edge functions keep honouring the grant until they are redeployed from the previous commit.)
drop policy if exists "leads archive grant select" on public.leads;
drop policy if exists "leads archive grant update" on public.leads;
do $$ declare t text; begin
  foreach t in array array['lead_attempts', 'lead_status_log', 'lead_field_changes', 'lead_invoices'] loop
    if to_regclass('public.' || t) is not null then execute format('drop policy if exists %I on public.%I', 'leads archive grant select', t); end if;
  end loop;
end $$;
drop function if exists public.has_leads_archive_grant();
