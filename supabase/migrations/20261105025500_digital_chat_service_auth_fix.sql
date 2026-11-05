-- In SECURITY DEFINER, current_user is the function owner. Inspect the authenticated caller JWT role instead.
create or replace function public.digital_chat_claim_due(p_limit integer default 3)
returns setof public.digital_chat_schedules language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
  raise exception 'Service only' using errcode='42501';
 end if;
 return query with due as (
  select id from public.digital_chat_schedules where enabled and status='advisory_only' and next_run_at<=now()
  order by next_run_at for update skip locked limit greatest(1,least(p_limit,5))
 )
 update public.digital_chat_schedules s set last_run_at=now(),run_count=run_count+1,
 next_run_at=case when s.frequency='daily' then s.next_run_at+interval '1 day' else s.next_run_at+interval '7 days' end,
 updated_at=now() from due where s.id=due.id returning s.*;
end $$;
revoke all on function public.digital_chat_claim_due(integer) from public,anon,authenticated;
grant execute on function public.digital_chat_claim_due(integer) to service_role;

create or replace function public.digital_chat_cron_token_valid(p_token text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,vault as $$
declare stored text;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then return false;end if;
 select decrypted_secret into stored from vault.decrypted_secrets where name='swnw_digital_chat_cron_v1' limit 1;
 return stored is not null and length(stored)>32 and p_token=stored;
end $$;
revoke all on function public.digital_chat_cron_token_valid(text) from public,anon,authenticated;
grant execute on function public.digital_chat_cron_token_valid(text) to service_role;
