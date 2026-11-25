-- Live rollback test for 20261125130000_package_partial_pulse.sql («من الباكج» for laser PULSE packages). ONE transaction ending in
-- ROLLBACK, as postgres; apply the migration body at the marked spot first if it is not applied. Nothing is kept.
-- Fixture (all rolled back): as postgres, a 1000-pulse package (1600) on a live pulse service for the patient of an open live visit (live
-- templates only come from the price editor sync, so the fixture is built like the legacy-package approval builds one). Mazen (reception)
-- puts the pulse service on that visit, then «خصم من باكج المريض»:
--   clinic_reception_legacy_packages(ws, patient)            → the session says pulses / 1000 left
--   clinic_reception_command(ws, 'order_use_package', {...})  → the order takes qty 1000 at 1.6 per pulse
-- A partial draw (320 pulses) is then simulated on the entitlement as postgres (the laser execute itself is already live and unchanged)
-- to prove the line is still listed with 680 left and the next order takes those 680; a second OPEN order on the same line is refused.
begin;
-- transaction guard: SAVEPOINT fails outside an explicit begin … rollback block (also when the file is sent as one query
-- without «begin;»), and then nothing in this file runs and nothing is kept
savepoint pp_live_guard;
select set_config('pp_live.in_txn', 'yes', true);
-- >>> apply supabase/migrations/20261125130000_package_partial_pulse.sql here (without its own begin / commit) if not applied yet <<<
create temp table pp_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; ws uuid; v record; svc record; r jsonb; tpl uuid; pkg uuid;
  o1 uuid; o2 uuid; ent uuid; lp jsonb; s jsonb; err text; oq numeric; op numeric;
begin
  if current_setting('pp_live.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction';
  end if;
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  insert into pp_live(step, expected, actual, ok) values ('migration applied', 'order_use_package_before_pulse exists',
    coalesce(to_regproc('clinic_reception.order_use_package_before_pulse')::text, 'missing'), to_regproc('clinic_reception.order_use_package_before_pulse') is not null);
  -- a live pulse service + an open live visit whose provider can take it
  select x.id, x.code, x.name into svc from clinic_reception.services x join clinic_reception.laser_pulse_services p on p.service_code = x.code
   where x.workspace_id = ws and x.active order by x.code limit 1;
  insert into pp_live(step, expected, actual, ok) values ('pulse service', 'a live service in laser_pulse_services', coalesce(svc.code || ' ' || svc.name, 'none'), svc.id is not null);
  select vv.id as visit_id, vv.patient_id, o.provider_id into v from clinic_reception.visits vv join clinic_reception.orders o on o.visit_id = vv.id
   where vv.workspace_id = ws and vv.status = 'open' and o.status = 'ordered'
   order by (o.service_id = svc.id) desc, o.created_at desc limit 1;
  insert into pp_live(step, expected, actual, ok) values ('fixture visit', 'an open live visit', coalesce(v.visit_id::text, 'none'), v.visit_id is not null);
  select id into me from public.admins where user_id = mazen;

  -- 0) fixture as postgres (rolled back): a 1000-pulse package (1600) for the visit's patient, built the way the legacy-package approval
  --    builds one (inactive template + package + one entitlement line). Live templates only come from the price editor sync.
  insert into clinic_reception.package_templates(workspace_id, code, name, version, price, visits, validity_days, terms, active)
    values (ws, 'RB-PULSE-' || left(gen_random_uuid()::text, 8), 'تجربة تراجع 1000 نبضة', 1, 1600, 1, 120, 'تجربة تراجع — لا تحفظ', false) returning id into tpl;
  insert into clinic_reception.packages(workspace_id, patient_id, template_id, name, contract_price, visits, expires_on, terms, created_by)
    values (ws, v.patient_id, tpl, 'تجربة تراجع 1000 نبضة', 1600, 1, (now() at time zone 'Africa/Cairo')::date + 120, 'تجربة تراجع', me) returning id into pkg;
  insert into clinic_reception.entitlements(package_id, visit_no, service_id, quantity, allocated_value, snapshot)
    select pkg, 1, x.id, 1000, 1600, to_jsonb(x) from clinic_reception.services x where x.id = svc.id;
  insert into pp_live(step, expected, actual, ok) select 'fixture package (postgres)', 'active · 1 line × 1000', k.status || ' · ' || count(e.id) || ' × ' || max(e.quantity),
    k.status = 'active' and count(e.id) = 1 and max(e.quantity) = 1000
    from clinic_reception.packages k left join clinic_reception.entitlements e on e.package_id = k.id where k.id = pkg group by k.status;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  -- 1) Mazen puts the pulse service on the visit («+ إضافة خدمة», unless the visit already has one waiting)
  select o.id into o1 from clinic_reception.orders o where o.visit_id = v.visit_id and o.service_id = svc.id and o.status = 'ordered' and o.entitlement_id is null limit 1;
  err := 'already on the visit';
  if o1 is null then
    begin execute 'set local role authenticated';
      perform public.clinic_reception_command(ws, 'order_add', jsonb_build_object('visit_id', v.visit_id, 'service_id', svc.id, 'provider_id', v.provider_id, 'quantity', '1'), gen_random_uuid());
      execute 'reset role'; err := 'ok';
    exception when others then execute 'reset role'; err := sqlerrm; end;
    select o.id into o1 from clinic_reception.orders o where o.visit_id = v.visit_id and o.service_id = svc.id and o.status = 'ordered' and o.entitlement_id is null order by o.created_at desc limit 1;
  end if;
  insert into pp_live(step, expected, actual, ok) values ('Mazen order_add (pulse service)', 'ordered pulse order', err || ' · ' || coalesce(o1::text, 'no order'), o1 is not null);

  -- 2) Mazen: the session list says pulses, 1000 of 1000
  begin execute 'set local role authenticated'; lp := public.clinic_reception_legacy_packages(ws, v.patient_id); execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select x into s from jsonb_array_elements(lp->'sessions') x join clinic_reception.entitlements e on e.id = (x->>'entitlement_id')::uuid where e.package_id = pkg limit 1;
  ent := (s->>'entitlement_id')::uuid;
  insert into pp_live(step, expected, actual, ok) values ('Mazen sessions (clinic_reception_legacy_packages)', 'pulses true · 1000 of 1000',
    err || ' · ' || coalesce(s->>'pulses', '?') || ' · ' || coalesce(s->>'remaining', '?') || ' of ' || coalesce(s->>'quantity', '?'),
    (s->>'pulses')::boolean and (s->>'remaining')::numeric = 1000 and (s->>'quantity')::numeric = 1000);

  -- 3) Mazen «خصم من باكج المريض» → order_use_package
  begin execute 'set local role authenticated';
    r := public.clinic_reception_command(ws, 'order_use_package', jsonb_build_object('order_id', o1, 'entitlement_id', ent), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; r := null; end;
  select quantity, price into oq, op from clinic_reception.orders where id = o1;
  insert into pp_live(step, expected, actual, ok) values ('Mazen order_use_package', 'pulses true · order qty 1000 × 1.6',
    err || ' · ' || coalesce(r->>'pulses', '?') || ' · qty ' || oq || ' × ' || op, (r->>'pulses')::boolean and oq = 1000 and op = 1.6);

  -- 4) while that order is open, a second order cannot take the same pulse line
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(ws, 'order_add', jsonb_build_object('visit_id', v.visit_id, 'service_id', svc.id, 'provider_id', v.provider_id, 'quantity', '1'), gen_random_uuid());
    execute 'reset role';
  exception when others then execute 'reset role'; end;
  select o.id into o2 from clinic_reception.orders o where o.visit_id = v.visit_id and o.service_id = svc.id and o.status = 'ordered' and o.entitlement_id is null and o.id <> o1 order by o.created_at desc limit 1;
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(ws, 'order_use_package', jsonb_build_object('order_id', o2, 'entitlement_id', ent), gen_random_uuid());
    execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into pp_live(step, expected, actual, ok) values ('second open order, same line', 'refused (اتستخدمت)', coalesce(o2::text, 'no 2nd order') || ' · ' || err, o2 is not null and err like '%اتستخدمت%');

  -- 5) simulate «تنفيذ» of the first order with 320 pulses by the meter (the laser execute is already live and unchanged)
  update clinic_reception.orders set status = 'completed', quantity = 320 where id = o1;
  update clinic_reception.entitlements set used = 320, recognized = 512 where id = ent;
  begin execute 'set local role authenticated'; lp := public.clinic_reception_legacy_packages(ws, v.patient_id); execute 'reset role';
  exception when others then execute 'reset role'; lp := null; end;
  select x into s from jsonb_array_elements(lp->'sessions') x where (x->>'entitlement_id')::uuid = ent;
  insert into pp_live(step, expected, actual, ok) values ('after 320 pulses (simulated execute)', 'still listed · 680 left', coalesce(s->>'remaining', 'not listed'), (s->>'remaining')::numeric = 680);

  -- 6) next visit: the second order now takes the same line with the 680 left at 1.6
  begin execute 'set local role authenticated';
    r := public.clinic_reception_command(ws, 'order_use_package', jsonb_build_object('order_id', o2, 'entitlement_id', ent), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; r := null; end;
  select quantity, price into oq, op from clinic_reception.orders where id = o2;
  insert into pp_live(step, expected, actual, ok) values ('Mazen order_use_package (680 left)', 'ok · qty 680 × 1.6 · remaining 680',
    err || ' · qty ' || oq || ' × ' || op || ' · ' || coalesce(r->>'remaining', '?'), err = 'ok' and oq = 680 and op = 1.6 and (r->>'remaining')::numeric = 680);
end $$;
select step, expected, actual, ok from pp_live order by n;
rollback;
