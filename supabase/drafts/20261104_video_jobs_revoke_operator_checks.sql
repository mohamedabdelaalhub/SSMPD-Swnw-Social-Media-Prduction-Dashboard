-- OPERATOR PACKET (READ-ONLY, review #125). Every statement below is a SELECT on catalog metadata. No table rows (no patient/business data) are read,
-- nothing is written. Run in the Supabase SQL editor (or any read-only session) and return the raw output. Do not run anything else from this repo on production.
-- If any statement is denied, STOP that statement and report the error text; do not work around it.
-- Who can supply it: the project owner, or ChatGPT where its A0 read-only live access already works. Claude Code has no production access (a prior attempt was denied and not bypassed).

-- Q1 ACL snapshot AND the exact rollback script generated from it (save the output; this is the rollback source, it replaces any fixed "grant all")
select 'relacl' as item, coalesce(relacl::text,'NULL (default ACL = owner only)') as value from pg_class where oid = 'public.video_jobs'::regclass
union all
select 'rollback_stmt', format('grant %s on table public.video_jobs to %s%s;', string_agg(privilege_type, ', ' order by privilege_type),
       case a.grantee when 0 then 'public' else quote_ident(a.grantee::regrole::text) end, case when a.is_grantable then ' with grant option' else '' end)
from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.video_jobs'::regclass and a.grantee <> c.relowner group by a.grantee, a.is_grantable
union all
select 'column_acl_entries', count(*)::text from pg_attribute where attrelid = 'public.video_jobs'::regclass and attacl is not null;

-- Q2 effective privileges (inheritance is resolved by the server itself): one row per role, seven privileges
select r.rolname, r.rolinherit, r.rolbypassrls,
       has_table_privilege(r.rolname,'public.video_jobs','SELECT') sel, has_table_privilege(r.rolname,'public.video_jobs','INSERT') ins,
       has_table_privilege(r.rolname,'public.video_jobs','UPDATE') upd, has_table_privilege(r.rolname,'public.video_jobs','DELETE') del,
       has_table_privilege(r.rolname,'public.video_jobs','TRUNCATE') trunc, has_table_privilege(r.rolname,'public.video_jobs','REFERENCES') refs,
       has_table_privilege(r.rolname,'public.video_jobs','TRIGGER') trig
from pg_roles r where r.rolname in ('anon','authenticated','service_role','authenticator') order by r.rolname;

-- Q3 recursive role membership closure: every role anon/authenticated are (transitively) members of, and every member of them (role names only)
with recursive up as (
  select r.oid, r.rolname, 0 as depth from pg_roles r where r.rolname in ('anon','authenticated')
  union select g.oid, g.rolname, up.depth + 1 from up join pg_auth_members m on m.member = up.oid join pg_roles g on g.oid = m.roleid where up.depth < 10),
down as (
  select r.oid, r.rolname, 0 as depth from pg_roles r where r.rolname in ('anon','authenticated')
  union select mm.oid, mm.rolname, down.depth + 1 from down join pg_auth_members m on m.roleid = down.oid join pg_roles mm on mm.oid = m.member where down.depth < 10)
select 'inherits_from' as direction, rolname, depth from up where depth > 0
union all select 'has_member', rolname, depth from down where depth > 0 order by 1, 3, 2;

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

-- Q6 aggregate exposure of ALL public tables (counts only, no table names)
select count(*) as total_tables,
       count(*) filter (where has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) as anon_write_tables,
       count(*) filter (where has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) as auth_write_tables,
       count(*) filter (where has_table_privilege('anon',c.oid,'TRUNCATE')) as anon_truncate_tables,
       count(*) filter (where has_table_privilege('authenticated',c.oid,'TRUNCATE')) as auth_truncate_tables,
       count(*) filter (where not c.relrowsecurity and (has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'))) as api_writable_without_rls,
       count(*) filter (where c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid=c.oid)) as rls_on_no_policy
from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p');

-- Q7 default privileges (why new objects inherit ALL): counts and the ACL text only
select pg_get_userbyid(defaclrole) as owner_role, defaclnamespace::regnamespace::text as schema, defaclobjtype as objtype, defaclacl::text as acl from pg_default_acl;
