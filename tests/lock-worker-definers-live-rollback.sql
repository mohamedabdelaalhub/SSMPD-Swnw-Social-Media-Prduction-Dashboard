-- Live rollback test for 20261125170000_lock_worker_definers.sql. ONE transaction ending in ROLLBACK, as postgres; paste the
-- migration body at the marked spot. Privilege checks for all 69 scanned functions + real calls that do nothing:
--   anon → clinic_booking_outbox: permission denied;  anon → patient check-in (public page) with a random token: its own error;
--   Mazen → task_set_order('{}'): its own validation error (dashboard RPC still callable);  Mazen → clinic_booking_outbox: denied.
begin;
-- transaction guard: SAVEPOINT fails outside an explicit begin … rollback block (also when the file is sent as one query
-- without «begin;»), and then nothing in this file runs and nothing is kept
savepoint lw_live_guard;
-- >>> apply supabase/migrations/20261125170000_lock_worker_definers.sql here (without its own begin / commit) <<<
create temp table lw_live(n serial, step text, expected text, actual text, ok boolean);
grant all on lw_live to anon, authenticated;
grant usage on sequence lw_live_n_seq to anon, authenticated;
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; f text; bad text; err text;
  D text[] := array['public.clinic_booking_outbox(text,jsonb)','public.hr_claim_account_job(uuid,uuid)','public.content_archive_commit(uuid)','public.content_archive_mark_cleared(uuid,text[])','public.claim_due_meta_publish_jobs(integer)','public.claim_due_tiktok_publish_jobs(integer)','public.reap_stuck_meta_publish_jobs()','public.meta_requeue_retryable_jobs()','public.website_claim()','public.website_finish(uuid,bigint,uuid,text,integer,text,text)','public.operations_ingest_snapshot(jsonb,timestamp with time zone,text)','public.inventory_generate_due_counts()','public.inventory_refresh_alerts()','public.inventory_fulfill_issue_legacy_supply(uuid,jsonb,text)','public.patient360_sync_legacy_whatsapp()','public.refresh_content_learnings()','public.weekly_report_fallback()','public.weekly_proposals_to_tasks(uuid)'];
  AB text[] := array['public.ai_clip_auto_enqueue()','public.audit_nutrition_daily_completion()','public.business_graph_from_decision()','public.business_graph_from_knowledge()','public.business_graph_from_measurement()','public.business_graph_from_recommendation()','public.business_queue_completed_task()','public.capture_administrative_assistant_mention()','public.log_patient_account_access_status_change()','public.log_patient_identity_verification_status_change()','public.log_patient_identity_verification_submitted()','public.patient360_escalate_case()','public.task_file_queue_from_comment()','public.task_file_queue_from_result()','public.task_updates_sia_claude_request()','public.business_refresh_decay()','public.clinic_finance_test_delete(text,text,text,text)','public.clinic_finance_test_flag(text,text,text,text)','public.clinic_finance_test_unflag(text,text,text)','public.digital_chat_create(text[],text)','public.digital_chat_retry(uuid)','public.digital_chat_send(uuid,text,text,boolean,text,timestamp with time zone)','public.digital_chat_set_instruction(uuid,boolean)','public.digital_chat_set_schedule(uuid,boolean)','public.inventory_create_request(text,text,text,jsonb)','public.inventory_resolve_alert(uuid)','public.inventory_set_track_lots(uuid,boolean)','public.operations_save_advice(uuid,jsonb)','public.task_delete(uuid)','public.task_delete_project(uuid)','public.task_set_order(uuid[])','public.task_update_project(uuid,text,text,uuid,jsonb)','public.task_generate_due_recurrences()','public.task_notify_due_soon()','public.weekly_midweek_nudge()','public.staff_kpi_scan_alerts()'];
  C text[] := array['public.clinic_reception_checkin_public(uuid,double precision,double precision,double precision)','public.clinic_reception_checkin_static(uuid,text,double precision,double precision,double precision)','public.clinic_reception_display_qr_rotate(uuid)','public.clinic_reception_queue_display(uuid)','public.contracting_partner_submit_referral(text,text,text,text,text,timestamp with time zone,text)'];
  H text[] := array['public.clinic_reception_pbx_event(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,text,jsonb)','public.clinic_reception_agent_event(uuid,text,jsonb,text)','public.clinic_reception_agent_set_communications(boolean)','public.claude_cap_use(text,jsonb)','public.claude_propose_ad_plan(text,text,text,numeric,numeric,date,date,text,text,text,uuid)','public.staff_summary_save(uuid,date,text,text,text,text)','public.claim_server_meta_publish_jobs(integer)','public.storage_offload_mark_deleted(text,text[])','public.rpc_update_lead(uuid,uuid,text,text,boolean,date,text,boolean,timestamp with time zone,boolean)','public.rpc_update_lead_details(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text)'];
begin
  select string_agg(x, ', ') into bad from unnest(D) x where has_function_privilege('anon', x, 'execute') or has_function_privilege('authenticated', x, 'execute') or not has_function_privilege('service_role', x, 'execute');
  insert into lw_live(step, expected, actual, ok) values ('D (' || cardinality(D) || ') server/worker/cron', 'anon ✗ · authenticated ✗ · service_role ✓', coalesce(bad, 'all ok'), bad is null);
  select string_agg(x, ', ') into bad from unnest(AB) x where has_function_privilege('anon', x, 'execute') or not has_function_privilege('authenticated', x, 'execute');
  insert into lw_live(step, expected, actual, ok) values ('A+B (' || cardinality(AB) || ') triggers + guarded dashboard RPCs', 'anon ✗ · authenticated ✓', coalesce(bad, 'all ok'), bad is null);
  select string_agg(x, ', ') into bad from unnest(C) x where not has_function_privilege('anon', x, 'execute');
  insert into lw_live(step, expected, actual, ok) values ('C (' || cardinality(C) || ') public pages', 'anon ✓', coalesce(bad, 'all ok'), bad is null);
  select string_agg(x || '=' || has_function_privilege('anon', x, 'execute'), ', ') into bad from unnest(H) x;
  insert into lw_live(step, expected, actual, ok) values ('held (' || cardinality(H) || ')', 'unchanged (info)', bad, true);
  -- real calls
  begin execute 'set local role anon'; perform public.clinic_booking_outbox('lease', '{}'::jsonb); execute 'reset role'; err := 'EXECUTED';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into lw_live(step, expected, actual, ok) values ('anon → clinic_booking_outbox(lease)', 'permission denied', err, err ilike '%permission denied%');
  begin execute 'set local role anon'; perform public.clinic_reception_checkin_public(gen_random_uuid(), 30.0, 31.0, 10.0); execute 'reset role'; err := 'returned';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into lw_live(step, expected, actual, ok) values ('anon → patient check-in (public page), random token', 'its own error, not permission denied', err, err not ilike '%permission denied%');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  begin execute 'set local role authenticated'; perform public.task_set_order('{}'::uuid[]); execute 'reset role'; err := 'returned';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into lw_live(step, expected, actual, ok) values ('Mazen → task_set_order({}) (dashboard RPC)', 'its own validation error', err, err not ilike '%permission denied%');
  begin execute 'set local role authenticated'; perform public.clinic_booking_outbox('lease', '{}'::jsonb); execute 'reset role'; err := 'EXECUTED';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into lw_live(step, expected, actual, ok) values ('Mazen → clinic_booking_outbox(lease)', 'permission denied', err, err ilike '%permission denied%');
end $$;
select step, expected, actual, ok from lw_live order by n;
rollback;
