-- DRAFT, NOT APPLIED (2026-11-04, review #122). Minimal least-privilege REVOKE for public.video_jobs.
-- Finding (live, read-only, relayed): anon AND authenticated hold ALL table privileges (DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE) on public.video_jobs,
-- (Supabase default privileges), while RLS has only a SELECT policy for authenticated. RLS limits row DML; it does NOT cover TRUNCATE, TRIGGER or REFERENCES.
-- What the dashboard really needs (repo audit): authenticated SELECT only (assets/js/db.js reads video_jobs; realtime postgres_changes needs SELECT). All writes go through
-- SECURITY DEFINER RPCs (run as the table owner), the worker uses service_role. anon needs nothing.
--
-- STEP 0 (read-only snapshot, keep the output for the exact rollback):
--   select relacl::text from pg_class where oid = 'public.video_jobs'::regclass;
--   select attname, attacl::text from pg_attribute where attrelid = 'public.video_jobs'::regclass and attacl is not null;
--   select r.rolname as member, g.rolname as granted from pg_auth_members m join pg_roles r on r.oid = m.member join pg_roles g on g.oid = m.roleid where g.rolname in ('anon','authenticated','service_role');
-- STEP 1 (one transaction):
begin;
revoke all on table public.video_jobs from anon;
revoke all on table public.video_jobs from authenticated;
grant select on table public.video_jobs to authenticated;
-- column-level ACL entries are separate and survive a table-level REVOKE; clear them for both roles, then the SELECT policy keeps working
do $$
declare c text;
begin
  for c in select attname from pg_attribute where attrelid = 'public.video_jobs'::regclass and attnum > 0 and not attisdropped loop
    execute format('revoke all (%I) on table public.video_jobs from anon', c);
    execute format('revoke insert (%I), update (%I), references (%I) on table public.video_jobs from authenticated', c, c, c);
  end loop;
end $$;
commit;
-- ROLLBACK (exact inverse of the table-level change; add column grants only if the STEP 0 snapshot showed attacl entries):
--   begin; grant all on table public.video_jobs to anon; grant all on table public.video_jobs to authenticated; commit;
-- NOT changed here: service_role privileges, RLS, policies, triggers, other tables, default privileges (pg_default_acl) -- widening to other tables is a separate decision.
