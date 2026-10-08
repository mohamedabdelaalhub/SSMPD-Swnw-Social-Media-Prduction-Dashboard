-- Run only after deploying website-publish-process and creating both Vault secrets:
-- website_publish_worker_url = https://<project>.supabase.co/functions/v1/website-publish-process
-- website_publish_worker_secret = same value as WEBSITE_WEBHOOK_SECRET (owner enters it privately).
-- Do not paste secret values into project files.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='website_publish_worker_url')
 or not exists(select 1 from vault.decrypted_secrets where name='website_publish_worker_secret') then
 raise exception 'Create the two named Vault secrets first';end if;
end$$;
select cron.unschedule(jobid) from cron.job where jobname='website-publish-every-minute';
select cron.schedule('website-publish-every-minute','* * * * *',$job$
 select net.http_post(
 url:=(select decrypted_secret from vault.decrypted_secrets where name='website_publish_worker_url' limit 1),
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='website_publish_worker_secret' limit 1)),
 body:='{}'::jsonb,timeout_milliseconds:=150000
 );
$job$);
