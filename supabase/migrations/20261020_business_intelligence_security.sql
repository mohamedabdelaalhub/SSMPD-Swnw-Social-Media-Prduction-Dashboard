-- Harden Business Intelligence against broad project default privileges.
-- The project currently grants anon/authenticated on newly-created public objects by default,
-- so this migration resets privileges and grants only the exact surface used by the module.

-- Tables: no public/anon access. Reset authenticated first, then grant least privilege.
revoke all on table public.business_knowledge_items from public, anon, authenticated;
revoke all on table public.business_knowledge_relations from public, anon, authenticated;
revoke all on table public.business_recommendations from public, anon, authenticated;
revoke all on table public.business_decisions from public, anon, authenticated;
revoke all on table public.business_measurements from public, anon, authenticated;
revoke all on table public.business_extraction_queue from public, anon, authenticated;
revoke all on table public.business_entity_links from public, anon, authenticated;
revoke all on table public.business_ai_requests from public, anon, authenticated;

grant select, insert, update on table public.business_knowledge_items to authenticated;
grant select, insert, update on table public.business_knowledge_relations to authenticated;
grant select, insert, update on table public.business_recommendations to authenticated;
grant select, insert, update on table public.business_decisions to authenticated;
grant select, insert, update on table public.business_measurements to authenticated;
grant select on table public.business_extraction_queue to authenticated;
grant select, insert, update on table public.business_entity_links to authenticated;
grant select on table public.business_ai_requests to authenticated;

-- Service-role access is explicit because the extraction Edge Function writes through service role.
grant all on table public.business_knowledge_items to service_role;
grant all on table public.business_knowledge_relations to service_role;
grant all on table public.business_recommendations to service_role;
grant all on table public.business_decisions to service_role;
grant all on table public.business_measurements to service_role;
grant all on table public.business_extraction_queue to service_role;
grant all on table public.business_entity_links to service_role;
grant all on table public.business_ai_requests to service_role;

-- User-facing RPCs. Remove PUBLIC/anon and then allow signed-in users only.
revoke all on function public.business_manager() from public, anon;
revoke all on function public.business_ai_enabled() from public, anon;
revoke all on function public.business_knowledge_review(uuid,text,numeric,text,timestamptz,timestamptz) from public, anon;
revoke all on function public.business_recommendation_to_task(uuid,uuid,uuid,timestamptz,text,text) from public, anon;
revoke all on function public.business_decision_save(text,text,text,text,uuid,uuid,text,date,uuid[]) from public, anon;
revoke all on function public.business_measurement_save(uuid,uuid,uuid,uuid,text,numeric,numeric,text,text,text,jsonb) from public, anon;
revoke all on function public.business_content_brief(text,text) from public, anon;
revoke all on function public.business_owner_snapshot(text) from public, anon;
revoke all on function public.business_copilot_context(text) from public, anon;
revoke all on function public.business_ads_scenario(numeric) from public, anon;
revoke all on function public.business_refresh_decay() from public, anon;
revoke all on function public.business_graph_snapshot(integer) from public, anon;
revoke all on function public.business_ai_allow(text) from public, anon;

grant execute on function public.business_manager() to authenticated, service_role;
grant execute on function public.business_ai_enabled() to authenticated, service_role;
grant execute on function public.business_knowledge_review(uuid,text,numeric,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.business_recommendation_to_task(uuid,uuid,uuid,timestamptz,text,text) to authenticated;
grant execute on function public.business_decision_save(text,text,text,text,uuid,uuid,text,date,uuid[]) to authenticated;
grant execute on function public.business_measurement_save(uuid,uuid,uuid,uuid,text,numeric,numeric,text,text,text,jsonb) to authenticated;
grant execute on function public.business_content_brief(text,text) to authenticated;
grant execute on function public.business_owner_snapshot(text) to authenticated;
grant execute on function public.business_copilot_context(text) to authenticated;
grant execute on function public.business_ads_scenario(numeric) to authenticated;
grant execute on function public.business_refresh_decay() to authenticated;
grant execute on function public.business_graph_snapshot(integer) to authenticated;
grant execute on function public.business_ai_allow(text) to authenticated;

-- Trigger helpers are never an API surface.
revoke all on function public.business_touch_updated_at() from public, anon, authenticated;
revoke all on function public.business_queue_completed_task() from public, anon, authenticated;
revoke all on function public.business_default_knowledge_decay() from public, anon, authenticated;
revoke all on function public.business_graph_from_knowledge() from public, anon, authenticated;
revoke all on function public.business_graph_from_recommendation() from public, anon, authenticated;
revoke all on function public.business_graph_from_decision() from public, anon, authenticated;
revoke all on function public.business_graph_from_measurement() from public, anon, authenticated;

comment on table public.business_knowledge_items is
  'Central auditable business memory. No anon grants; manager RLS applies to signed-in users.';
