-- Live rollback test for 20261125210000_supplies_performer_vitals.sql (supplies at service, PR2: performer screen + vitals kit).
-- ONE transaction ending in ROLLBACK, run as postgres; apply the migration body at the marked spot first if it is not applied
-- (PR1 20261125200000 must already be applied). Nothing is kept.
-- Fixture (all rolled back, as postgres): a live DENTAL service that a doctor executed recently gets a 2-line BOM (two items with
-- stock in «رئيسي أسنان»; the second is «يتحاسب على المريض» for this service), an arrived appointment + open visit for that
-- service's last patient, and two ordered services on it. Then:
--   as Hoda «هدى حمدى ابراهيم» (nursing, not a reception member): «today» lists order 1 with the dental store → execute from
--   «فرعي مستلزمات تمريض» refused → execute from «رئيسي أسنان»: line 1 included, line 2 billed → order 2 «بدون مستلزمات» without
--   a reason refused, with a reason ok → kit editor refused for her → (head nursing / super admin saves a sugar kit) → triage
--   recorded with sugar measured consumes the kit from «رئيسي أسنان» → re-save consumes nothing → sugar «رفض» reverses it
--   (stock + 5123 back to zero).
--   as Mazen (reception): performer «today» refused, nursing triage_save refused.
begin;
-- transaction guard: SAVEPOINT fails outside an explicit begin … rollback block, and then nothing in this file runs
savepoint pv_live_guard;
select set_config('pv_live.in_txn', 'yes', true);
-- >>> apply supabase/migrations/20261125210000_supplies_performer_vitals.sql here (without its guard block / begin / commit) if not applied yet <<<
create temp table pv_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; hoda record; me uuid; kit_uid uuid; ws uuid; dent uuid; nurse uuid; svc record; it1 record; it2 record;
  appt uuid; vis uuid; o1 uuid; o2 uuid; r jsonb; err text; amt numeric; note text; n int; s0 numeric; s1 numeric; cid uuid; j numeric;
begin
  if current_setting('pv_live.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction';
  end if;
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  insert into pv_live(step, expected, actual, ok) values ('migration applied', 'clinic_reception_performer + vitals_kit exist',
    coalesce(to_regprocedure('public.clinic_reception_performer(uuid,text,jsonb)')::text, 'missing') || ' / ' || coalesce(to_regclass('clinic_reception.vitals_kit')::text, 'missing'),
    to_regprocedure('public.clinic_reception_performer(uuid,text,jsonb)') is not null and to_regclass('clinic_reception.vitals_kit') is not null);
  select a.id, a.user_id, a.role, a.active,
         (select coalesce(array_agg(x.role), '{}') from public.admin_extra_roles x where x.admin_id = a.id) extra,
         exists (select 1 from clinic_reception.members m where m.workspace_id = ws and m.admin_id = a.id) member,
         clinic_reception.nurse_section(a.id) section
    into hoda from public.admins a where a.name = 'هدى حمدى ابراهيم' order by a.active desc limit 1;
  insert into pv_live(step, expected, actual, ok) values ('Hoda resolved by name', 'active nursing, not a reception member, section dental',
    coalesce(hoda.role || ' +' || hoda.extra::text || ' · member ' || hoda.member || ' · section ' || hoda.section || ' · user ' || coalesce(hoda.user_id::text, 'NULL'), 'not found'),
    hoda.id is not null and hoda.active and hoda.user_id is not null and not hoda.member and hoda.section = 'dental');
  select id into me from public.admins where user_id = mazen;
  select l.id into dent from clinic_reception.locations l where l.workspace_id = ws and l.inventory_location_id = '552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7';
  select l.id into nurse from clinic_reception.locations l join public.inventory_locations il on il.id = l.inventory_location_id
   where l.workspace_id = ws and il.name = 'فرعي مستلزمات تمريض' and not il.is_main;
  insert into pv_live(step, expected, actual, ok) values ('stores', '«رئيسي أسنان» + «فرعي مستلزمات تمريض» found', coalesce(dent::text, 'no dental') || ' / ' || coalesce(nurse::text, 'no nurse'), dent is not null and nurse is not null);
  select string_agg(i.name, '، ' order by i.name) into note from clinic_reception.items i
   where i.workspace_id = ws and i.name ~ '(قطن|كحول|شريحة|شكاك|جلافز|جوانتي|ترمومتر)';
  insert into pv_live(step, expected, actual, ok) values ('info: candidate kit items (head nurse picks them)', 'names only', coalesce(note, 'none'), true);

  -- 0) fixture as postgres (rolled back)
  perform clinic_reception.sync_stock(ws);
  select i.id, i.name, i.sale_price into it1 from clinic_reception.items i
   where i.workspace_id = ws and i.sale_price > 0 and i.inventory_item_id is not null and clinic_reception.stock_at(ws, i.id, dent) >= 3 order by i.name limit 1;
  select i.id, i.name, i.sale_price into it2 from clinic_reception.items i
   where i.workspace_id = ws and i.sale_price > 0 and i.inventory_item_id is not null and i.id <> it1.id and clinic_reception.stock_at(ws, i.id, dent) >= 3 order by i.name limit 1;
  insert into pv_live(step, expected, actual, ok) values ('fixture items', '2 items with stock ≥ 3 in «رئيسي أسنان»', coalesce(it1.name, '-') || ' / ' || coalesce(it2.name, '-') || ' (' || coalesce(it2.sale_price::text, '?') || ')', it1.id is not null and it2.id is not null);
  select s.id, s.code, s.name, s.department, s.price, o.provider_id, v.patient_id into svc
    from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id join clinic_reception.services s on s.id = o.service_id
   where o.workspace_id = ws and o.status = 'completed' and o.completed_at > now() - interval '60 days'
     and clinic_reception.supply_section(s.department) = 'dental' and s.price > 0
     and exists (select 1 from clinic_reception.doctor_agreements a where a.provider_id = o.provider_id and a.service_code = s.code and a.status = 'active'
                  and (now() at time zone 'Africa/Cairo')::date between a.valid_from and a.valid_to)
   order by o.completed_at desc limit 1;
  insert into pv_live(step, expected, actual, ok) values ('fixture service', 'a dental service executed in the last 60 days', coalesce(svc.code || ' ' || svc.name || ' — ' || svc.department, 'none'), svc.id is not null);
  update clinic_reception.services set bom = jsonb_build_array(jsonb_build_object('item_id', it1.id, 'quantity', 1, 'included', true),
                                                               jsonb_build_object('item_id', it2.id, 'quantity', 1, 'included', true)) where id = svc.id;
  insert into clinic_reception.service_billing(workspace_id, service_id, item_id, billable, updated_by) values (ws, svc.id, it1.id, false, me), (ws, svc.id, it2.id, true, me)
    on conflict (service_id, item_id) do update set billable = excluded.billable;
  insert into clinic_reception.appointments(workspace_id, patient_id, provider_id, service_id, starts_at, ends_at, status, created_by, arrived_at)
    values (ws, svc.patient_id, svc.provider_id, svc.id, now(), now() + interval '20 minutes', 'arrived', me, now()) returning id into appt;
  insert into clinic_reception.visits(workspace_id, appointment_id, patient_id, opened_by) values (ws, appt, svc.patient_id, me) returning id into vis;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select ws, vis, s.id, svc.provider_id, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc.id returning id into o1;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select ws, vis, s.id, svc.provider_id, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc.id returning id into o2;

  -- A) performer as Hoda
  perform set_config('request.jwt.claims', jsonb_build_object('sub', hoda.user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', hoda.user_id::text, true);
  insert into pv_live(step, expected, actual, ok) values ('info: Hoda cash-shift lock state (performer path ignores it)', 'any', clinic_reception.shift_guard_state()::text, true);
  begin r := public.clinic_reception_performer(ws, 'today', '{}'); err := 'ok';
  exception when others then err := sqlerrm; r := null; end;
  insert into pv_live(step, expected, actual, ok) values ('Hoda today', 'lists order 1; stores include «رئيسي أسنان», not the nurse store',
    err || ' · orders ' || coalesce(jsonb_array_length(r->'orders')::text, '-') || ' · stores ' || coalesce((select string_agg(x->>'name', '، ') from jsonb_array_elements(r->'locations') x), '-'),
    err = 'ok' and exists (select 1 from jsonb_array_elements(r->'orders') x where (x->>'id')::uuid = o1)
      and exists (select 1 from jsonb_array_elements(r->'locations') x where (x->>'id')::uuid = dent)
      and not exists (select 1 from jsonb_array_elements(r->'locations') x where (x->>'id')::uuid = nurse));
  begin r := public.clinic_reception_performer(ws, 'execute', jsonb_build_object('order_id', o1, 'location_id', nurse,
      'materials', jsonb_build_array(jsonb_build_object('item_id', it1.id, 'quantity', 1), jsonb_build_object('item_id', it2.id, 'quantity', 1)))); err := 'accepted';
  exception when others then err := sqlerrm; end;
  insert into pv_live(step, expected, actual, ok) values ('Hoda execute from the nurse store', 'refused «مش مسموح يتصرف منه»', err, err like '%مش مسموح يتصرف منه%');
  begin r := public.clinic_reception_performer(ws, 'execute', jsonb_build_object('order_id', o1, 'location_id', dent, 'token', gen_random_uuid(),
      'materials', jsonb_build_array(jsonb_build_object('item_id', it1.id, 'quantity', 1), jsonb_build_object('item_id', it2.id, 'quantity', 1)))); err := 'ok';
  exception when others then err := sqlerrm; end;
  select amount into amt from clinic_reception.invoices where order_id = o1;
  insert into pv_live(step, expected, actual, ok) values ('Hoda execute from «رئيسي أسنان»', 'ok; invoice = price + ' || it2.sale_price,
    err || ' · invoice ' || coalesce(amt::text, '-') || ' (price ' || svc.price || ')', err = 'ok' and amt = svc.price + round(it2.sale_price, 2));
  select string_agg(m.kind || ':' || (case when m.item_id = it1.id then 'item1' else 'item2' end), ',' order by m.kind) into note
    from clinic_reception.movements m where m.source_id = o1;
  insert into pv_live(step, expected, actual, ok) values ('stock movements of order 1', 'included:item1,sale:item2', coalesce(note, '-'), note = 'included:item1,sale:item2');
  insert into pv_live(step, expected, actual, ok) values ('executed by Hoda', 'audit performer_execute by Hoda',
    (select count(*)::text from clinic_reception.audit where action = 'performer_execute' and entity_id = o1 and actor_id = hoda.id),
    exists (select 1 from clinic_reception.audit where action = 'performer_execute' and entity_id = o1 and actor_id = hoda.id));
  begin r := public.clinic_reception_performer(ws, 'execute', jsonb_build_object('order_id', o2, 'no_materials', true, 'material_note', '')); err := 'accepted';
  exception when others then err := sqlerrm; end;
  insert into pv_live(step, expected, actual, ok) values ('Hoda «بدون مستلزمات» without a reason', 'refused «اكتب سبب»', err, err like '%اكتب سبب%');
  begin r := public.clinic_reception_performer(ws, 'execute', jsonb_build_object('order_id', o2, 'no_materials', true, 'material_note', 'تجربة تراجع — المريض رفض')); err := 'ok';
  exception when others then err := sqlerrm; end;
  select amount into amt from clinic_reception.invoices where order_id = o2;
  insert into pv_live(step, expected, actual, ok) values ('Hoda «بدون مستلزمات» with a reason', 'ok; invoice = price, no movements',
    err || ' · invoice ' || coalesce(amt::text, '-') || ' · moves ' || (select count(*) from clinic_reception.movements where source_id = o2),
    err = 'ok' and amt = svc.price and not exists (select 1 from clinic_reception.movements where source_id = o2));
  begin r := public.clinic_reception_vitals_kit(ws, 'list', '{}'); err := 'accepted';
  exception when others then err := sqlerrm; end;
  insert into pv_live(step, expected, actual, ok) values ('Hoda kit editor', 'refused (head nursing)', err, err like '%رئيسة التمريض%');

  -- B) vitals kit: head nursing (or a super admin) saves a sugar kit, Hoda records the triage
  select a.user_id into kit_uid from public.admins a where a.active and a.user_id is not null
     and (a.role = 'head_nursing' or exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role = 'head_nursing')) order by a.id limit 1;
  if kit_uid is null then select user_id into kit_uid from public.admins where role = 'super_admin' and active and user_id is not null order by id limit 1; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', kit_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', kit_uid::text, true);
  begin r := public.clinic_reception_vitals_kit(ws, 'save', jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('vital', 'sugar', 'item_id', it1.id, 'quantity', 1)))); err := 'ok · ' || jsonb_array_length(r->'kit') || ' line';
  exception when others then err := sqlerrm; end;
  insert into pv_live(step, expected, actual, ok) values ('head nursing / super admin saves the kit', 'ok · 1 line', err, err = 'ok · 1 line');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', hoda.user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', hoda.user_id::text, true);
  s0 := clinic_reception.stock_at(ws, it1.id, dent);
  begin r := public.clinic_reception_nursing(ws, 'triage_save', jsonb_build_object('appointment_id', appt, 'status', 'recorded', 'bp_sys', 120, 'bp_dia', 80,
      'sugar_mgdl', 110, 'vital_states', jsonb_build_object('bp', 'measured', 'sugar', 'measured', 'spo2', 'refused'))); err := 'ok';
  exception when others then err := sqlerrm; r := null; end;
  s1 := clinic_reception.stock_at(ws, it1.id, dent);
  insert into pv_live(step, expected, actual, ok) values ('Hoda triage recorded (sugar measured)', 'ok; sugar consumed; item1 −1 in «رئيسي أسنان»; no warning',
    err || ' · ' || coalesce((r->'vitals')::text, '-') || ' · stock ' || s0 || '→' || s1,
    err = 'ok' and r->'vitals'->'consumed' = '["sugar"]'::jsonb and jsonb_array_length(r->'vitals'->'warnings') = 0 and s1 = s0 - 1);
  select id into cid from clinic_reception.vitals_consumptions where appointment_id = appt and vital = 'sugar' and reversed_at is null;
  select string_agg(m.kind || ':' || (-m.quantity)::text, ',') into note from clinic_reception.movements m where m.source_id = cid;
  insert into pv_live(step, expected, actual, ok) values ('vitals movement', 'included:1 (cost only, never sale)', coalesce(note, '-'), note like 'included:1%' and note not like '%sale%');
  begin r := public.clinic_reception_nursing(ws, 'triage_save', jsonb_build_object('appointment_id', appt, 'status', 'recorded', 'bp_sys', 120, 'bp_dia', 80,
      'sugar_mgdl', 110, 'vital_states', jsonb_build_object('bp', 'measured', 'sugar', 'measured', 'spo2', 'refused'))); err := 'ok';
  exception when others then err := sqlerrm; r := null; end;
  insert into pv_live(step, expected, actual, ok) values ('Hoda re-save', 'nothing consumed again', err || ' · stock ' || clinic_reception.stock_at(ws, it1.id, dent),
    err = 'ok' and r->'vitals'->'consumed' = '[]'::jsonb and clinic_reception.stock_at(ws, it1.id, dent) = s1);
  begin r := public.clinic_reception_nursing(ws, 'triage_save', jsonb_build_object('appointment_id', appt, 'status', 'recorded', 'bp_sys', 120, 'bp_dia', 80,
      'vital_states', jsonb_build_object('bp', 'measured', 'sugar', 'refused', 'spo2', 'refused'))); err := 'ok';
  exception when others then err := sqlerrm; r := null; end;
  select coalesce(sum(l.debit - l.credit), 0) into j from clinic_reception.journal jj join clinic_reception.journal_lines l on l.entry_id = jj.id
   where l.account = '5123' and (jj.dimensions->>'order_id' = cid::text or (jj.dimensions->>'appointment_id' = appt::text and jj.dimensions->>'vital' = 'sugar'));
  insert into pv_live(step, expected, actual, ok) values ('Hoda: sugar → «رفض»', 'reversed; stock back; 5123 net 0',
    err || ' · ' || coalesce((r->'vitals'->'reversed')::text, '-') || ' · stock ' || clinic_reception.stock_at(ws, it1.id, dent) || ' · 5123 ' || j,
    err = 'ok' and r->'vitals'->'reversed' = '["sugar"]'::jsonb and clinic_reception.stock_at(ws, it1.id, dent) = s0 and j = 0);

  -- C) Mazen (reception) — not a performer
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  begin r := public.clinic_reception_performer(ws, 'today', '{}'); err := 'accepted';
  exception when others then err := sqlerrm; end;
  insert into pv_live(step, expected, actual, ok) values ('Mazen performer today', 'refused (not a performer)', err, err like '%بينفّذ الخدمة%');
  begin r := public.clinic_reception_nursing(ws, 'triage_save', jsonb_build_object('appointment_id', appt, 'status', 'recorded', 'spo2', 97)); err := 'accepted';
  exception when others then err := sqlerrm; end;
  insert into pv_live(step, expected, actual, ok) values ('Mazen triage_save', 'refused (nursing only)', err, err <> 'accepted');
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
select step, expected, actual, ok from pv_live order by n;
rollback;
