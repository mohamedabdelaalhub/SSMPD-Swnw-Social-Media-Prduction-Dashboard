-- READ-ONLY scan (2026-11-25): public SECURITY DEFINER functions that anon can execute, with a rough «caller check» flag.
-- A function with no reference to auth.uid() / my_admin_id() / my_role() / is_super() / has_role() / a workspace access()
-- check / service role, and that writes (insert / update / delete), is the dangerous shape (like rpc_update_lead was).
select p.oid::regprocedure as fn,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       (p.prosrc ~* '(insert|update|delete)\s') as writes,
       (p.prosrc ~* '(auth\.uid\(\)|my_admin_id\(\)|my_role\(\)|is_super\(\)|has_role\(|access\(|effective_admin_id|current_setting\(''request\.jwt|service_role|auth\.role\(\))') as has_caller_check,
       p.provolatile as volatility
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
order by (p.prosrc ~* '(insert|update|delete)\s') and not (p.prosrc ~* '(auth\.uid\(\)|my_admin_id\(\)|my_role\(\)|is_super\(\)|has_role\(|access\(|effective_admin_id|current_setting\(''request\.jwt|service_role|auth\.role\(\))') desc, 1;
-- and how anon got them (default privileges that grant EXECUTE on new functions to anon / authenticated):
select pg_get_userbyid(d.defaclrole) as owner, n.nspname as schema, d.defaclobjtype as kind, d.defaclacl
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace order by 1, 2;
