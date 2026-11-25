-- Live rollback test for 20261125200000_supplies_billable_at_service.sql (supplies at service, PR1). ONE transaction ending in
-- ROLLBACK, run as postgres; apply the migration body at the marked spot first if it is not applied. Nothing is kept.
-- Fixture (all rolled back, as postgres): a live service that a doctor already executed recently gets a 2-line BOM (two items
-- with stock in «فرعي مستلزمات تمريض»; the second is «يتحاسب على المريض» for this service), an arrived appointment + open
-- visit for that service's last patient, and two ordered services on it. Then, as Mazen (reception):
--   execute from «فندقة»/central (refused by the store gate) → execute from the nurse store: line 1 included, line 2 billed
--   execute order 2 without line 2 → clinic_reception_finish_check shows it → visit_close refused → visit_close with missing_ack
--   (note written) → clinic_reception_visit_reopen → clinic_reception_visit_supplies add line 2 (billed) → add line 1 again
--   (refused, then confirmed) → visit_close (nothing missing). Classification: Mazen refused; a super admin sets the item flag
--   (mirror) and lists the per-service overrides.
-- If Mazen has no open cash shift right now, the (unrelated, already live) shift guard is stubbed inside this transaction
-- and the output says so.
begin;
-- transaction guard: SAVEPOINT fails outside an explicit begin … rollback block, and then nothing in this file runs
savepoint sb_live_guard;
select set_config('sb_live.in_txn', 'yes', true);
-- >>> apply supabase/migrations/20261125200000_supplies_billable_at_service.sql here (without its own begin / commit) if not applied yet <<<
create temp table sb_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; boss_uid uuid; ws uuid; nurse uuid; bad uuid; svc record; it1 record; it2 record;
  slot timestamptz; appt uuid; vis uuid; o1 uuid; o2 uuid; r jsonb; err text; g jsonb; amt numeric; stubbed boolean := false; note text; n int; inv_item uuid; prev boolean;
  procedure_ok boolean;
begin
  if current_setting('sb_live.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction';
  end if;
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  insert into sb_live(step, expected, actual, ok) values ('migration applied', 'command_before_supplies exists',
    coalesce(to_regproc('clinic_reception.command_before_supplies')::text, 'missing'), to_regproc('clinic_reception.command_before_supplies') is not null);
  select count(*) into n from clinic_reception.consume_locations where workspace_id = ws;
  insert into sb_live(step, expected, actual, ok) values ('store map seeded', '6 rows (general/physio/dental)', n::text, n = 6);
  select c.location_id into nurse from clinic_reception.consume_locations c join clinic_reception.locations l on l.id = c.location_id
    join public.inventory_locations il on il.id = l.inventory_location_id where c.workspace_id = ws and c.section = 'general' and il.name = 'فرعي مستلزمات تمريض';
  select l.id into bad from clinic_reception.locations l where l.workspace_id = ws and l.inventory_location_id = '00000000-0000-4000-8000-000000000001';
  insert into sb_live(step, expected, actual, ok) values ('stores', 'nurse store + central store found', coalesce(nurse::text, 'no nurse') || ' / ' || coalesce(bad::text, 'no central'), nurse is not null and bad is not null);
  select id into me from public.admins where user_id = mazen;

  -- 0) fixture as postgres (rolled back)
  perform clinic_reception.sync_stock(ws);
  select i.id, i.name, i.sale_price into it1 from clinic_reception.items i
   where i.workspace_id = ws and i.sale_price > 0 and i.inventory_item_id is not null and (select coalesce(sum(m.quantity), 0) from clinic_reception.movements m where m.item_id = i.id and m.location_id = nurse) >= 3
   order by i.name limit 1;
  select i.id, i.name, i.sale_price into it2 from clinic_reception.items i
   where i.workspace_id = ws and i.sale_price > 0 and i.inventory_item_id is not null and i.id <> it1.id and (select coalesce(sum(m.quantity), 0) from clinic_reception.movements m where m.item_id = i.id and m.location_id = nurse) >= 3
   order by i.name limit 1;
  insert into sb_live(step, expected, actual, ok) values ('fixture items', '2 items with stock ≥ 3 in the nurse store', coalesce(it1.name, '-') || ' / ' || coalesce(it2.name, '-') || ' (' || coalesce(it2.sale_price::text, '?') || ')', it1.id is not null and it2.id is not null);
  select s.id, s.code, s.name, s.department, s.price, o.provider_id, v.patient_id into svc
    from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id join clinic_reception.services s on s.id = o.service_id
   where o.workspace_id = ws and o.status = 'completed' and o.completed_at > now() - interval '60 days'
     and clinic_reception.supply_section(s.department) = 'general' and s.price > 0
     and exists (select 1 from clinic_reception.doctor_agreements a where a.provider_id = o.provider_id and a.service_code = s.code and a.status = 'active'
                  and (now() at time zone 'Africa/Cairo')::date between a.valid_from and a.valid_to)
   order by o.completed_at desc limit 1;
  insert into sb_live(step, expected, actual, ok) values ('fixture service', 'a skin/consult service executed in the last 60 days', coalesce(svc.code || ' ' || svc.name || ' — ' || svc.department, 'none'), svc.id is not null);
  update clinic_reception.services set bom = jsonb_build_array(jsonb_build_object('item_id', it1.id, 'quantity', 1, 'included', true),
                                                               jsonb_build_object('item_id', it2.id, 'quantity', 1, 'included', true)) where id = svc.id;
  insert into clinic_reception.service_billing(workspace_id, service_id, item_id, billable, updated_by) values (ws, svc.id, it1.id, false, me), (ws, svc.id, it2.id, true, me)
    on conflict (service_id, item_id) do update set billable = excluded.billable;
  -- a free 20-minute slot for this doctor near now (the appointment gap trigger wants 5 minutes between bookings)
  select t into slot from generate_series(date_trunc('hour', now()) - interval '12 hours', date_trunc('hour', now()) + interval '12 hours', interval '5 minutes') t
   where not exists (select 1 from clinic_reception.appointments a where a.provider_id = svc.provider_id and a.status not in ('cancelled', 'no_show')
                      and a.starts_at < t + interval '30 minutes' and a.ends_at > t - interval '10 minutes')
   order by abs(extract(epoch from t - now())) limit 1;
  insert into clinic_reception.appointments(workspace_id, patient_id, provider_id, service_id, starts_at, ends_at, status, created_by, arrived_at)
    values (ws, svc.patient_id, svc.provider_id, svc.id, slot, slot + interval '20 minutes', 'arrived', me, now()) returning id into appt;
  insert into clinic_reception.visits(workspace_id, appointment_id, patient_id, opened_by) values (ws, appt, svc.patient_id, me) returning id into vis;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select ws, vis, s.id, svc.provider_id, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc.id returning id into o1;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select ws, vis, s.id, svc.provider_id, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc.id returning id into o2;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  g := clinic_reception.shift_guard_state();
  if coalesce((g->>'locked')::boolean, false) then
    execute 'create or replace function clinic_reception.shift_guard_check(p_workspace uuid) returns void language plpgsql as $f$ begin return; end $f$';
    stubbed := true;
  end if;
  insert into sb_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'Mazen has an open shift, or stubbed in this txn', case when stubbed then 'stubbed (Mazen had no open shift)' else 'open shift' end, true);

  -- 1) store gate: the central store is refused for a skin service
  begin r := public.clinic_reception_command(ws, 'execute', jsonb_build_object('id', o1, 'location_id', bad), gen_random_uuid()); err := 'accepted';
  exception when others then err := sqlerrm; end;
  insert into sb_live(step, expected, actual, ok) values ('Mazen execute from the central store', 'refused «مش مسموح يتصرف منه»', err, err like '%مش مسموح يتصرف منه%');
  -- 2) execute from the nurse store: line 1 included, line 2 billed at the sale price, no «وافق المريض»
  begin r := public.clinic_reception_command(ws, 'execute', jsonb_build_object('id', o1, 'location_id', nurse), gen_random_uuid()); err := 'ok';
  exception when others then err := sqlerrm; end;
  select amount into amt from clinic_reception.invoices where order_id = o1;
  insert into sb_live(step, expected, actual, ok) values ('Mazen execute (nurse store)', 'ok; invoice = price + ' || it2.sale_price, err || ' · invoice ' || coalesce(amt::text, '-') || ' (price ' || svc.price || ')',
    err = 'ok' and amt = svc.price + round(it2.sale_price, 2));
  select string_agg(m.kind || ':' || (case when m.item_id = it1.id then 'item1' else 'item2' end), ',' order by m.kind) into note
    from clinic_reception.movements m where m.source_id = o1;
  insert into sb_live(step, expected, actual, ok) values ('stock movements of order 1', 'included:item1,sale:item2', coalesce(note, '-'), note = 'included:item1,sale:item2');
  -- 3) order 2 without the billable line → finish check → close refused → close with missing_ack
  begin r := public.clinic_reception_command(ws, 'execute', jsonb_build_object('id', o2, 'location_id', nurse,
      'materials', jsonb_build_array(jsonb_build_object('item_id', it1.id, 'quantity', 1)), 'material_note', 'تجربة تراجع — المريض رفض'), gen_random_uuid()); err := 'ok';
  exception when others then err := sqlerrm; end;
  insert into sb_live(step, expected, actual, ok) values ('Mazen execute order 2 without line 2', 'ok', err, err = 'ok');
  r := public.clinic_reception_finish_check(ws, jsonb_build_object('visit_id', vis));
  insert into sb_live(step, expected, actual, ok) values ('Mazen finish_check', '1 missing = item2', jsonb_array_length(r->'missing') || ' · ' || coalesce(r->'missing'->0->>'item', '-') || ' · ' || coalesce(r->>'total', '-'),
    jsonb_array_length(r->'missing') = 1 and (r->'missing'->0->>'item_id')::uuid = it2.id);
  begin r := public.clinic_reception_command(ws, 'visit_close', jsonb_build_object('id', vis), gen_random_uuid()); err := 'accepted';
  exception when others then err := sqlerrm; end;
  insert into sb_live(step, expected, actual, ok) values ('Mazen visit_close (no confirmation)', 'refused «مستلزم بيتحاسب ناقص»', err, err like '%مستلزم بيتحاسب ناقص%');
  begin r := public.clinic_reception_command(ws, 'visit_close', jsonb_build_object('id', vis, 'missing_ack', true), gen_random_uuid()); err := 'ok';
  exception when others then err := sqlerrm; end;
  select close_note into note from clinic_reception.visits where id = vis;
  insert into sb_live(step, expected, actual, ok) values ('Mazen visit_close + missing_ack', 'closed; note «تم التنبيه على … رغم ذلك»', err || ' · ' || coalesce(note, '-'),
    err = 'ok' and note like 'تم التنبيه على %واختار الإنهاء رغم ذلك%' and (select status from clinic_reception.visits where id = vis) = 'completed');
  -- 4) «تعديل قبل التحصيل» → «مستلزمات الزيارة»
  begin r := public.clinic_reception_visit_reopen(ws, vis, 'تجربة تراجع', gen_random_uuid()); err := coalesce(r->>'status', '?');
  exception when others then err := sqlerrm; end;
  insert into sb_live(step, expected, actual, ok) values ('Mazen visit_reopen', 'open', err, err = 'open');
  begin r := public.clinic_reception_visit_supplies(ws, 'add', jsonb_build_object('order_id', o2, 'item_id', it2.id, 'location_id', nurse, 'quantity', 1, 'token', gen_random_uuid())); err := 'ok';
  exception when others then err := sqlerrm; end;
  select amount into amt from clinic_reception.invoices where order_id = o2;
  insert into sb_live(step, expected, actual, ok) values ('Mazen add item2 (billable)', 'ok; invoice = price + ' || it2.sale_price, err || ' · invoice ' || coalesce(amt::text, '-'),
    err = 'ok' and amt = svc.price + round(it2.sale_price, 2));
  begin r := public.clinic_reception_visit_supplies(ws, 'add', jsonb_build_object('order_id', o2, 'item_id', it1.id, 'location_id', nurse, 'quantity', 1)); err := 'accepted';
  exception when others then err := sqlerrm; end;
  insert into sb_live(step, expected, actual, ok) values ('Mazen add item1 again, unconfirmed', 'refused (duplicate)', err, err like '%متسجّل قبل كده%');
  begin r := public.clinic_reception_visit_supplies(ws, 'add', jsonb_build_object('order_id', o2, 'item_id', it1.id, 'location_id', nurse, 'quantity', 1,
      'confirm_duplicate', true, 'confirm_included', true)); err := 'ok · amount ' || (r->>'amount');
  exception when others then err := sqlerrm; end;
  insert into sb_live(step, expected, actual, ok) values ('Mazen add item1 confirmed', 'ok · amount 0 (in the price)', err, err = 'ok · amount 0');
  r := public.clinic_reception_visit_supplies(ws, 'list', jsonb_build_object('visit_id', vis));
  insert into sb_live(step, expected, actual, ok) values ('Mazen list', 'nothing missing; reception lines shown', jsonb_array_length(r->'missing') || ' missing',
    jsonb_array_length(r->'missing') = 0 and exists (select 1 from jsonb_array_elements(r->'orders') o, jsonb_array_elements(o->'lines') l where l->>'source' = 'reception'));
  begin r := public.clinic_reception_command(ws, 'visit_close', jsonb_build_object('id', vis), gen_random_uuid()); err := 'ok';
  exception when others then err := sqlerrm; end;
  insert into sb_live(step, expected, actual, ok) values ('Mazen visit_close again', 'ok (nothing missing)', err, err = 'ok');
  -- 5) classification
  begin r := public.clinic_reception_service_billing(ws, 'list', '{}'); err := 'accepted';
  exception when others then err := sqlerrm; end;
  insert into sb_live(step, expected, actual, ok) values ('Mazen service_billing', 'refused (inventory manager only)', err, err like '%لمسؤول المخزن%');
  select user_id into boss_uid from public.admins where role = 'super_admin' and active and user_id is not null order by id limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', boss_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', boss_uid::text, true);
  select i.inventory_item_id into inv_item from clinic_reception.items i where i.id = it1.id;
  select patient_billable into prev from public.inventory_items where id = inv_item;
  begin r := public.inventory_set_patient_billable(inv_item, not prev); err := 'ok';
  exception when others then err := sqlerrm; end;
  insert into sb_live(step, expected, actual, ok) values ('super admin inventory_set_patient_billable', 'ok + mirrored to the reception item',
    err || ' · mirror ' || (select patient_billable::text from clinic_reception.items where id = it1.id),
    err = 'ok' and (select patient_billable from clinic_reception.items where id = it1.id) = (not prev));
  begin r := public.clinic_reception_service_billing(null, 'list', '{}'); err := jsonb_array_length(r->'services')::text || ' services';
  exception when others then err := sqlerrm; end;
  insert into sb_live(step, expected, actual, ok) values ('super admin service_billing list', 'lists services with BOM', err, err like '% services');
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
select step, expected, actual, ok from sb_live order by n;
rollback;
