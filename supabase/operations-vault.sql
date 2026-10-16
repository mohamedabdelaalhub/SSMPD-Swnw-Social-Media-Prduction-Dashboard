-- Only the existing Edge Function service client can read these server secrets.
-- Both projects retain their own encrypted Vault entries. No client grants.
create or replace function public.operations_server_secrets()
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.jsonb_build_object(
  'bridge',(select decrypted_secret from vault.decrypted_secrets where name='operations_bridge_secret' limit 1),
  'cron',(select decrypted_secret from vault.decrypted_secrets where name='operations_cron_secret' limit 1));
$$;
revoke all on function public.operations_server_secrets() from public,anon,authenticated;
grant execute on function public.operations_server_secrets() to service_role;
