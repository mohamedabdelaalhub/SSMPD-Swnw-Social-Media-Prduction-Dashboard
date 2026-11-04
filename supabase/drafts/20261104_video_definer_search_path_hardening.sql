-- DRAFT, NOT APPLIED (2026-11-04). Narrow remediation proposal for the PRE-EXISTING authenticated-executable SECURITY DEFINER video functions and the role helpers
-- they call. Only changes the function-level search_path setting (adds pg_temp LAST so temp objects can never shadow public ones); no body, grant or behaviour change.
-- All object references inside these bodies are already schema-qualified (tests/real-schema-definer-mutation.sh M7 proves temp-table shadowing has no effect today), so this is
-- defence in depth, not a fix for a demonstrated exploit.
-- Rollback (exact inverse): alter function <same signatures> set search_path = public;
alter function public.create_video_job(uuid) set search_path = public, pg_temp;
alter function public.delete_video_asset_record(uuid) set search_path = public, pg_temp;
alter function public.get_video_studio_capabilities() set search_path = public, pg_temp;
alter function public.register_video_asset(uuid, text, text, text, text, bigint) set search_path = public, pg_temp;
alter function public.save_video_storyboard(uuid, jsonb) set search_path = public, pg_temp;
alter function public.select_video_cover(uuid, uuid) set search_path = public, pg_temp;
alter function public.submit_ai_design(uuid) set search_path = public, pg_temp;
-- role helpers used by every function above (STABLE SQL definers)
alter function public.my_admin_id() set search_path = public, pg_temp;
alter function public.my_role() set search_path = public, pg_temp;
alter function public.has_role(text) set search_path = public, pg_temp;
alter function public.can_manage_all_content() set search_path = public, pg_temp;
