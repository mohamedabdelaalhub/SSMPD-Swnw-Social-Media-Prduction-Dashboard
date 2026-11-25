-- 20261125160000 SECURITY: public.rpc_update_lead and public.rpc_update_lead_details are SECURITY DEFINER with NO caller check
-- (they take the actor as a parameter). On live both were executable by anon (anyone with the public key, no login) and by
-- authenticated — i.e. anyone could change any lead's status / name / phone / booking and write the audit rows under any
-- admin id. Their only callers are the edge functions leads-update-status, leads-update-details and lead-invoice-upload, which
-- use the service role after their own role / scope checks; no browser or SQL code calls them. So: service_role only.
-- Rollback: supabase/rollbacks/20261125160000_revoke_lead_update_rpcs.rollback.sql
do $$ begin
  if to_regprocedure('public.rpc_update_lead(uuid,uuid,text,text,boolean,date,text,boolean,timestamptz,boolean)') is null then
    raise exception 'rpc_update_lead signature changed — review before applying'; end if;
  if to_regprocedure('public.rpc_update_lead_details(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text)') is null then
    raise exception 'rpc_update_lead_details signature changed — review before applying'; end if;
end $$;
revoke all on function public.rpc_update_lead(uuid,uuid,text,text,boolean,date,text,boolean,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.rpc_update_lead(uuid,uuid,text,text,boolean,date,text,boolean,timestamptz,boolean) to service_role;
revoke all on function public.rpc_update_lead_details(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.rpc_update_lead_details(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text) to service_role;
