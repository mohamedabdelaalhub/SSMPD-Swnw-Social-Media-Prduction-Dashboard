-- Management requested activation of the Business Intelligence AI boundary.
-- Existing safeguards remain in place: manager-only access, daily limits, prompt-injection handling,
-- extracted knowledge stays ai_extracted until human review, and raw reports never enter Content AI.

create or replace function public.business_ai_enabled()
returns boolean
language sql
stable
set search_path=''
as $$ select true; $$;

revoke all on function public.business_ai_enabled() from public, anon;
grant execute on function public.business_ai_enabled() to authenticated, service_role;

comment on function public.business_ai_enabled() is
'Explicit management activation for report extraction and Owner Copilot. External calls remain manager-gated and rate-limited by business_ai_allow().';
