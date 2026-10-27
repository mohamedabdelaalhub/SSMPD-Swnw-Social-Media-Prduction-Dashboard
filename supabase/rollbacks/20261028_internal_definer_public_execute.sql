-- Restore this migration's prior state: PUBLIC execution (anon inherited it),
-- with no direct anon ACL entry. Direct anon execution can then be restored by
-- rolling back the earlier RPC grant migration if that rollback is required.
GRANT EXECUTE ON FUNCTION public.ads_plan_violations(public.media_buyer_plans) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_reel_cover(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.claude_autoschedule_ready() TO PUBLIC;
