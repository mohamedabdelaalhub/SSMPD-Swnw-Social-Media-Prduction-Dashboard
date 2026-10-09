-- Website publishing reads its endpoint + integration key from Supabase Vault (service role only),
-- so the owner never has to paste the key into Edge Function secrets. Env secrets still win if set.
create or replace function public.website_worker_config() returns jsonb
language sql stable security definer set search_path=public,vault as $$
 select jsonb_build_object(
  'secret',(select decrypted_secret from vault.decrypted_secrets where name='website_publish_worker_secret' limit 1),
  'endpoint',(select decrypted_secret from vault.decrypted_secrets where name='website_content_endpoint' limit 1));
$$;
revoke all on function public.website_worker_config() from public,anon,authenticated;
grant execute on function public.website_worker_config() to service_role;
