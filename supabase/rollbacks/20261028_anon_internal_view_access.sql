-- Rollback restores the prior SELECT grant to anon on these six views.
GRANT SELECT ON public.vw_content_intelligence_patterns TO anon;
GRANT SELECT ON public.vw_content_meta_performance TO anon;
GRANT SELECT ON public.vw_lead_meta_attribution TO anon;
GRANT SELECT ON public.vw_meta_ad_performance TO anon;
GRANT SELECT ON public.vw_meta_creative_performance TO anon;
GRANT SELECT ON public.vw_meta_specialty_performance TO anon;
