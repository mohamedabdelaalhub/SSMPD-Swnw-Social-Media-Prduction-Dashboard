-- 20261125190000 SECURITY (3rd batch): the functions held back from 20261125170000 / 20261125180000, now that their callers are
-- confirmed (main chat 5, 2026-11-25) — none of them uses anon or a logged-in user:
--   claim_server_meta_publish_jobs   swnw-infra meta-publisher server runner / scheduler → SUPABASE_SERVICE_ROLE_KEY
--   storage_offload_*                storage-offload.py → swnw-sql (direct SQL as postgres)
--   claim_next_video_job (both)      video-worker/worker.py → service role key
--   claude_cap_use, claude_propose_ad_plan, staff_summary_save, staff_kpi_month_data, staff_summary_fallback
--                                    the Claude mailbox / gateway → swnw-sql (postgres); 202610200001_staff_kpi.sql already says
--                                    «postgres/service فقط»; docs/claude-staff-summary.md
--   staff_kpis_admin                 impersonates the first super admin and returns EVERY employee's KPIs — any logged-in user
--                                    could read them; my_staff_kpis (SECURITY DEFINER, filtered to the caller) is unaffected
-- → revoke public / anon / authenticated, grant service_role (postgres is the owner).
--   clinic_reception_agent_context / _agent_event / _pbx_event   the WhatsApp agent → edge function clinic-reception-agent
--                                    (X-WhatsApp-Alert-Secret + allow-list) → /rest/v1/rpc with the service role key; the agent holds
--                                    no Supabase key (confirmed on both sides). agent_context returned a patient's context by phone
--                                    to anyone with the public key.
--   clinic_reception_agent_set_communications, agent_match_patients_by_phone   no caller at all (agent, dashboard, edge)
-- Rollback: supabase/rollbacks/20261125190000_lock_held_definers.rollback.sql
do $$ declare f text; begin
  foreach f in array array[
    'public.claim_server_meta_publish_jobs(integer)',
    'public.storage_offload_mark_deleted(text,text[])',
    'public.storage_offload_candidates(integer)',
    'public.storage_offload_ready_for_delete(integer)',
    'public.claim_next_video_job(text)',
    'public.claim_next_video_job(text,integer)',
    'public.claude_cap_use(text,jsonb)',
    'public.claude_propose_ad_plan(text,text,text,numeric,numeric,date,date,text,text,text,uuid)',
    'public.staff_summary_save(uuid,date,text,text,text,text)',
    'public.staff_kpis_admin(timestamp with time zone,timestamp with time zone)',
    'public.staff_kpi_month_data(date)',
    'public.staff_summary_fallback(date)',
    'public.clinic_reception_agent_context(text)',
    'public.clinic_reception_agent_event(uuid,text,jsonb,text)',
    'public.clinic_reception_pbx_event(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,text,jsonb)',
    'public.clinic_reception_agent_set_communications(boolean)',
    'public.agent_match_patients_by_phone(text)'] loop
    if to_regprocedure(f) is null then raise exception 'signature changed — review before applying: %', f; end if;
  end loop;
  foreach f in array array[
    'public.claim_server_meta_publish_jobs(integer)',
    'public.storage_offload_mark_deleted(text,text[])',
    'public.storage_offload_candidates(integer)',
    'public.storage_offload_ready_for_delete(integer)',
    'public.claim_next_video_job(text)',
    'public.claim_next_video_job(text,integer)',
    'public.claude_cap_use(text,jsonb)',
    'public.claude_propose_ad_plan(text,text,text,numeric,numeric,date,date,text,text,text,uuid)',
    'public.staff_summary_save(uuid,date,text,text,text,text)',
    'public.staff_kpis_admin(timestamp with time zone,timestamp with time zone)',
    'public.staff_kpi_month_data(date)',
    'public.staff_summary_fallback(date)',
    'public.clinic_reception_agent_context(text)',
    'public.clinic_reception_agent_event(uuid,text,jsonb,text)',
    'public.clinic_reception_pbx_event(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,text,jsonb)',
    'public.clinic_reception_agent_set_communications(boolean)',
    'public.agent_match_patients_by_phone(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
