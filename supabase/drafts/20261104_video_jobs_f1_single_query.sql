-- F1 OPERATOR PACKET (ONE statement, READ-ONLY). Paste into the Supabase SQL Editor and press Run; paste the single result cell back into GitHub Issue #1.
-- It reads catalog metadata about the table public.video_jobs only: privileges, RLS policies, dependencies, publications. NO table rows, no patient or business data, nothing is changed.
-- If the editor refuses or blocks it, STOP and paste the error text (do not retry in a different way).
select jsonb_pretty(jsonb_build_object(
  'packet', 'F1-single-query-v1',
  'server_version_num', current_setting('server_version_num'),
  -- ACL baseline (rollback source) -----------------------------------------------------------
  'relowner', (select pg_get_userbyid(relowner) from pg_class where oid = 'public.video_jobs'::regclass),
  'relacl_raw', (select relacl::text from pg_class where oid = 'public.video_jobs'::regclass),
  'acl_sorted_value', (select coalesce(string_agg(a::text, '|' order by a::text), 'NULL') from pg_class c left join lateral unnest(c.relacl) a on true where c.oid = 'public.video_jobs'::regclass),
  'acl_entries', (select coalesce(jsonb_agg(format('grantee=%s grantor=%s privilege=%s grantable=%s', case x.grantee when 0 then 'PUBLIC' else x.grantee::regrole::text end, x.grantor::regrole::text, x.privilege_type, x.is_grantable) order by x.grantee, x.privilege_type), '[]'::jsonb)
                  from pg_class c, aclexplode(c.relacl) x where c.oid = 'public.video_jobs'::regclass),
  'rollback_statements', (select coalesce(jsonb_agg(s order by s), '[]'::jsonb) from (
        select format('grant %s on table public.video_jobs to %s%s;  -- grantor %s', string_agg(a.privilege_type, ', ' order by a.privilege_type),
               case a.grantee when 0 then 'public' else quote_ident(a.grantee::regrole::text) end, case when a.is_grantable then ' with grant option' else '' end, a.grantor::regrole::text) as s
        from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.video_jobs'::regclass and a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated'))
        group by a.grantee, a.grantor, a.is_grantable) q),
  'column_acl_entries', (select count(*) from pg_attribute where attrelid = 'public.video_jobs'::regclass and attacl is not null),
  -- Q4: RLS and policies (the read path the dashboard and realtime depend on) --------------------
  'rls_enabled', (select relrowsecurity from pg_class where oid = 'public.video_jobs'::regclass),
  'rls_forced', (select relforcerowsecurity from pg_class where oid = 'public.video_jobs'::regclass),
  'policies', (select coalesce(jsonb_agg(jsonb_build_object('name', policyname, 'permissive', permissive, 'roles', roles::text, 'cmd', cmd, 'using', qual, 'with_check', with_check) order by policyname), '[]'::jsonb)
               from pg_policies where schemaname = 'public' and tablename = 'video_jobs'),
  -- Q5: dependencies and realtime ----------------------------------------------------------------
  'dependent_views', (select coalesce(jsonb_agg(distinct v.oid::regclass::text), '[]'::jsonb) from pg_depend d join pg_rewrite w on w.oid = d.objid join pg_class v on v.oid = w.ev_class
                      where d.refobjid = 'public.video_jobs'::regclass and v.relkind in ('v','m') and v.oid <> d.refobjid),
  'fk_out', (select count(*) from pg_constraint where contype = 'f' and conrelid = 'public.video_jobs'::regclass),
  'fk_in', (select count(*) from pg_constraint where contype = 'f' and confrelid = 'public.video_jobs'::regclass),
  'user_triggers', (select coalesce(jsonb_agg(tgname order by tgname), '[]'::jsonb) from pg_trigger where tgrelid = 'public.video_jobs'::regclass and not tgisinternal),
  'publications', (select coalesce(jsonb_agg(pubname order by pubname), '[]'::jsonb) from pg_publication_tables where schemaname = 'public' and tablename = 'video_jobs'),
  'replica_identity', (select relreplident::text from pg_class where oid = 'public.video_jobs'::regclass)
)) as f1_packet_result;
