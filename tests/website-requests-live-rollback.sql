-- Live test for 20261127010000_website_requests.sql: run AFTER the migration is applied; everything is rolled back at the end.
-- Run as postgres (ops gateway). Checks: ingest as service_role (idempotent, validation, whitelist), no direct table access for
-- anon / authenticated, reception list / mark through clinic_reception.access with a real reception user, a non-reception user is refused.
begin;
create temporary table wr_result(step text, ok boolean, detail text);
grant all on wr_result to public;
do $$
declare ws uuid; rec uuid; other uuid; r jsonb; rid uuid; n int;
begin
  if to_regclass('public.website_requests') is null then raise exception 'الملف لم يُطبَّق'; end if;
  select id into ws from clinic_reception.workspaces where mode = 'live' order by id limit 1;
  select user_id into rec from public.admins where active and role = 'reception' and user_id is not null order by id limit 1;
  select a.user_id into other from public.admins a where a.active and a.role in ('designer', 'page_manager', 'approver') and a.user_id is not null
     and not exists (select 1 from public.admin_extra_roles r where r.admin_id = a.id and r.role in ('reception', 'customer_service', 'general_manager', 'super_admin')) order by a.id limit 1;
  insert into wr_result values ('inputs', ws is not null and rec is not null, format('workspace=%s reception_user=%s other_user=%s', ws is not null, rec is not null, other is not null));
  if ws is null or rec is null then return; end if;

  -- 1) ingest as service_role
  set local role service_role;
  r := public.website_request_ingest('qa-live-' || replace(gen_random_uuid()::text, '-', ''), 'contact', '{"name":"QA","message":"اختبار يتراجع","evil":"x"}'::jsonb, 'qa-ip-hash-aaaaaaaaaaaa');
  insert into wr_result values ('ingest created', (r->>'ok')::boolean and (r->>'created')::boolean, r::text);
  rid := (r->>'id')::uuid;
  r := public.website_request_ingest((select request_id from public.website_requests where id = rid), 'contact', '{"message":"again"}'::jsonb, null);
  insert into wr_result values ('ingest idempotent', (r->>'ok')::boolean and not (r->>'created')::boolean and (r->>'id')::uuid = rid, r::text);
  r := public.website_request_ingest('qa-bad', 'contact', '{"message":"x"}'::jsonb, null);
  insert into wr_result values ('ingest validation', r->>'error' = 'invalid', r::text);
  reset role;
  insert into wr_result values ('whitelist', not (select fields ? 'evil' from public.website_requests where id = rid), 'unknown keys dropped');

  -- 2) anon / authenticated have no direct access
  begin set local role anon; perform 1 from public.website_requests limit 1; insert into wr_result values ('anon select', false, 'was allowed');
  exception when insufficient_privilege then insert into wr_result values ('anon select', true, 'denied'); end;
  reset role;
  begin set local role authenticated; perform 1 from public.website_requests limit 1; insert into wr_result values ('authenticated select', false, 'was allowed');
  exception when insufficient_privilege then insert into wr_result values ('authenticated select', true, 'denied'); end;
  reset role;

  -- 3) reception user: list and mark
  perform set_config('request.jwt.claim.sub', rec::text, true); set local role authenticated;
  r := public.website_requests_list(ws, 'new', 50);
  insert into wr_result values ('reception list', jsonb_typeof(r) = 'array' and exists (select 1 from jsonb_array_elements(r) x where (x->>'id')::uuid = rid) and not (r->0 ? 'ip_hash'), 'rows=' || jsonb_array_length(r));
  begin
    r := public.website_requests_mark(ws, rid, 'reviewed');
    insert into wr_result values ('reception mark', r->>'status' = 'reviewed', r::text);
  exception when others then insert into wr_result values ('reception mark', false, sqlerrm); end;
  reset role;

  -- 4) a non-reception user is refused
  if other is not null then
    perform set_config('request.jwt.claim.sub', other::text, true); set local role authenticated;
    begin perform public.website_requests_list(ws); insert into wr_result values ('other user refused', false, 'was allowed');
    exception when others then insert into wr_result values ('other user refused', true, sqlerrm); end;
    reset role;
  end if;
end $$;
select * from wr_result order by 1;
rollback;
