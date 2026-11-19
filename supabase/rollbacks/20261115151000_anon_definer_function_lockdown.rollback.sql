-- Rollback of 20261115151000_anon_definer_function_lockdown: restores default PUBLIC EXECUTE
-- (as observed live on 2026-11-15). Re-exposes kpi_hub_aggregates to the public key — avoid.
begin;
grant execute on function
  public.kpi_hub_aggregates(integer), public.refresh_overdue_followups(),
  public.insurance_billable_visits(text), public.entity_billing_visits(text, uuid),
  public.insurance_visit_billing_context(uuid), public.entity_billing_context(uuid),
  public.digital_chat_aggregate_snapshot(text), public.digital_agent_metric_detail(text, text),
  public.staff_comprehensive_performance(timestamptz, timestamptz, uuid),
  public.digital_agent_run_review(text), public.delete_contracting_entity(uuid),
  public.insurance_bill_visit(uuid, uuid, text, text, text, uuid, uuid),
  public.entity_service_bill(jsonb, uuid)
to public, anon, authenticated;
commit;
