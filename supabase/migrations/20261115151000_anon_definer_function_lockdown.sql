-- Phase 1b — lock anon out of SECURITY DEFINER functions that touch patient_visits.
-- Grants only; no function bodies replaced. Signatures confirmed against live on 2026-11-15.
--
-- EXPOSED on live (anon got 200 / could write):
--   kpi_hub_aggregates(integer)      no guard; returned business aggregates to the public key.
--                                    Only caller is the server-side hub builder (runs as postgres).
--                                    -> revoke PUBLIC, anon, authenticated; keep service_role.
--   refresh_overdue_followups()      no guard; a write. Dashboard (db.js) calls it logged-in.
--                                    -> revoke PUBLIC, anon; keep authenticated, service_role.
-- Defence-in-depth (already guarded internally, no anon caller exists):
--   revoke PUBLIC, anon; keep authenticated, service_role.
-- Deliberately untouched: clinic_reception_checkin_public(...) — token-gated public check-in.

begin;

do $m$
declare
  fn text;
begin
  foreach fn in array array[
    'public.kpi_hub_aggregates(integer)'
  ] loop
    if to_regprocedure(fn) is null then raise exception 'lockdown: function % missing', fn; end if;
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role, postgres', fn);  -- postgres: server-side KPI hub builder
  end loop;

  foreach fn in array array[
    'public.refresh_overdue_followups()',
    'public.insurance_billable_visits(text)',
    'public.entity_billing_visits(text, uuid)',
    'public.insurance_visit_billing_context(uuid)',
    'public.entity_billing_context(uuid)',
    'public.digital_chat_aggregate_snapshot(text)',
    'public.digital_agent_metric_detail(text, text)',
    'public.staff_comprehensive_performance(timestamptz, timestamptz, uuid)',
    'public.digital_agent_run_review(text)',
    'public.delete_contracting_entity(uuid)',
    'public.insurance_bill_visit(uuid, uuid, text, text, text, uuid, uuid)',
    'public.entity_service_bill(jsonb, uuid)'
  ] loop
    if to_regprocedure(fn) is null then raise exception 'lockdown: function % missing', fn; end if;
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end
$m$;

do $chk$
declare bad text;
begin
  select string_agg(f, ', ') into bad from unnest(array[
    'public.kpi_hub_aggregates(integer)','public.refresh_overdue_followups()',
    'public.insurance_billable_visits(text)','public.entity_billing_visits(text, uuid)',
    'public.insurance_visit_billing_context(uuid)','public.entity_billing_context(uuid)',
    'public.digital_chat_aggregate_snapshot(text)','public.digital_agent_metric_detail(text, text)',
    'public.staff_comprehensive_performance(timestamptz, timestamptz, uuid)',
    'public.digital_agent_run_review(text)','public.delete_contracting_entity(uuid)',
    'public.insurance_bill_visit(uuid, uuid, text, text, text, uuid, uuid)',
    'public.entity_service_bill(jsonb, uuid)']) f
  where has_function_privilege('anon', f, 'EXECUTE');
  if bad is not null then raise exception 'lockdown: anon can still execute %', bad; end if;
  if has_function_privilege('authenticated', 'public.kpi_hub_aggregates(integer)', 'EXECUTE') then
    raise exception 'lockdown: authenticated can still execute kpi_hub_aggregates';
  end if;
end
$chk$;

commit;
