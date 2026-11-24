-- Live rollback test for «تغيير الخدمة» (today board shortcut, owner 2026-11-24). ONE transaction ending in ROLLBACK, as postgres.
-- The shortcut only opens the visit window; the two calls it leads to are run here as Mazen (reception) on a real open live visit:
--   «+ إضافة خدمة»  → clinic_reception_command(ws, 'order_add',    {visit_id, service_id, provider_id, quantity}, token)
--   «إلغاء الطلب»   → clinic_reception_command(ws, 'order_cancel', {id, reason}, token)
-- Nothing is kept (no order, invoice or log row survives the ROLLBACK).
begin;
create temp table cs_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; ws uuid; o record; r jsonb; new_id uuid; st text; err text;
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  -- an open live visit with a service still waiting (not executed, not from a package)
  select x.* into o from clinic_reception.orders x join clinic_reception.visits v on v.id = x.visit_id
   where x.workspace_id = ws and v.status = 'open' and x.status = 'ordered' and x.entitlement_id is null order by x.created_at desc limit 1;
  insert into cs_live(step, expected, actual, ok) values ('fixture', 'an open visit with an ordered service', coalesce(o.id::text, 'none'), o.id is not null);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  -- 1) «+ إضافة خدمة» (same provider + service as the waiting one, so it is always in scope)
  begin execute 'set local role authenticated';
    r := public.clinic_reception_command(ws, 'order_add', jsonb_build_object('visit_id', o.visit_id, 'service_id', o.service_id, 'provider_id', o.provider_id, 'quantity', '1'), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select x.id into new_id from clinic_reception.orders x where x.visit_id = o.visit_id and x.id <> o.id and x.status = 'ordered' order by x.created_at desc limit 1;
  insert into cs_live(step, expected, actual, ok) values ('Mazen «+ إضافة خدمة» (order_add)', 'ok + new ordered order', err || ' · ' || coalesce(new_id::text, 'no new order'), err = 'ok' and new_id is not null);
  -- 2) «إلغاء الطلب» on the old service with a reason
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(ws, 'order_cancel', jsonb_build_object('id', o.id, 'reason', 'تجربة تراجع — تغيير الخدمة'), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select status into st from clinic_reception.orders where id = o.id;
  insert into cs_live(step, expected, actual, ok) values ('Mazen «إلغاء الطلب» on the old service (order_cancel)', 'ok + cancelled', err || ' · ' || coalesce(st, '?'), err = 'ok' and st = 'cancelled');
  -- 3) the visit is never left empty: the new service is still waiting
  select status into st from clinic_reception.orders where id = new_id;
  insert into cs_live(step, expected, actual, ok) values ('new service after the swap', 'ordered', coalesce(st, 'none'), st = 'ordered');
end $$;
select step, expected, actual, ok from cs_live order by n;
rollback;
