-- 20261125150000 (owner 2026-11-25 «الليدز تشوف كلها»): an ACTIVE admin with admins.has_leads_archive_access = true sees and
-- works ALL leads, like reception — not only the leads assigned to them. The edge functions (leads-list, leads-update-status,
-- leads-attempt, leads-update-details, lead-invoice-upload, leads-complete-missing-data) already honour the grant; the browser
-- also reads leads and their history directly (lead details, edit, attempts / status / field-change logs, invoices), so this
-- adds SEPARATE permissive policies for grant holders (Postgres ORs permissive policies; the existing ones are not touched):
--   select on leads, lead_attempts, lead_status_log, lead_field_changes, lead_invoices;  update on leads.
-- Writes from the dashboard go through the edge functions (service role). Plain customer_service without the grant is unchanged.
-- Owner addition «يشوف كل الليدز واي حركة بيعملها عندنا تقرير منها»: every action on a lead is kept with who + when, and
-- management gets a per-employee report. Already logged with the actor: status / booking (lead_status_log, booked_by), calls /
-- attempts (lead_attempts.employee_id), field edits incl. assignment (lead_field_changes), invoices (lead_invoices.uploaded_by).
-- New public.lead_activity_log for what was not: delete (trigger — survives the cascade), export (log_leads_export, called by
-- the xlsx buttons), «إكمال البيانات الناقصة» (written by the edge function). Report RPCs (managers only):
--   leads_activity_report(from, to)  — one row per employee with counts per action
--   leads_activity_feed(admin, from, to, limit) — that employee's actions, newest first
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

-- ===== activity trail (owner: «اي حركة بيعملها عندنا تقرير منها») =====
create table public.lead_activity_log(
  id uuid primary key default gen_random_uuid(),
  admin_id uuid,
  action text not null check (action in ('delete', 'export', 'complete_missing_data')),
  lead_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());
create index lead_activity_log_admin_idx on public.lead_activity_log(admin_id, created_at desc);
alter table public.lead_activity_log enable row level security;
revoke all on public.lead_activity_log from public, anon, authenticated;

create function public.leads_activity_manager() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.is_super() or public.my_role() = 'general_manager'
      or exists (select 1 from public.admin_extra_roles x where x.admin_id = public.my_admin_id() and x.role in ('super_admin', 'general_manager')) $$;
revoke all on function public.leads_activity_manager() from public, anon;
grant execute on function public.leads_activity_manager() to authenticated;
create policy "lead_activity_log managers read" on public.lead_activity_log for select to authenticated using (public.leads_activity_manager());
grant select on public.lead_activity_log to authenticated;

-- delete: kept even though the lead and its own logs are gone
create function public.log_lead_delete() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.lead_activity_log(admin_id, action, lead_id, detail)
    values (public.effective_admin_id(), 'delete', old.id, jsonb_build_object('customer_name', old.customer_name, 'phone', old.phone_raw,
      'status', old.current_status, 'source', old.source, 'created_at', old.created_at, 'assigned_to', old.assigned_to));
  return old;
end $$;
create trigger trg_log_lead_delete before delete on public.leads for each row execute function public.log_lead_delete();

-- export: called by the xlsx buttons before the file is written
create function public.log_leads_export(p_kind text, p_rows integer, p_filters jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  if me is null then raise exception 'سجّل دخولك تاني' using errcode = '42501'; end if;
  insert into public.lead_activity_log(admin_id, action, detail)
    values (me, 'export', jsonb_build_object('kind', left(coalesce(p_kind, ''), 40), 'rows', greatest(coalesce(p_rows, 0), 0), 'filters', coalesce(p_filters, '{}'::jsonb)));
end $$;
revoke all on function public.log_leads_export(text, integer, jsonb) from public, anon;
grant execute on function public.log_leads_export(text, integer, jsonb) to authenticated;

-- every action, one shape (who, when, what, which lead)
create function public.leads_activity_events(p_from timestamptz, p_to timestamptz) returns table(admin_id uuid, at timestamptz, action text, lead_id uuid, detail text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.changed_by, s.changed_at, case when s.new_status = 'booked' then 'booking' else 'status' end, s.lead_id,
         coalesce(s.old_status, '') || ' → ' || coalesce(s.new_status, '')
    from public.lead_status_log s where s.changed_at >= p_from and s.changed_at < p_to
  union all
  select a.employee_id, a.attempt_date, 'attempt', a.lead_id, coalesce(a.result, '') || coalesce(' — ' || nullif(a.notes, ''), '')
    from public.lead_attempts a where a.attempt_date >= p_from and a.attempt_date < p_to
  union all
  select c.changed_by, c.changed_at, case when c.field_name = 'assigned_to' then 'assignment' else 'field_edit' end, c.lead_id,
         c.field_name || ': ' || coalesce(left(c.old_value, 60), '') || ' → ' || coalesce(left(c.new_value, 60), '')
    from public.lead_field_changes c where c.changed_at >= p_from and c.changed_at < p_to
  union all
  select i.uploaded_by, i.uploaded_at, 'invoice', i.lead_id, coalesce(i.service_name, '') || ' — ' || i.amount
    from public.lead_invoices i where i.uploaded_at >= p_from and i.uploaded_at < p_to
  union all
  select g.admin_id, g.created_at, g.action, g.lead_id,
         case g.action when 'export' then coalesce(g.detail->>'kind', '') || ' — ' || coalesce(g.detail->>'rows', '0') || ' صف'
                       when 'delete' then coalesce(g.detail->>'customer_name', '') || ' — ' || coalesce(g.detail->>'status', '')
                       else coalesce(g.detail->>'customer_name', '') end
    from public.lead_activity_log g where g.created_at >= p_from and g.created_at < p_to $$;
revoke all on function public.leads_activity_events(timestamptz, timestamptz) from public, anon, authenticated;

create function public.leads_activity_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare f timestamptz; t timestamptz;
begin
  if not public.leads_activity_manager() then raise exception 'تقرير حركة الليدز للمدير العام والسوبر أدمن بس' using errcode = '42501'; end if;
  f := coalesce(p_from, ((now() at time zone 'Africa/Cairo')::date - 30))::timestamp at time zone 'Africa/Cairo';
  t := (coalesce(p_to, (now() at time zone 'Africa/Cairo')::date) + 1)::timestamp at time zone 'Africa/Cairo';
  return jsonb_build_object('from', f, 'to', t, 'rows', coalesce((
    select jsonb_agg(r order by (r->>'total')::int desc) from (
      select jsonb_build_object('admin_id', e.admin_id,
        'name', coalesce((select coalesce(nullif(btrim(to_jsonb(a)->>'name'), ''), to_jsonb(a)->>'email') from public.admins a where a.id = e.admin_id), 'غير معروف / تلقائي'),
        'has_grant', coalesce((select a.has_leads_archive_access from public.admins a where a.id = e.admin_id), false),
        'status', count(*) filter (where e.action = 'status'), 'booking', count(*) filter (where e.action = 'booking'),
        'attempt', count(*) filter (where e.action = 'attempt'), 'field_edit', count(*) filter (where e.action = 'field_edit'),
        'assignment', count(*) filter (where e.action = 'assignment'), 'invoice', count(*) filter (where e.action = 'invoice'),
        'complete_missing_data', count(*) filter (where e.action = 'complete_missing_data'),
        'delete', count(*) filter (where e.action = 'delete'), 'export', count(*) filter (where e.action = 'export'),
        'total', count(*), 'last_at', max(e.at)) r
      from public.leads_activity_events(f, t) e group by e.admin_id) x), '[]'::jsonb));
end $$;
revoke all on function public.leads_activity_report(date, date) from public, anon;
grant execute on function public.leads_activity_report(date, date) to authenticated;

create function public.leads_activity_feed(p_admin uuid, p_from date default null, p_to date default null, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare f timestamptz; t timestamptz;
begin
  if not public.leads_activity_manager() then raise exception 'تقرير حركة الليدز للمدير العام والسوبر أدمن بس' using errcode = '42501'; end if;
  f := coalesce(p_from, ((now() at time zone 'Africa/Cairo')::date - 30))::timestamp at time zone 'Africa/Cairo';
  t := (coalesce(p_to, (now() at time zone 'Africa/Cairo')::date) + 1)::timestamp at time zone 'Africa/Cairo';
  return coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'lead_id', e.lead_id, 'detail', e.detail,
      'customer_name', (select l.customer_name from public.leads l where l.id = e.lead_id)) order by e.at desc)
    from (select * from public.leads_activity_events(f, t) x where x.admin_id is not distinct from p_admin order by x.at desc
          limit least(greatest(coalesce(p_limit, 200), 1), 1000)) e), '[]'::jsonb);
end $$;
revoke all on function public.leads_activity_feed(uuid, date, date, integer) from public, anon;
grant execute on function public.leads_activity_feed(uuid, date, date, integer) to authenticated;
