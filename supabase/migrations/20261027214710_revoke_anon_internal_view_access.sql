-- These internal analytics views are SECURITY INVOKER and are only used by
-- authenticated dashboards. Remove unnecessary anonymous SELECT grants.
REVOKE SELECT ON public.vw_content_intelligence_patterns FROM anon;
REVOKE SELECT ON public.vw_content_meta_performance FROM anon;
REVOKE SELECT ON public.vw_lead_meta_attribution FROM anon;
REVOKE SELECT ON public.vw_meta_ad_performance FROM anon;
REVOKE SELECT ON public.vw_meta_creative_performance FROM anon;
REVOKE SELECT ON public.vw_meta_specialty_performance FROM anon;
