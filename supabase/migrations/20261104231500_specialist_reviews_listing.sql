-- Fetch the latest manual review for each specialist; owner approval remains separate.
create or replace function public.digital_agent_recent_reviews()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare
 v_owner boolean;
 v_reviews jsonb;
begin
 if not public.business_manager() then raise exception 'غير مصرح' using errcode='42501'; end if;
 select exists (
   select 1 from public.admins a join public.administrative_assistant_config c
   on c.owner_admin_id=a.id where c.id=1 and a.user_id=auth.uid() and a.active=true
 ) into v_owner;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',q.id,'agent_code',q.agent_code,'status',q.status,
   'metrics',q.metrics,'findings',q.findings,
   'reviewed_at',q.reviewed_at,'decided_at',q.decided_at
 ) order by q.agent_code),'[]'::jsonb) into v_reviews
 from (
   select distinct on(agent_code) id,agent_code,status,metrics,findings,reviewed_at,decided_at
   from public.digital_agent_reviews
   where agent_code in ('hor','hotep','nefer','maat')
   order by agent_code,reviewed_at desc,id desc
 ) q;
 return jsonb_build_object('is_owner',v_owner,'reviews',v_reviews);
end;
$$;
revoke all on function public.digital_agent_recent_reviews() from public,anon,authenticated;
grant execute on function public.digital_agent_recent_reviews() to authenticated;