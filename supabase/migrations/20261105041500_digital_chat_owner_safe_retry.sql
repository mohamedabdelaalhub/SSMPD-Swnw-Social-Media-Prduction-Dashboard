-- Retry a failed owner conversation without duplicating messages, standing instructions or schedules.
-- Advisory-only. This does not dispatch any instruction to Claude Creative, Hapi, patients or other live systems.
create or replace function public.digital_chat_retry(p_message uuid)
returns boolean
language plpgsql volatile security definer
set search_path=pg_catalog,public
as $$
declare v_owner uuid; v_count integer;
begin
 v_owner:=public.digital_chat_owner();
 if v_owner is null then raise exception 'Owner only' using errcode='42501';end if;
 update public.digital_chat_messages m set process_state='queued'
 where m.id=p_message and m.sender_type='owner' and (
  m.process_state='failed' or
  (m.process_state='processing' and m.created_at<now()-interval '15 minutes')
 )
 and exists(
  select 1 from public.digital_chat_threads t
  where t.id=m.thread_id and t.owner_admin_id=v_owner
 )
 and not exists(
  select 1 from public.digital_chat_messages response
  where response.reply_to_id=m.id
 );
 get diagnostics v_count=row_count;
 return v_count=1;
end $$;
revoke all on function public.digital_chat_retry(uuid) from public,anon,authenticated;
grant execute on function public.digital_chat_retry(uuid) to authenticated;
comment on function public.digital_chat_retry(uuid) is
 'Owner-only fail-closed retry. Requires failed or stale unreplied owner message. Preserves original instruction and schedule rows.';
