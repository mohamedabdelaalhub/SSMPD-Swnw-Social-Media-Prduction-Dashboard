-- Security hardening for contracting tables flagged by Supabase Security Advisor.
-- Scope: public contracting tables only. No data or admins tables are changed.
-- Rollback instructions are in supabase/rollbacks/20261028_contracting_security.sql.

do $$
declare
  t text;
  v_read text := '(public.is_controlled_finance() and public.finance_module_allowed(''contracting_entities'',''view'')) or (not public.is_controlled_finance() and (public.has_role(''contract_manager'') or public.has_role(''general_manager'') or public.has_role(''super_admin'')))';
  v_create text := '(public.is_controlled_finance() and public.finance_module_allowed(''contracting_entities'',''create'')) or (not public.is_controlled_finance() and (public.has_role(''contract_manager'') or public.has_role(''general_manager'') or public.has_role(''super_admin'')))';
  v_update text := '(public.is_controlled_finance() and public.finance_module_allowed(''contracting_entities'',''update'')) or (not public.is_controlled_finance() and (public.has_role(''contract_manager'') or public.has_role(''general_manager'') or public.has_role(''super_admin'')))';
  v_delete text := '(public.is_controlled_finance() and public.finance_module_allowed(''contracting_entities'',''delete'')) or (not public.is_controlled_finance() and (public.has_role(''general_manager'') or public.has_role(''super_admin'')))';
begin
  foreach t in array array[
    'contracting_partnership_settings',
    'contracting_agreement_presets',
    'contracting_incentive_tiers',
    'contracting_agreements',
    'contracting_agreement_versions',
    'contracting_referrals',
    'contracting_partner_transactions',
    'contracting_settlements',
    'contracting_activity_log',
    'contracting_partner_users'
  ] loop
    execute format('revoke all privileges on table public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);

    execute format('create policy contracting_security_select on public.%I for select to authenticated using (%s)', t, v_read);
    execute format('create policy contracting_security_insert on public.%I for insert to authenticated with check (%s)', t, v_create);
    execute format('create policy contracting_security_update on public.%I for update to authenticated using (%s) with check (%s)', t, v_update, v_update);
    execute format('create policy contracting_security_delete on public.%I for delete to authenticated using (%s)', t, v_delete);
  end loop;
end $$;

-- This invoker RPC previously depended on unrestricted table reads and accepted any entity UUID.
-- Keep it available to authenticated callers, where RLS limits results to authorized managers.
revoke execute on function public.contracting_partner_snapshot(uuid) from public, anon;
grant execute on function public.contracting_partner_snapshot(uuid) to authenticated;

-- This calculator reads incentive tiers. Public execution is unnecessary; authenticated callers
-- remain subject to table privileges and RLS, while privileged dashboard RPCs can call it internally.
revoke execute on function public.contracting_progressive_incentive(numeric, uuid, text) from public, anon;
grant execute on function public.contracting_progressive_incentive(numeric, uuid, text) to authenticated;
