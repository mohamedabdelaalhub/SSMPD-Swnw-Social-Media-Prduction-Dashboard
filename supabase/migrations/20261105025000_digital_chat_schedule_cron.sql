-- Private Cron authentication for scheduled digital conversations. Keeps the existing Sia and task-scan jobs untouched.
do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='swnw_digital_chat_cron_v1') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(48),'hex'),'swnw_digital_chat_cron_v1',
   'Owner-approved recurring advisory messages for the digital team');
 end if;
end $$;

create or replace function public.digital_chat_cron_token_valid(p_token text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,vault as $$
declare stored text;
begin
 if current_user <> 'service_role' then return false;end if;
 select decrypted_secret into stored from vault.decrypted_secrets where name='swnw_digital_chat_cron_v1' limit 1;
 return stored is not null and length(stored)>32 and p_token=stored;
end $$;
revoke all on function public.digital_chat_cron_token_valid(text) from public,anon,authenticated;
grant execute on function public.digital_chat_cron_token_valid(text) to service_role;

create or replace function private.digital_chat_cron_fire()
returns bigint language plpgsql volatile security definer set search_path=pg_catalog,net,vault as $$
declare token text;id bigint;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='swnw_digital_chat_cron_v1' limit 1;
 if token is null then raise exception 'Chat cron secret missing';end if;
 select net.http_post(url:='https://uuijfbpgvtdxgaosqpxo.supabase.co/functions/v1/digital-chat-reply',
  headers:=jsonb_build_object('Content-Type','application/json','X-SW-Chat-Token',token),
  body:='{}'::jsonb,timeout_milliseconds:=90000) into id;
 return id;
end $$;
revoke all on function private.digital_chat_cron_fire() from public,anon,authenticated;
select cron.schedule('swnw-digital-chat-advisory-15m','*/15 * * * *','select private.digital_chat_cron_fire();');
