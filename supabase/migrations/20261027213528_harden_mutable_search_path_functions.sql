-- Pin search_path to an empty path for four SECURITY INVOKER functions.
-- Their custom object references are schema-qualified; PostgreSQL built-ins
-- resolve from pg_catalog and remain available.
ALTER FUNCTION public.touch_updated_at() SET search_path = '';
ALTER FUNCTION public.effective_admin_id() SET search_path = '';
ALTER FUNCTION public.track_stage_history() SET search_path = '';
ALTER FUNCTION public.ads_period_ar(text) SET search_path = '';
