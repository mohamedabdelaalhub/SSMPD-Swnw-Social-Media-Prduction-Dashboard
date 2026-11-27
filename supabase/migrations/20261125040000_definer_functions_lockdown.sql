-- Close definer functions that any signed-in account could call (found by the #815 live AI sweep, 2026-11-24; owner approved the
-- follow-up via main chat 5). "Any signed-in account" includes patient-portal logins: they are role authenticated too.
--
-- 1. Worker / server-only functions → EXECUTE for service_role only (revoked from public, anon, authenticated):
--    * clinic_reception_message_claim(integer)  — leases reception outbox messages (patient names, times). Granted to service_role
--      only in 20261017044739, but a later CREATE OR REPLACE left the default PUBLIC execute in place. Its pair
--      clinic_reception_message_ack is aligned the same way.
--    * clinic_reception_agent_health()          — live workspace id + outbox / help / missed-call counters for the external agent.
--      Dashboard functions that embed it (digital team) are SECURITY DEFINER and keep working (they run as the owner).
--    * content_archive_candidates(...), content_archive_pending_cleanup(...) — only the content-archive-process edge function calls
--      them, with the service key.
--    * content_learning_brief(text), content_learning_brief_core(text) — server / MCP brief. Staff keep using
--      content_learning_brief_staff(text) (SECURITY DEFINER wrapper, checks my_admin_id()), which is unchanged.
-- 2. lead_capture_gap(date) — today's conversation / lead counters: now refuses a signed-in caller without a leads role
--    (reception, customer_service, general_manager, super_admin). service_role and cron (no auth.uid()) unchanged.
-- 3. Not changed: contracting_partner_snapshot(uuid) and contracting_progressive_incentive(numeric,uuid,text) are SECURITY INVOKER —
--    they read only what the caller's own RLS allows (the sweep saw zero-valued shapes).
-- The ACL of every touched function is saved first (public.definer_lockdown_saved) and restored by the rollback.
-- Rollback: supabase/rollbacks/20261125040000_definer_functions_lockdown.rollback.sql
begin;

do $$ begin
  if to_regclass('public.definer_lockdown_saved') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table public.definer_lockdown_saved (
  sig text primary key,
  grantees text[] not null,          -- roles that had EXECUTE before ('PUBLIC' = everyone)
  def text,                          -- full definition when the body is replaced
  saved_at timestamptz not null default now()
);
alter table public.definer_lockdown_saved enable row level security;
revoke all on public.definer_lockdown_saved from public, anon, authenticated;

-- 1. service_role only
do $$
declare r record; n int := 0;
begin
  for r in select p.oid, p.oid::regprocedure::text sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.prokind = 'f'
              and p.proname in ('clinic_reception_message_claim', 'clinic_reception_message_ack', 'clinic_reception_agent_health',
                                'content_archive_candidates', 'content_archive_pending_cleanup',
                                'content_learning_brief', 'content_learning_brief_core') loop
    insert into public.definer_lockdown_saved(sig, grantees)
    select r.sig, coalesce(array_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end), '{}')
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = r.oid and a.privilege_type = 'EXECUTE';
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    n := n + 1;
  end loop;
  if n < 5 then raise exception 'expected at least 5 functions to lock down, found %', n; end if;
  raise notice 'service_role only: % functions', n;
end $$;

-- 2. lead_capture_gap: leads roles (or a server caller)
do $$ begin
  if to_regprocedure('public.lead_capture_gap(date)') is null then raise exception 'lead_capture_gap(date) not found'; end if;
  insert into public.definer_lockdown_saved(sig, grantees, def)
  select 'public.lead_capture_gap(date)', coalesce(array_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end), '{}'),
         pg_get_functiondef('public.lead_capture_gap(date)'::regprocedure)
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = 'public.lead_capture_gap(date)'::regprocedure and a.privilege_type = 'EXECUTE';
end $$;

create or replace function public.lead_capture_gap(p_day date default (now() at time zone 'Africa/Cairo')::date)
 returns table(conversations integer, leads_logged integer, gap integer, stale_leads integer)
 language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null and not public.has_any_role(array['reception', 'customer_service', 'general_manager', 'super_admin']) then
    raise exception 'العداد ده لفريق الليدز والإدارة بس' using errcode = '42501';
  end if;
  return query
  with c as (select count(distinct conversation_id)::int n from public.social_messages
              where not is_page and (sent_at at time zone 'Africa/Cairo')::date = p_day),
       l as (select count(*)::int n from public.leads where (received_at at time zone 'Africa/Cairo')::date = p_day),
       s as (select count(*)::int n from public.leads
              where current_status in ('new','in_progress') and (updated_at at time zone 'Africa/Cairo')::date < p_day)
  select c.n, l.n, greatest(c.n - l.n, 0), s.n from c, l, s;
end $$;
revoke all on function public.lead_capture_gap(date) from public, anon;
grant execute on function public.lead_capture_gap(date) to authenticated, service_role;

commit;
