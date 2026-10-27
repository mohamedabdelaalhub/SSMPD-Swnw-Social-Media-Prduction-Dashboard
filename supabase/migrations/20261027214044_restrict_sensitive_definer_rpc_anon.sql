-- Remove unauthenticated RPC access to staff, patient, finance, inventory,
-- publishing, task and content-management SECURITY DEFINER functions.
-- Keep authenticated EXECUTE for application roles; preserve public partner APIs.
DO $migration$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname = ANY (ARRAY[
        'approve_patient_identity_verification','claim_due_meta_publish_jobs',
        'content_learning_brief','content_learning_brief_core','content_learning_brief_staff',
        'content_performance','contracting_entities_overview','create_doctor_referral_lead',
        'create_video_job','delete_contracting_entity','delete_video_asset_record',
        'discard_content_idea','inventory_record_sale','inventory_set_opening_balance',
        'inventory_snapshot','list_admins_basic','list_contracts_for_patient_visit',
        'log_verification_document_access','mark_content_idea_used','meta_job_retry',
        'meta_publish_issues','meta_requeue_retryable_jobs','my_staff_kpis',
        'personal_home_rating_queue','register_video_asset','reject_patient_identity_verification',
        'reserve_design_scene','revoke_patient_account_access','route_content_design',
        'rpc_update_lead','save_content_idea','save_design_version','save_private_design_version',
        'search_patients_basic','select_video_cover','set_admin_module_permissions',
        'set_brand_logo','set_design_monthly_budget','staff_kpi_month_data','staff_kpis',
        'staff_kpis_admin','staff_summary_save','submit_ai_design','task_create',
        'task_create_project','task_create_recurring','task_delete','task_delete_project',
        'task_list_visible','task_people','task_review','task_set_status','task_update_details',
        'task_update_project'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.signature);
  END LOOP;
END
$migration$;
