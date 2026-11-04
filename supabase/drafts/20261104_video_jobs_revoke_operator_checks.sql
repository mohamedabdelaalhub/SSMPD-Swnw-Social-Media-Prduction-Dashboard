-- OPERATOR PACKET (READ-ONLY, review #125). Every statement below is a SELECT on catalog metadata. No table rows (no patient/business data) are read,
-- nothing is written. Run in the Supabase SQL editor (or any read-only session) and return the raw output. Do not run anything else from this repo on production.
-- If any statement is denied, STOP that statement and report the error text; do not work around it.
-- Who can supply it: the project owner, or ChatGPT where its A0 read-only live access already works. Claude Code has no production access (a prior attempt was denied and not bypassed).

-- Q1 ACL snapshot. The RAW relacl text is the canonical record (it carries grantor and grant-option metadata exactly). The per-entry rows and the generated
-- rollback statements (ONLY for anon and authenticated, the two grantees the REVOKE draft removes; all other entries are untouched by the draft) are convenience; after any rollback, re-run Q1v and compare its value with the raw snapshot taken here (equal = exact restore).
select 'relacl_raw' as item, coalesce(relacl::text,'NULL (default ACL = owner only)') as value from pg_class where oid = 'public.video_jobs'::regclass
union all
select 'relowner', pg_get_userbyid(relowner) from pg_class where oid = 'public.video_jobs'::regclass
union all
select 'acl_entry', format('grantee=%s grantor=%s privilege=%s grantable=%s', case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end, a.grantor::regrole::text, a.privilege_type, a.is_grantable)
from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.video_jobs'::regclass
union all
select 'rollback_stmt', format('grant %s on table public.video_jobs to %s%s;  -- grantor %s%s', string_agg(a.privilege_type, ', ' order by a.privilege_type),
       case a.grantee when 0 then 'public' else quote_ident(a.grantee::regrole::text) end, case when a.is_grantable then ' with grant option' else '' end,
       a.grantor::regrole::text, case when a.grantor <> c.relowner then '  -- NON-OWNER GRANTOR: this statement run as the owner records the OWNER as grantor; replay it with SET ROLE to that grantor or treat the restore as inexact' else '' end)
from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.video_jobs'::regclass and a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated')) group by a.grantee, a.grantor, c.relowner, a.is_grantable
union all
select 'column_acl_entries', count(*)::text from pg_attribute where attrelid = 'public.video_jobs'::regclass and attacl is not null;

-- Q1v verification value (run before AND after a rollback; the two values must be identical): sorted aclitem texts, grantor and grant option included
select coalesce(string_agg(a::text, '|' order by a::text), 'NULL') as acl_sorted_value from pg_class c left join lateral unnest(c.relacl) a on true where c.oid = 'public.video_jobs'::regclass;

-- Q2 effective privileges (inheritance is resolved by the server itself): one row per role, seven privileges
select r.rolname, r.rolinherit, r.rolbypassrls,
       has_table_privilege(r.rolname,'public.video_jobs','SELECT') sel, has_table_privilege(r.rolname,'public.video_jobs','INSERT') ins,
       has_table_privilege(r.rolname,'public.video_jobs','UPDATE') upd, has_table_privilege(r.rolname,'public.video_jobs','DELETE') del,
       has_table_privilege(r.rolname,'public.video_jobs','TRUNCATE') trunc, has_table_privilege(r.rolname,'public.video_jobs','REFERENCES') refs,
       has_table_privilege(r.rolname,'public.video_jobs','TRIGGER') trig
from pg_roles r where r.rolname in ('anon','authenticated','service_role','authenticator') order by r.rolname;

-- Q3 role membership closure (role names only). UNION on the role oid alone de-duplicates, so every role appears once even when reachable by several paths
-- (diamonds); the search terminates by itself. inherit_option / set_option exist only on PostgreSQL 16+ and are read via to_jsonb so this runs on older versions
-- too (NULL there). Effective inheritance must NOT be inferred from rolinherit or from this list alone: Q2 (has_table_privilege) is the authority.
with recursive up(oid) as (
  select r.oid from pg_roles r where r.rolname in ('anon','authenticated')
  union select m.roleid from up join pg_auth_members m on m.member = up.oid),
down(oid) as (
  select r.oid from pg_roles r where r.rolname in ('anon','authenticated')
  union select m.member from down join pg_auth_members m on m.roleid = down.oid)
select 'api_role_is_member_of' as relation, g.rolname as role_name,
       (select string_agg(distinct coalesce(to_jsonb(m)->>'inherit_option','n/a'), ',') from pg_auth_members m where m.roleid = g.oid and m.member in (select oid from up)) as inherit_option_seen
from pg_roles g where g.oid in (select oid from up) and g.rolname not in ('anon','authenticated')
union all
select 'has_member', mm.rolname, null from pg_roles mm where mm.oid in (select oid from down) and mm.rolname not in ('anon','authenticated')
order by 1, 2;

-- Q4 policies that apply to the read path (SELECT or ALL), plus RLS flags. Policy expressions are metadata, not row data.
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced, p.policyname, p.permissive, p.roles::text, p.cmd, p.qual, p.with_check
from pg_class c left join pg_policies p on p.schemaname='public' and p.tablename='video_jobs' and p.cmd in ('SELECT','ALL')
where c.oid = 'public.video_jobs'::regclass;

-- Q5 dependencies and realtime facts (counts and flags only)
select (select count(*) from pg_depend d join pg_rewrite w on w.oid=d.objid join pg_class v on v.oid=w.ev_class where d.refobjid='public.video_jobs'::regclass and v.relkind in ('v','m') and v.oid<>d.refobjid) as dependent_views,
       (select count(*) from pg_constraint where contype='f' and conrelid='public.video_jobs'::regclass) as fk_out,
       (select count(*) from pg_constraint where contype='f' and confrelid='public.video_jobs'::regclass) as fk_in,
       (select count(*) from pg_trigger where tgrelid='public.video_jobs'::regclass and not tgisinternal) as user_triggers,
       (select count(*) from pg_publication_tables where schemaname='public' and tablename='video_jobs') as publications_containing_table,
       (select string_agg(pubname, ',') from pg_publication_tables where schemaname='public' and tablename='video_jobs') as publication_names,
       (select relreplident::text from pg_class where oid='public.video_jobs'::regclass) as replica_identity;

-- Q6 aggregate GRANT-level exposure of all public tables (counts only, no table names). These are catalog METADATA risk counts: a count says "a grant exists",
-- not that the table is reachable through the API (that also depends on the schema being exposed, RLS policies and any views); it is not proof of reachability.
select count(*) as total_tables,
       count(*) filter (where has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) as tables_with_anon_write_or_truncate_grant,
       count(*) filter (where has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) as tables_with_authenticated_write_or_truncate_grant,
       count(*) filter (where has_table_privilege('anon',c.oid,'TRUNCATE')) as tables_with_anon_truncate_grant,
       count(*) filter (where has_table_privilege('authenticated',c.oid,'TRUNCATE')) as tables_with_authenticated_truncate_grant,
       count(*) filter (where not c.relrowsecurity and (has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'))) as rls_off_tables_with_api_write_grant_metadata_count,
       count(*) filter (where c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid=c.oid)) as rls_on_tables_without_any_policy
from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p');

-- Q7 default privileges (why new objects inherit ALL): counts and the ACL text only
select pg_get_userbyid(defaclrole) as owner_role, defaclnamespace::regnamespace::text as schema, defaclobjtype as objtype, defaclacl::text as acl from pg_default_acl;
