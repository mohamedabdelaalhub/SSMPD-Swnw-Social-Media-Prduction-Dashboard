alter table public.task_file_scan_jobs add column if not exists analysis jsonb not null default '{}'::jsonb;

-- Service-only queued job claiming. No privileged RPC exposed to client logins.
create or replace function public.task_file_scan_claim(p_count integer default 3)
returns setof public.task_file_scan_jobs language plpgsql volatile security definer
set search_path=pg_catalog,public as $$
begin
 if auth.role() is distinct from 'service_role' and current_user <> 'service_role' then
  raise exception 'Service only' using errcode='42501';
 end if;
 return query
 with available as (
  select id from public.task_file_scan_jobs
  where (state='pending' or (state='retry' and (next_retry_at is null or next_retry_at<=now())))
    and attempt_count<4
  order by created_at for update skip locked limit greatest(1,least(coalesce(p_count,3),4))
 )
 update public.task_file_scan_jobs j set state='processing',claimed_at=now(),updated_at=now(),
   attempt_count=attempt_count+1
 from available a where j.id=a.id returning j.*;
end $$;
revoke all on function public.task_file_scan_claim(integer) from public,anon,authenticated;
grant execute on function public.task_file_scan_claim(integer) to service_role;

-- The token lives only in Supabase Vault; callers cannot read it.
create or replace function public.task_file_scan_token_valid(p_token text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,vault as $$
declare stored text;
begin
 if auth.role() is distinct from 'service_role' and current_user <> 'service_role' then return false;end if;
 select decrypted_secret into stored from vault.decrypted_secrets where name='swnw_task_file_scan_secret_v1' limit 1;
 return stored is not null and length(stored)>32 and p_token=stored;
end $$;
revoke all on function public.task_file_scan_token_valid(text) from public,anon,authenticated;
grant execute on function public.task_file_scan_token_valid(text) to service_role;

-- Owner can inspect the latest independent scan results without modifying any task.
create or replace function public.task_file_scan_overview(p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare output jsonb;
begin
 if not exists(select 1 from public.administrative_assistant_config c join public.admins a on a.id=c.owner_admin_id
   where c.id=1 and a.active and a.user_id=auth.uid()) then
   raise exception 'Owner only' using errcode='42501';
 end if;
 select jsonb_build_object('counts',(select jsonb_object_agg(state,n)
   from (select state,count(*) n from public.task_file_scan_jobs group by state) x),
   'recent',coalesce((select jsonb_agg(jsonb_build_object(
     'id',id,'task_id',task_id,'file_name',file_name,'state',state,
     'summary',summary,'analysis',analysis,'error_code',error_code,
     'created_at',created_at,'scanned_at',scanned_at))
     from (select id,task_id,file_name,state,summary,analysis,error_code,created_at,scanned_at
           from public.task_file_scan_jobs order by created_at desc limit greatest(1,least(coalesce(p_limit,40),75))) q),'[]'::jsonb))
  into output;
 return output;
end $$;
revoke all on function public.task_file_scan_overview(integer) from public,anon,authenticated;
grant execute on function public.task_file_scan_overview(integer) to authenticated;
