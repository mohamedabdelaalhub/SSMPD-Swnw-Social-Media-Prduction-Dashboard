-- Rollback: restore anon EXECUTE to the same internal SECURITY DEFINER overloads.
-- Use only as an emergency rollback; this reopens their RPC endpoints.
DO $rollback$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype::regtype::text <> 'trigger'
      AND p.proname <> ALL (ARRAY[
        'contracting_partner_public_profile',
        'contracting_partner_submit_referral',
        'list_active_sono_doctors',
        'is_active_sono_doctor',
        'upcoming_health_occasions'
      ])
      AND p.proname = ANY (ARRAY[
        'ads_plan_violations','can_access_leads','can_delete_contracting_entity',
        'can_delete_leads','can_delete_nutrition_visits','can_manage_all_content',
        'can_manage_contracting_entities','can_manage_patient_identity_verification',
        'can_write_private_design','can_write_reel_cover','claude_autoschedule_approved',
        'claude_autoschedule_ready','finance_module_allowed','get_design_monthly_budget',
        'has_archive_access','has_archive_view_only','has_role','has_role_for',
        'inventory_approve_count','inventory_average_cost','inventory_can_manage',
        'inventory_can_view','inventory_generate_due_counts','inventory_is_manager',
        'inventory_maintenance','inventory_on_hand','inventory_open_count',
        'inventory_refresh_alerts','inventory_resolve_alert','inventory_save_count_schedule',
        'inventory_submit_count','is_assigned_doctor_for_patient','is_controlled_finance',
        'is_super','list_designers_all','my_admin_id','my_role','my_roles',
        'refresh_content_learnings','refresh_overdue_followups','staff_kpi_scan_alerts',
        'staff_summary_fallback','task_can_access','task_can_access_project',
        'task_can_manage_project','task_generate_due_recurrences','task_list_projects',
        'task_set_order','weekly_midweek_nudge','weekly_proposals_to_tasks'
      ])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.signature);
  END LOOP;
END
$rollback$;
