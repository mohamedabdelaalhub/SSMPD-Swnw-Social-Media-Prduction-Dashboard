-- Rollback for 20261028_contracting_access_hardening.
-- This restores the prior exposed state exactly for the affected relations.
-- Use only to recover from an application regression, then re-apply hardening promptly.

do $$
declare t text;
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
    execute format('drop policy if exists contracting_security_select on public.%I', t);
    execute format('drop policy if exists contracting_security_insert on public.%I', t);
    execute format('drop policy if exists contracting_security_update on public.%I', t);
    execute format('drop policy if exists contracting_security_delete on public.%I', t);
    execute format('alter table public.%I disable row level security', t);
    execute format('grant all privileges on table public.%I to anon, authenticated', t);
  end loop;
end $$;

grant execute on function public.contracting_partner_snapshot(uuid) to public, anon;
grant execute on function public.contracting_progressive_incentive(numeric, uuid, text) to public, anon;

-- Rollback for 20261028_contracting_partner_rpc_hardening.
grant execute on function public.contracting_partner_claim_access() to public, anon;
grant execute on function public.contracting_partner_staff_dashboard() to public, anon;
alter function public.contracting_partner_snapshot(uuid) reset search_path;
alter function public.contracting_progressive_incentive(numeric, uuid, text) reset search_path;
