-- Button rule check (owner 2026-11-23): every inventory/medicines/reception button added by #756/#758 must work for
-- the users who SEE it, and stay hidden for those who would be refused. This runs every button's RPC as EVERY active
-- connected admin (impersonated as authenticated), compares "would the UI show it?" with "did the RPC pass?", and
-- prints one row per (button, admin). (test.admin is only read by the PGlite harness; harmless on live.) All fixtures and writes ROLL BACK. Read the result table; ok=false rows are bugs.
begin;
create temp table _btn(button text, rpc text, admin_name text, role text, shown boolean, passed boolean, err text) on commit drop;
do $$
declare
  central constant uuid := '00000000-0000-4000-8000-000000000001';
  w uuid; me uuid; ref text := 'TEST-BTN-' || gen_random_uuid(); pr uuid; sv uuid; rp uuid; person uuid; sup uuid; it uuid; lot uuid;
  a record; app uuid; vis uuid; ord uuid; res jsonb; shown boolean; ok boolean; e text; can_mgr boolean; can_create boolean; can_review boolean;
  disc uuid; disc_by uuid; sub uuid; v_view boolean; ou uuid; slot int := 0;
begin
  select id, owner_id into w, me from clinic_reception.workspaces where mode = 'live';
  select id into sub from public.inventory_locations where name = 'فرعي مستلزمات تمريض' and active;
  -- fixtures (owner context)
  -- live patient guard (psychcare.check_basics): 2+ word letters-only name, valid phone, age 0-130; random phone avoids the duplicate guard
  insert into public.patients(full_name, phone, age, created_by) values ('اختبار ازرار المخزن', '010' || lpad((floor(random() * 1e8))::bigint::text, 8, '0'), 30, me) returning id into person;
  insert into clinic_reception.patients(workspace_id, patient_id, file_no, name, phone, created_by)
    select w, id, patient_code, full_name, phone, me from public.patients where id = person returning id into rp;
  insert into clinic_reception.providers(workspace_id, name, department, branch) values (w, ref, 'اختبار متراجع', 'اختبار') returning id into pr;
  insert into clinic_reception.services(workspace_id, code, name, department, price, minutes) values (w, ref, ref, 'اختبار متراجع', 100, 20) returning id into sv;
  insert into public.inventory_suppliers(name, active) values (ref, true) returning id into sup;
  insert into public.inventory_items(sku, name, category, base_unit, units_per_pack, markup_percent, current_sale_price, created_by)
    values (ref, ref, 'اختبار', 'قطعة', 1, 0, 2, me) returning id into it;
  insert into public.inventory_lots(item_id, lot_number, expiry_date, received_quantity, unit_cost, created_by)
    values (it, ref, current_date + 365, 1000, 2, me) returning id into lot;
  insert into public.inventory_movements(item_id, location_id, lot_id, movement_type, quantity_delta, unit_cost, reference_type, created_by)
    values (it, coalesce(sub, central), lot, 'opening_balance', 1000, 2, 'opening', me);
  -- one supplier invoice this month (as the owner), so «خصم آخر الشهر» has a basis for every creator
  select user_id into ou from public.admins where id = me;
  perform set_config('request.jwt.claim.sub', ou::text, true); perform set_config('test.admin', me::text, true);
  execute 'set local role authenticated';
  perform public.inventory_direct_invoice('save', jsonb_build_object('supplier_id', sup, 'location_id', central, 'reference', ref || '-base',
          'invoice_date', current_date, 'lines', jsonb_build_array(jsonb_build_object('item_id', it, 'quantity', 10, 'package_cost', 2)), 'token', gen_random_uuid()));
  execute 'reset role';

  for a in select ad.id, ad.name, ad.role, ad.user_id from public.admins ad where ad.active and ad.user_id is not null order by ad.role, ad.name loop
    perform set_config('request.jwt.claim.sub', a.user_id::text, true); perform set_config('test.admin', a.id::text, true);
    -- one visit + order per admin, so each save has its own target
    insert into clinic_reception.appointments(workspace_id, patient_id, provider_id, service_id, starts_at, ends_at, created_by)
      values (w, rp, pr, sv, now() + slot * interval '30 minutes', now() + slot * interval '30 minutes' + interval '20 minutes', me) returning id into app;
    slot := slot + 1;   -- live guard appointments_respect_gap: ≥5 min between bookings of the same doctor
    insert into clinic_reception.visits(workspace_id, appointment_id, patient_id, opened_by) values (w, app, rp, me) returning id into vis;
    insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, price, snapshot, created_by)
      values (w, vis, sv, pr, 100, jsonb_build_object('name', ref, 'department', 'اختبار متراجع', 'bom', '[]'::jsonb), me) returning id into ord;
    execute 'set local role authenticated';

    -- «استهلاك أمس» card: shown to anyone who can view the live workspace; save buttons only when can_save
    shown := false; ok := false; e := null;
    begin res := public.clinic_reception_visit_usage(w, 'list', jsonb_build_object('day', current_date)); shown := true; ok := true;
    exception when others then e := sqlerrm; end;
    execute 'reset role';
    insert into _btn values ('استهلاك أمس (القايمة)', 'clinic_reception_visit_usage list', a.name, a.role, shown, ok, e);
    if shown then
      shown := coalesce((res->>'can_save')::boolean, false); ok := false; e := null;
      execute 'set local role authenticated';
      begin perform public.clinic_reception_visit_usage(w, 'save', jsonb_build_object('visit_id', vis, 'order_id', ord, 'none', false,
              'lines', jsonb_build_array(jsonb_build_object('item_id', it, 'location_id', coalesce(sub, central), 'quantity', 1)), 'token', gen_random_uuid())); ok := true;
      exception when others then e := sqlerrm; end;
      execute 'reset role';
      insert into _btn values ('حفظ استهلاك الخدمة', 'clinic_reception_visit_usage save', a.name, a.role, shown, ok, e);
    end if;

    -- inventory buttons: shown when the user manages the CENTRAL store view (or is an inventory manager)
    can_mgr := public.inventory_is_manager() or public.inventory_location_can(central, 'manage');   -- evaluated for this user (claims set)
    execute 'set local role authenticated';
    ok := false; e := null;
    begin perform public.inventory_direct_invoice('save', jsonb_build_object('supplier_id', sup, 'location_id', central, 'reference', ref || '-' || a.id,
            'invoice_date', current_date, 'lines', jsonb_build_array(jsonb_build_object('item_id', it, 'quantity', 1, 'package_cost', 2)), 'token', gen_random_uuid())); ok := true;
    exception when others then e := sqlerrm; end;
    execute 'reset role';
    insert into _btn values ('+ فاتورة مورد مباشرة', 'inventory_direct_invoice save', a.name, a.role, can_mgr, ok, e);
    execute 'set local role authenticated';
    ok := false; e := null;
    begin perform public.inventory_pricing_list(); perform public.inventory_set_pricing_kind(it, 'supply', 35); ok := true;
    exception when others then e := sqlerrm; end;
    execute 'reset role';
    insert into _btn values ('تسعير الأصناف', 'inventory_pricing_list + set_pricing_kind', a.name, a.role, can_mgr, ok, e);

    -- finance: «خصم آخر الشهر» create (shown when can_create) and «تقرير الأدوية» (view)
    can_create := clinic_finance.allowed('create'); can_review := clinic_finance.allowed('review'); v_view := clinic_finance.allowed('view');
    execute 'set local role authenticated';
    ok := false; e := null;
    begin perform public.clinic_finance_supplier_discount('report', '{}'); ok := true; exception when others then e := sqlerrm; end;
    execute 'reset role';
    insert into _btn values ('تقرير الأدوية', 'clinic_finance_supplier_discount report', a.name, a.role, v_view, ok, e);
    if disc is null then
      execute 'set local role authenticated';
      ok := false; e := null;
      begin res := public.clinic_finance_supplier_discount('create', jsonb_build_object('supplier_id', sup, 'month', date_trunc('month', current_date)::date, 'amount', 0.01, 'token', gen_random_uuid()));
            ok := true; disc := (res->>'id')::uuid; disc_by := a.id;
      exception when others then e := sqlerrm; end;
      execute 'reset role';
      insert into _btn values ('إرسال للمراجعة (خصم آخر الشهر)', 'clinic_finance_supplier_discount create', a.name, a.role, can_create, ok, e);
    end if;
  end loop;

  -- review: every financial-manager-capable user other than the creator
  if disc is not null then
    for a in select ad.id, ad.name, ad.role, ad.user_id from public.admins ad where ad.active and ad.user_id is not null and ad.id <> disc_by order by ad.role, ad.name loop
      perform set_config('request.jwt.claim.sub', a.user_id::text, true); perform set_config('test.admin', a.id::text, true);
      can_review := clinic_finance.allowed('review'); ok := false; e := null;
      execute 'set local role authenticated';
      begin
        -- savepoint semantics: a successful approve is undone right away so the next reviewer still sees «pending»
        begin perform public.clinic_finance_supplier_discount('review', jsonb_build_object('id', disc, 'approve', true)); ok := true; raise exception 'undo';
        exception when others then if sqlerrm <> 'undo' then e := sqlerrm; end if; end;
      end;
      execute 'reset role';
      insert into _btn values ('اعتماد (خصم آخر الشهر)', 'clinic_finance_supplier_discount review', a.name, a.role, can_review, ok, e);
    end loop;
  end if;
end $$;
select button, rpc, admin_name, role, shown, passed, (shown = passed) as ok, left(err, 120) as error from _btn order by (shown = passed), button, role, admin_name;
rollback;
