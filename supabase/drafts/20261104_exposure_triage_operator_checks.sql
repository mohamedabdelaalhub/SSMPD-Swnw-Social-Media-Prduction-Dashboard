-- OPERATOR PACKET 2 (READ-ONLY, review #129): live evidence for the API exposure triage. SELECT-only on catalog/statistics metadata. NO table rows are read (no patient or business data).
-- The dashboard is LIVE PRODUCTION: nothing here writes, impersonates a user, or tests a write. If any statement is denied, STOP that statement and report the error; do not work around it.
-- Supplier: ChatGPT via its existing A0 read-only access, or the owner. Claude Code has no production access.

-- X1 per-table live grants + RLS + applicable policy commands (table names and flags only). Compare with the repo-derived matrix (tests/real-schema-exposure-matrix.sh).
select c.relname as table_name, c.relrowsecurity::int as rls, c.relforcerowsecurity::int as rls_forced,
 has_table_privilege('anon',c.oid,'SELECT')::int as a_sel, has_table_privilege('anon',c.oid,'INSERT')::int as a_ins, has_table_privilege('anon',c.oid,'UPDATE')::int as a_upd, has_table_privilege('anon',c.oid,'DELETE')::int as a_del, has_table_privilege('anon',c.oid,'TRUNCATE')::int as a_trunc,
 has_table_privilege('authenticated',c.oid,'SELECT')::int as u_sel, has_table_privilege('authenticated',c.oid,'INSERT')::int as u_ins, has_table_privilege('authenticated',c.oid,'UPDATE')::int as u_upd, has_table_privilege('authenticated',c.oid,'DELETE')::int as u_del, has_table_privilege('authenticated',c.oid,'TRUNCATE')::int as u_trunc,
 (select string_agg(distinct p.cmd, ',' order by p.cmd) from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.roles::text ~ '(authenticated|public)') as auth_policy_cmds,
 (select string_agg(distinct p.cmd, ',' order by p.cmd) from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.roles::text ~ '(anon|public)') as anon_or_public_policy_cmds
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') order by 1;

-- X2 LIVE WRITE ACTIVITY per table since the statistics were last reset (counters only; no row contents). Zero counters over a long window = candidate for write-revoke, NOT proof.
select s.relname as table_name, s.n_tup_ins as inserts, s.n_tup_upd as updates, s.n_tup_del as deletes, (select stats_reset from pg_stat_database where datname = current_database()) as stats_reset_at
from pg_stat_user_tables s where s.schemaname = 'public' order by (s.n_tup_ins + s.n_tup_upd + s.n_tup_del) desc, 1;

-- X3 function facts: TRUNCATE inside functions, and counts of functions executable by anon
select count(*) filter (where not p.prosecdef and p.prosrc ~* '\mtruncate\M') as invoker_functions_mentioning_truncate,
       count(*) filter (where p.prosecdef and p.prosrc ~* '\mtruncate\M') as definer_functions_mentioning_truncate,
       count(*) filter (where p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')) as definer_functions_executable_by_anon,
       count(*) filter (where not p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')) as invoker_functions_executable_by_anon,
       count(*) as total_public_functions
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f';

-- X4 policies that apply to anon or PUBLIC for write-capable commands (names and expressions are metadata; the expression decides who passes, not the role list)
select tablename, policyname, permissive, roles::text as roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and roles::text ~ '(anon|public)' and cmd in ('INSERT','UPDATE','DELETE','ALL') order by tablename, policyname;

-- X5 default privileges (ACL text only)
select pg_get_userbyid(defaclrole) as owner_role, defaclnamespace::regnamespace::text as schema, defaclobjtype as objtype, defaclacl::text as acl from pg_default_acl;
