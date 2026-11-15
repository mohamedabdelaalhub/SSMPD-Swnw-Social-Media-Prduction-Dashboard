-- Patient Portal — Phase 1 security hardening (anon lockdown).
-- Scope: privileges only. No table, policy, function body or data is changed.
--
-- Why: live check 2026-11-15 showed
--   * anon still had EXECUTE on the 4 portal SECURITY DEFINER functions
--     (20261027214044 revoked from anon, but EXECUTE via PUBLIC remained);
--   * anon held full default table grants on every portal table — RLS was the only barrier;
--   * GET /rest/v1/patient_visits as anon returned HTTP 500 instead of a clean denial.
-- After this migration anon gets a clean permission error (401) on all of them.
--
-- Who still has access (unchanged): authenticated (RLS still decides rows), service_role
-- (edge functions). Portal and staff screens call these as authenticated users only.
-- Drift note: replaces NO function bodies. It only edits grants on objects that exist live.

begin;

do $m$
declare
  fn text;
  t  text;
begin
  -- 1) Functions: remove PUBLIC + anon EXECUTE; keep authenticated + service_role.
  foreach fn in array array[
    'public.approve_patient_identity_verification(uuid)',
    'public.reject_patient_identity_verification(uuid, text)',
    'public.revoke_patient_account_access(uuid, text, text)',
    'public.patient_portal_service_reports()'
  ] loop
    if to_regprocedure(fn) is null then
      raise exception 'portal hardening: function % missing on this database', fn;
    end if;
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;

  -- 2) Tables: anon gets no privileges at all.
  foreach t in array array[
    'patient_accounts','patient_account_access','patient_identity_verifications',
    'patient_verification_documents','patient_system_links','patient_portal_visibility',
    'patient_portal_audit_log','patient_activation_codes','patient_nutrition_meal_completions',
    'patient_visits'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception 'portal hardening: table % missing on this database', t;
    end if;
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end
$m$;

-- 3) Self-check: fail (and roll back) if anon can still reach anything above.
do $chk$
declare bad text;
begin
  select string_agg(x, ', ') into bad from (
    select p.oid::regprocedure::text as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('approve_patient_identity_verification','reject_patient_identity_verification',
                        'revoke_patient_account_access','patient_portal_service_reports')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
    union all
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('patient_accounts','patient_account_access','patient_identity_verifications',
        'patient_verification_documents','patient_system_links','patient_portal_visibility',
        'patient_portal_audit_log','patient_activation_codes','patient_nutrition_meal_completions',
        'patient_visits')
      and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))
  ) s;
  if bad is not null then
    raise exception 'portal hardening: anon still has access to %', bad;
  end if;
end
$chk$;

commit;
