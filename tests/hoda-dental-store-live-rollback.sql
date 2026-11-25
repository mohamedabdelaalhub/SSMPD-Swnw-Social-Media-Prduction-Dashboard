-- Rolled-back live check for supabase/ops/20261125_hoda_dental_store.sql (button rule, owner 2026-11-23).
-- Adds the same grant inside this transaction, then runs as Hoda (impersonated as authenticated) the calls her inventory
-- screen makes, and prints one row per check. Everything (the grant and the 1-unit test consumption) ROLLS BACK.
-- (test.admin is only read by the PGlite harness; harmless on live.) ok=false rows are problems.
begin;
create temp table _chk(step text, expected text, ok boolean, detail text) on commit drop;
grant all on _chk to authenticated;
do $$
declare
  dental constant uuid := '552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7';
  central constant uuid := '00000000-0000-4000-8000-000000000001';
  h uuid; hu uuid; n int; res jsonb; it uuid; sub uuid; e text; ok boolean; before numeric; mv uuid;
begin
  select count(*) into n from public.admins where active and name ~ 'هد[ىي]';
  if n <> 1 then raise exception 'expected exactly one active admin named هدى/هدي, found %', n; end if;
  select id, user_id into h, hu from public.admins where active and name ~ 'هد[ىي]';
  if hu is null then raise exception 'Hoda has no login (user_id is null)'; end if;
  insert into _chk select 'role', 'inventory tab roles: nursing/reception/sono_doctor/GM/super_admin', role in ('nursing','reception','sono_doctor','general_manager','super_admin'), name || ' — ' || role from public.admins where id = h;
  insert into _chk select 'before grant', 'no dental responsibility yet', not exists(select 1 from public.inventory_location_staff where admin_id = h and location_id = dental),
    coalesce((select string_agg(l.name || ':' || s.responsibility, '، ') from public.inventory_location_staff s join public.inventory_locations l on l.id = s.location_id where s.admin_id = h), 'none');
  insert into public.inventory_location_staff(location_id, admin_id, responsibility) values (dental, h, 'receiver') on conflict do nothing;
  -- a dental item with stock (largest balance) for the consumption check
  select m.item_id into it from public.inventory_movements m where m.location_id = dental group by m.item_id having sum(m.quantity_delta) >= 1 order by sum(m.quantity_delta) desc limit 1;
  select id into sub from public.inventory_locations where name = 'فرعي مستلزمات تمريض' and active;
  before := public.inventory_location_balance(dental, it);

  perform set_config('request.jwt.claim.sub', hu::text, true); perform set_config('test.admin', h::text, true);
  execute 'set local role authenticated';
  begin ok := public.inventory_my_access(); insert into _chk values ('inventory_my_access', 'true (tab opens)', ok, ok::text);
  exception when others then insert into _chk values ('inventory_my_access', 'true', false, sqlerrm); end;
  begin res := public.inventory_workspace_snapshot(dental);
    insert into _chk values ('snapshot رئيسي أسنان', 'opens; can_receive=true; can_manage=false',
      (res->>'can_receive')::boolean and not (res->>'can_manage')::boolean,
      'items=' || coalesce(jsonb_array_length(res->'items'), 0) || ' balances=' || coalesce(jsonb_array_length(res->'balances'), 0)
      || ' can_request=' || coalesce(res->>'can_request', '?') || ' can_approve=' || coalesce(res->>'can_approve', '?'));
    insert into _chk values ('store list', 'only رئيسي أسنان visible',
      (select bool_and((x->>'id')::uuid = dental) from jsonb_array_elements(res->'locations') x where coalesce((x->>'can_view')::boolean, false)),
      (select string_agg(x->>'name', '، ') from jsonb_array_elements(res->'locations') x where coalesce((x->>'can_view')::boolean, false)));
  exception when others then insert into _chk values ('snapshot رئيسي أسنان', 'opens', false, sqlerrm); end;
  begin res := public.inventory_workspace_snapshot(null);
    insert into _chk values ('snapshot default', 'defaults to رئيسي أسنان', (res->>'location_id')::uuid = dental, res->>'location_id');
  exception when others then insert into _chk values ('snapshot default', 'opens', false, sqlerrm); end;
  begin mv := public.inventory_consume_at(dental, it, 1, 'issue', 'اختبار صلاحية متراجع');
    insert into _chk values ('استهلاك داخلي 1 من رئيسي أسنان', 'passes', true, 'movement ' || mv);
  exception when others then insert into _chk values ('استهلاك داخلي 1 من رئيسي أسنان', 'passes', false, sqlerrm); end;
  for e in select unnest(array['central','sub']) loop
    begin perform public.inventory_workspace_snapshot(case e when 'central' then central else sub end);
      insert into _chk values ('snapshot ' || e, 'refused', false, 'opened');
    exception when others then insert into _chk values ('snapshot ' || e, 'refused', true, sqlerrm); end;
    begin perform public.inventory_consume_at(case e when 'central' then central else sub end, it, 1, 'issue', 'اختبار صلاحية متراجع');
      insert into _chk values ('استهلاك من ' || e, 'refused', false, 'passed');
    exception when others then insert into _chk values ('استهلاك من ' || e, 'refused', true, sqlerrm); end;
  end loop;
  begin perform public.inventory_direct_invoice('context', '{}'::jsonb); insert into _chk values ('فاتورة مورد مباشرة', 'refused', false, 'opened');
  exception when others then insert into _chk values ('فاتورة مورد مباشرة', 'refused', true, sqlerrm); end;
  execute 'reset role';
  insert into _chk values ('balance after test issue', 'dropped by exactly 1 (rolled back)', public.inventory_location_balance(dental, it) = before - 1,
    before || ' → ' || public.inventory_location_balance(dental, it));
end $$;
select * from _chk;
rollback;
