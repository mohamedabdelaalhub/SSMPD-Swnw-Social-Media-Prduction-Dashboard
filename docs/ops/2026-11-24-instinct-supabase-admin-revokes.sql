-- One-off, run AS supabase_admin (the owner of these objects); the migration role cannot change them.
-- Why: the #815 live dry-run showed any signed-in account (role authenticated) — the Instinct AI account, and patient-portal
-- logins as well — can read: query texts (pg_stat_statements), pg_net HTTP responses (may contain tokens) and realtime
-- subscriptions. The browser never needs them: the dashboard does not query them, and Realtime / pg_net run as their own
-- service roles. Owner decision needed before running. Independent of migration 20261124200000.

-- ===================== 0. PREVIEW (read-only) =====================
select t, has_table_privilege('anon', t, 'SELECT') anon_select, has_table_privilege('authenticated', t, 'SELECT') authenticated_select,
       pg_get_userbyid((select relowner from pg_class where oid = t::regclass)) owner
  from unnest(array['extensions.pg_stat_statements', 'extensions.pg_stat_statements_info', 'net._http_response', 'realtime.subscription']) t
 where to_regclass(t) is not null;

-- ===================== 1. APPLY (as supabase_admin) =====================
begin;
revoke select on extensions.pg_stat_statements      from public, anon, authenticated;
revoke select on extensions.pg_stat_statements_info from public, anon, authenticated;
revoke select on net._http_response                 from public, anon, authenticated;
revoke select on realtime.subscription              from public, anon, authenticated;
-- check: every column false
select t, has_table_privilege('anon', t, 'SELECT') anon_select, has_table_privilege('authenticated', t, 'SELECT') authenticated_select
  from unnest(array['extensions.pg_stat_statements', 'extensions.pg_stat_statements_info', 'net._http_response', 'realtime.subscription']) t;
commit;

-- ===================== UNDO (only if something that needs them breaks) =====================
-- grant select on extensions.pg_stat_statements, extensions.pg_stat_statements_info to authenticated;
-- grant select on net._http_response to authenticated;
-- grant select on realtime.subscription to authenticated;
