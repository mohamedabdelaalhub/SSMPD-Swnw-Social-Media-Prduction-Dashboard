-- Rollback for 20261125160000_revoke_lead_update_rpcs.sql — restores the previous (unsafe) grants: anon + authenticated
-- could execute both RPCs. Only use this if an unknown caller broke; prefer fixing that caller to use the edge functions.
grant execute on function public.rpc_update_lead(uuid,uuid,text,text,boolean,date,text,boolean,timestamptz,boolean) to anon, authenticated;
grant execute on function public.rpc_update_lead_details(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text) to anon, authenticated;
