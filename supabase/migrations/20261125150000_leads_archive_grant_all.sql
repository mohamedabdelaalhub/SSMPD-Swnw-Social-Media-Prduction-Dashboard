-- 20261125150000 (owner 2026-11-25 «الليدز تشوف كلها»): an ACTIVE admin with admins.has_leads_archive_access = true sees and
-- works ALL leads, like reception — not only the leads assigned to them. The edge functions (leads-list, leads-update-status,
-- leads-attempt, leads-update-details, lead-invoice-upload, leads-complete-missing-data) already honour the grant; the browser
-- also reads leads and their history directly (lead details, edit, attempts / status / field-change logs, invoices), so this
-- adds SEPARATE permissive policies for grant holders (Postgres ORs permissive policies; the existing ones are not touched):
--   select on leads, lead_attempts, lead_status_log, lead_field_changes, lead_invoices;  update on leads.
-- Writes from the dashboard go through the edge functions (service role). Plain customer_service without the grant is unchanged.
-- Rollback: supabase/rollbacks/20261125150000_leads_archive_grant_all.rollback.sql
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'admins' and column_name = 'has_leads_archive_access') then
    raise exception 'admins.has_leads_archive_access مش موجود'; end if;
  if to_regprocedure('public.has_leads_archive_grant()') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function public.has_leads_archive_grant() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.admins a where a.id = public.my_admin_id() and a.active and a.has_leads_archive_access is true) $$;
revoke all on function public.has_leads_archive_grant() from public, anon;
grant execute on function public.has_leads_archive_grant() to authenticated;

create policy "leads archive grant select" on public.leads for select to authenticated using (public.has_leads_archive_grant());
create policy "leads archive grant update" on public.leads for update to authenticated using (public.has_leads_archive_grant()) with check (public.has_leads_archive_grant());
do $$ declare t text; begin
  foreach t in array array['lead_attempts', 'lead_status_log', 'lead_field_changes', 'lead_invoices'] loop
    if to_regclass('public.' || t) is not null then
      execute format('create policy %I on public.%I for select to authenticated using (public.has_leads_archive_grant())', 'leads archive grant select', t);
    end if;
  end loop;
end $$;
