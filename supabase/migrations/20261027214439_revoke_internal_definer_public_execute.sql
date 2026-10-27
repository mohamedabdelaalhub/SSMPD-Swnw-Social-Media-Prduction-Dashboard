-- Remove inherited PUBLIC execution from three internal SECDEF helper functions;
-- revoke from anon as well for explicitness. Keep authenticated for in-app calls.
REVOKE EXECUTE ON FUNCTION public.ads_plan_violations(public.media_buyer_plans) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_write_reel_cover(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claude_autoschedule_ready() FROM PUBLIC, anon;
