-- Vault-backed independent scanner schedule. No plaintext secret in cron.job.
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='swnw_task_file_scan_secret_v1') then
   perform vault.create_secret(encode(extensions.gen_random_bytes(48),'hex'),
     'swnw_task_file_scan_secret_v1','Private automatic Swnw task file scanner');
 end if;
end $$;
create or replace function private.task_file_autoscan_fire()
returns bigint language plpgsql volatile security definer
set search_path=pg_catalog,net,vault,private as $$
declare token text;request_id bigint;
begin
 select decrypted_secret into token from vault.decrypted_secrets
 where name='swnw_task_file_scan_secret_v1' limit 1;
 if token is null then raise exception 'Scan secret unavailable';end if;
 select net.http_post(
   url:='https://uuijfbpgvtdxgaosqpxo.supabase.co/functions/v1/task-file-autoscan',
   headers:=jsonb_build_object('X-SW-Scan-Token',token,'Content-Type','application/json'),
   body:='{}'::jsonb,timeout_milliseconds:=95000
 ) into request_id;
 return request_id;
end $$;
revoke all on function private.task_file_autoscan_fire() from public,anon,authenticated;
select cron.schedule('swnw-task-files-autoscan-10m','*/10 * * * *',
  'select private.task_file_autoscan_fire();');
