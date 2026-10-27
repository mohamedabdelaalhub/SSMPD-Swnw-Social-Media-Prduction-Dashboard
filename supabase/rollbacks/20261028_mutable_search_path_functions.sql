-- Rollback for the search_path hardening migration.
-- This restores the previous NULL per-function configuration.
ALTER FUNCTION public.touch_updated_at() RESET search_path;
ALTER FUNCTION public.effective_admin_id() RESET search_path;
ALTER FUNCTION public.track_stage_history() RESET search_path;
ALTER FUNCTION public.ads_period_ar(text) RESET search_path;
