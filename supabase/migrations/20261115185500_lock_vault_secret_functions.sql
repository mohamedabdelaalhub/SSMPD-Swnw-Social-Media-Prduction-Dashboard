-- Lock the two SECURITY DEFINER functions that return decrypted vault secrets (owner: «موافق اقفل الدالتين», 2026-11-15).
-- After the self-host move both were anon-executable (ACL drift; 20261009_website_key_vault intended service_role only).
-- Callers (website-publish-process, operations-ingest) use the service role. Applied live 2026-11-15 16:10 UTC.
begin;
revoke all on function public.website_worker_config() from public, anon, authenticated;
revoke all on function public.operations_server_secrets() from public, anon, authenticated;
grant execute on function public.website_worker_config() to service_role, postgres;
grant execute on function public.operations_server_secrets() to service_role, postgres;
do $c$ begin
  if has_function_privilege('anon','public.website_worker_config()','execute') or has_function_privilege('anon','public.operations_server_secrets()','execute')
     or has_function_privilege('authenticated','public.website_worker_config()','execute') or has_function_privilege('authenticated','public.operations_server_secrets()','execute')
  then raise exception 'lock_vault_secret_functions: self-check failed'; end if;
end $c$;
commit;
