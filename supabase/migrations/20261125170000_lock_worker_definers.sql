-- 20261125170000 SECURITY: lock SECURITY DEFINER functions that anon (anyone with the public key, no login) could execute.
-- Cause: pg_default_acl on schema public grants EXECUTE on every new function to anon + authenticated; several functions that
-- had explicit revokes were re-created during the server move and picked the defaults up again (scan 2026-11-25:
-- relay/854-anon-definer-scan-2026-11-25.out — 69 anon-executable definer functions that write and have no obvious caller check).
-- Triage (main chat 5 + this PR):
--   D  server / worker / cron only  → revoke anon + authenticated, grant service_role (edge callers verified: service-role
--      client; cron jobs run as postgres)
--   A  trigger functions            → revoke anon (not callable directly anyway; hygiene)
--   B  guarded inside (owner / manager / task / inventory checks), called by the dashboard → revoke anon only
--   C  intentionally public, token-gated pages (patient check-in, check-in display, queue display, partner portal) → unchanged
--   HELD (callers' credentials not confirmed yet): pbx / agent events, Claude gateway RPCs, claim_server_meta_publish_jobs,
--      storage_offload_mark_deleted;  rpc_update_lead* are handled by 20261125160000.
-- NOT here: the default privileges (new functions still get EXECUTE through PUBLIC — a per-schema default cannot remove the
-- global PUBLIC grant; changing the global default touches every schema and is a separate decision).
-- Rollback: supabase/rollbacks/20261125170000_lock_worker_definers.rollback.sql
do $$ declare f text; begin
  foreach f in array array[
    'public.clinic_booking_outbox(text,jsonb)',
    'public.hr_claim_account_job(uuid,uuid)',
    'public.content_archive_commit(uuid)',
    'public.content_archive_mark_cleared(uuid,text[])',
    'public.claim_due_meta_publish_jobs(integer)',
    'public.claim_due_tiktok_publish_jobs(integer)',
    'public.reap_stuck_meta_publish_jobs()',
    'public.meta_requeue_retryable_jobs()',
    'public.website_claim()',
    'public.website_finish(uuid,bigint,uuid,text,integer,text,text)',
    'public.operations_ingest_snapshot(jsonb,timestamp with time zone,text)',
    'public.inventory_generate_due_counts()',
    'public.inventory_refresh_alerts()',
    'public.inventory_fulfill_issue_legacy_supply(uuid,jsonb,text)',
    'public.patient360_sync_legacy_whatsapp()',
    'public.refresh_content_learnings()',
    'public.weekly_report_fallback()',
    'public.weekly_proposals_to_tasks(uuid)'] || array[
    'public.ai_clip_auto_enqueue()',
    'public.audit_nutrition_daily_completion()',
    'public.business_graph_from_decision()',
    'public.business_graph_from_knowledge()',
    'public.business_graph_from_measurement()',
    'public.business_graph_from_recommendation()',
    'public.business_queue_completed_task()',
    'public.capture_administrative_assistant_mention()',
    'public.log_patient_account_access_status_change()',
    'public.log_patient_identity_verification_status_change()',
    'public.log_patient_identity_verification_submitted()',
    'public.patient360_escalate_case()',
    'public.task_file_queue_from_comment()',
    'public.task_file_queue_from_result()',
    'public.task_updates_sia_claude_request()'] || array[
    'public.business_refresh_decay()',
    'public.clinic_finance_test_delete(text,text,text,text)',
    'public.clinic_finance_test_flag(text,text,text,text)',
    'public.clinic_finance_test_unflag(text,text,text)',
    'public.digital_chat_create(text[],text)',
    'public.digital_chat_retry(uuid)',
    'public.digital_chat_send(uuid,text,text,boolean,text,timestamp with time zone)',
    'public.digital_chat_set_instruction(uuid,boolean)',
    'public.digital_chat_set_schedule(uuid,boolean)',
    'public.inventory_create_request(text,text,text,jsonb)',
    'public.inventory_resolve_alert(uuid)',
    'public.inventory_set_track_lots(uuid,boolean)',
    'public.operations_save_advice(uuid,jsonb)',
    'public.task_delete(uuid)',
    'public.task_delete_project(uuid)',
    'public.task_set_order(uuid[])',
    'public.task_update_project(uuid,text,text,uuid,jsonb)',
    'public.task_generate_due_recurrences()',
    'public.task_notify_due_soon()',
    'public.weekly_midweek_nudge()',
    'public.staff_kpi_scan_alerts()'] || array[
    'public.clinic_reception_checkin_public(uuid,double precision,double precision,double precision)',
    'public.clinic_reception_checkin_static(uuid,text,double precision,double precision,double precision)',
    'public.clinic_reception_display_qr_rotate(uuid)',
    'public.clinic_reception_queue_display(uuid)',
    'public.contracting_partner_submit_referral(text,text,text,text,text,timestamp with time zone,text)'] loop
    if to_regprocedure(f) is null then raise exception 'signature changed — review before applying: %', f; end if;
  end loop;
end $$;

-- D: service role only
do $$ declare f text; begin
  foreach f in array array[
    'public.clinic_booking_outbox(text,jsonb)',
    'public.hr_claim_account_job(uuid,uuid)',
    'public.content_archive_commit(uuid)',
    'public.content_archive_mark_cleared(uuid,text[])',
    'public.claim_due_meta_publish_jobs(integer)',
    'public.claim_due_tiktok_publish_jobs(integer)',
    'public.reap_stuck_meta_publish_jobs()',
    'public.meta_requeue_retryable_jobs()',
    'public.website_claim()',
    'public.website_finish(uuid,bigint,uuid,text,integer,text,text)',
    'public.operations_ingest_snapshot(jsonb,timestamp with time zone,text)',
    'public.inventory_generate_due_counts()',
    'public.inventory_refresh_alerts()',
    'public.inventory_fulfill_issue_legacy_supply(uuid,jsonb,text)',
    'public.patient360_sync_legacy_whatsapp()',
    'public.refresh_content_learnings()',
    'public.weekly_report_fallback()',
    'public.weekly_proposals_to_tasks(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- A (triggers) + B (guarded, dashboard): no anon
do $$ declare f text; begin
  foreach f in array array[
    'public.ai_clip_auto_enqueue()',
    'public.audit_nutrition_daily_completion()',
    'public.business_graph_from_decision()',
    'public.business_graph_from_knowledge()',
    'public.business_graph_from_measurement()',
    'public.business_graph_from_recommendation()',
    'public.business_queue_completed_task()',
    'public.capture_administrative_assistant_mention()',
    'public.log_patient_account_access_status_change()',
    'public.log_patient_identity_verification_status_change()',
    'public.log_patient_identity_verification_submitted()',
    'public.patient360_escalate_case()',
    'public.task_file_queue_from_comment()',
    'public.task_file_queue_from_result()',
    'public.task_updates_sia_claude_request()'] || array[
    'public.business_refresh_decay()',
    'public.clinic_finance_test_delete(text,text,text,text)',
    'public.clinic_finance_test_flag(text,text,text,text)',
    'public.clinic_finance_test_unflag(text,text,text)',
    'public.digital_chat_create(text[],text)',
    'public.digital_chat_retry(uuid)',
    'public.digital_chat_send(uuid,text,text,boolean,text,timestamp with time zone)',
    'public.digital_chat_set_instruction(uuid,boolean)',
    'public.digital_chat_set_schedule(uuid,boolean)',
    'public.inventory_create_request(text,text,text,jsonb)',
    'public.inventory_resolve_alert(uuid)',
    'public.inventory_set_track_lots(uuid,boolean)',
    'public.operations_save_advice(uuid,jsonb)',
    'public.task_delete(uuid)',
    'public.task_delete_project(uuid)',
    'public.task_set_order(uuid[])',
    'public.task_update_project(uuid,text,text,uuid,jsonb)',
    'public.task_generate_due_recurrences()',
    'public.task_notify_due_soon()',
    'public.weekly_midweek_nudge()',
    'public.staff_kpi_scan_alerts()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- C: public pages keep anon explicitly (so the default-privilege change below never affects them)
do $$ declare f text; begin
  foreach f in array array[
    'public.clinic_reception_checkin_public(uuid,double precision,double precision,double precision)',
    'public.clinic_reception_checkin_static(uuid,text,double precision,double precision,double precision)',
    'public.clinic_reception_display_qr_rotate(uuid)',
    'public.clinic_reception_queue_display(uuid)',
    'public.contracting_partner_submit_referral(text,text,text,text,text,timestamp with time zone,text)'] loop
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;
