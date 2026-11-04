-- Fix: tiktok_publish_jobs RLS policies existed, but the earlier migration
-- revoked ALL table-level privileges from `authenticated` without granting
-- any back. Postgres requires BOTH a table-level GRANT and a passing RLS
-- policy — so every page_manager/approver/super_admin query against this
-- table failed with "permission denied for table tiktok_publish_jobs"
-- regardless of role. RLS policies still restrict which rows are visible;
-- this only restores the baseline table access they depend on.
grant select, insert, update on public.tiktok_publish_jobs to authenticated;
