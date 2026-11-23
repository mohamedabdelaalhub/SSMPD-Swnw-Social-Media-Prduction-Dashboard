-- Supplies flow (owner 2026-11-22, mockup docs/ui-references/mockups/inventory-supplies-flow.html — «الشكل تمام توكل علي الله»).
--
-- 1) Main stores. public.inventory_locations.is_main marks the stores a supplier invoice may enter («رئيسي أسنان»,
--    «رئيسي مستلزمات», «رئيسي أدوية»). The central store stays the one technical «central» row; dental and medicines
--    keep kind='substore' (no change to transfers, requests or the single-central index). Names/flags for the
--    existing rows are set by ops (supabase/ops/20261122_inventory_main_stores.sql), not here.
--
-- 2) Direct supplier invoice — public.inventory_direct_invoice(action, payload):
--      context            suppliers, main stores, active items
--      save {supplier_id, location_id, reference, invoice_date, document_url, lines[{item_id, quantity, package_cost,
--            lot_number, expiry_date, production_date, shelf_life_months, lot_code_missing}], token}
--    No hand-made postings: it creates an approved purchase request for exactly the invoice lines and calls the
--    existing public.inventory_receive_invoice (stock 1131 ← supplier payable 2111, supplier_events, unique supplier
--    reference, retry token). When the chosen main store is not the central one, the receipt movements created in the
--    same transaction are booked to that store (location only — quantities, costs and postings are unchanged).
--    Same permission as today's receiving: manager of the central store.
--
-- 3) «استهلاك أمس» — public.clinic_reception_visit_usage(workspace, action, payload):
--      list {day}   visits opened that Cairo day (default yesterday, last 14 days only), each non-cancelled service order
--                   with what was already recorded (this screen or the service BOM), plus the stores and items to pick.
--      save {visit_id, order_id, none, lines[{item_id, location_id, quantity}], token}
--                   one record per service order. Lines are consumed FEFO by clinic_reception.consume(...,'included',order)
--                   — cost at actual purchase cost, posted 5123 ← 1131 — exactly like a service BOM. Only stock held in
--                   lots can be consumed (the reception bridge works per lot), so «stock» in the list counts lots only.
--                   «none» records
--                   «مفيش مستلزمات» with no stock movement. Retry-safe through clinic_reception.commands.
--    Access = reception «collect» on the live workspace (owner: reception records it the next morning).
--
-- Rollback: supabase/rollbacks/20261122270000_inventory_supplies_flow.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.visit_usage') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- ---------------------------------------------------------------- 1) main stores
alter table public.inventory_locations add column is_main boolean not null default false;
update public.inventory_locations set is_main = true where kind = 'central';

-- ---------------------------------------------------------------- 2) direct supplier invoice
create function public.inventory_direct_invoice(p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  central constant uuid := '00000000-0000-4000-8000-000000000001';
  me uuid := public.my_admin_id();
  sup public.inventory_suppliers%rowtype; loc public.inventory_locations%rowtype; it public.inventory_items%rowtype;
  tok uuid; prev clinic_finance.supplier_receipts%rowtype; req uuid; rec uuid; r jsonb;
  lines jsonb := '[]'; reqlines jsonb := '[]'; q numeric; pc numeric; uc numeric; total numeric := 0; moved int := 0;
begin
  if me is null or not public.inventory_location_can(central, 'manage') then
    raise exception 'فاتورة المورد لمسؤول المخزن الرئيسي' using errcode = '42501';
  end if;

  if p_action = 'context' then
    return jsonb_build_object(
      'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name), '[]')
                      from public.inventory_suppliers s where s.active),
      'locations', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'central', l.kind = 'central')
                                              order by l.kind = 'central' desc, l.name), '[]')
                      from public.inventory_locations l where l.active and l.is_main),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.base_unit,
                                          'units_per_pack', i.units_per_pack, 'track_lots', i.track_lots) order by i.name), '[]')
                  from public.inventory_items i where i.active));
  end if;

  if p_action <> 'save' then raise exception 'إجراء غير معروف'; end if;

  tok := nullif(p_payload->>'token', '')::uuid;
  if tok is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 60000 then
    raise exception 'طلب غير صالح';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text || tok::text, 0));
  -- Retry of an already saved invoice: same answer, nothing posted twice.
  select * into prev from clinic_finance.supplier_receipts where created_by = me and token = tok;
  if found then
    return jsonb_build_object('id', prev.id, 'order_id', prev.order_id, 'reference', prev.reference, 'total', prev.invoice_total, 'repeat', true);
  end if;

  select * into sup from public.inventory_suppliers where id = nullif(p_payload->>'supplier_id', '')::uuid and active;
  if not found then raise exception 'اختار مورد مسجل ونشط'; end if;
  select * into loc from public.inventory_locations where id = nullif(p_payload->>'location_id', '')::uuid and active and is_main;
  if not found then raise exception 'اختار مخزن رئيسي'; end if;
  if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 30 then
    raise exception 'أضف من 1 لـ 30 صنف';
  end if;
  if (select count(distinct x->>'item_id') from jsonb_array_elements(p_payload->'lines') x) <> jsonb_array_length(p_payload->'lines') then
    raise exception 'الصنف متكرر في الفاتورة؛ اجمع كميته في سطر واحد';
  end if;

  for r in select * from jsonb_array_elements(p_payload->'lines') loop
    select * into it from public.inventory_items where id = nullif(r->>'item_id', '')::uuid and active;
    if not found then raise exception 'صنف غير موجود في الفاتورة'; end if;
    q := nullif(r->>'quantity', '')::numeric; pc := nullif(r->>'package_cost', '')::numeric;
    if q is null or q <= 0 or q <> round(q, 3) or pc is null or pc < 0 or pc::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'راجع كمية وسعر «%»', it.name;
    end if;
    uc := round(pc / it.units_per_pack, 4);
    total := total + round(q * pc / it.units_per_pack, 2);
    -- Receipt line (quantity in the item's dispensing unit, cost per package — same contract as inventory_receive_invoice).
    lines := lines || jsonb_build_array(jsonb_build_object('item_id', it.id, 'quantity', q, 'package_cost', pc,
      'lot_number', trim(coalesce(r->>'lot_number', '')), 'lot_code_missing', coalesce((r->>'lot_code_missing')::boolean, false),
      'production_date', nullif(r->>'production_date', ''), 'shelf_life_months', nullif(r->>'shelf_life_months', ''),
      'expiry_date', nullif(r->>'expiry_date', '')));
    -- Request line carries the same unit cost, so the receive price check passes without a second approval.
    reqlines := reqlines || jsonb_build_array(jsonb_build_object('item_id', it.id, 'quantity', q, 'unit_cost', uc,
      'lot_code_missing', coalesce((r->>'lot_code_missing')::boolean, false),
      'production_date', nullif(r->>'production_date', ''), 'shelf_life_months', nullif(r->>'shelf_life_months', ''),
      'expiry_date', nullif(r->>'expiry_date', '')));
  end loop;

  -- An approved purchase request for exactly this invoice (owner: a supplier invoice needs no prior request).
  req := public.inventory_create_request('purchase', 'فاتورة مورد مباشرة ' || left(trim(coalesce(p_payload->>'reference', '')), 120), sup.name, reqlines);
  update public.inventory_requests
     set status = 'approved', reviewer_id = me, reviewed_at = now(), review_note = 'فاتورة مورد مباشرة — بدون طلب شراء مسبق'
   where id = req;

  rec := public.inventory_receive_invoice(req, lines, p_payload->>'reference', nullif(p_payload->>'invoice_date', '')::date,
                                          coalesce(p_payload->>'document_url', ''), tok);

  if loc.id <> central then
    update public.inventory_movements set location_id = loc.id
     where reference_type = 'purchase' and reference_id = req and movement_type = 'receipt' and location_id = central;
    get diagnostics moved = row_count;
    if moved = 0 then raise exception 'تعذر إدخال الفاتورة على المخزن المختار'; end if;
  end if;

  insert into public.inventory_audit_events(entity_id, kind, actor_id, detail)
    values (rec, 'direct_supplier_invoice', me, 'المخزن: ' || loc.name || ' — المورد: ' || sup.name || ' — فاتورة ' || trim(p_payload->>'reference'));
  return jsonb_build_object('id', rec, 'order_id', req, 'reference', trim(p_payload->>'reference'), 'total', total,
                            'location', loc.name, 'supplier', sup.name, 'repeat', false);
end $$;
revoke all on function public.inventory_direct_invoice(text, jsonb) from public, anon;
grant execute on function public.inventory_direct_invoice(text, jsonb) to authenticated;

-- ---------------------------------------------------------------- 3) «استهلاك أمس»
create table clinic_reception.visit_usage(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  visit_id uuid not null references clinic_reception.visits(id),
  order_id uuid not null unique references clinic_reception.orders(id),
  service_day date not null,
  status text not null check (status in ('recorded', 'none')),
  total_cost numeric(14,2) not null default 0 check (total_cost >= 0),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now()
);
create index visit_usage_day_idx on clinic_reception.visit_usage(workspace_id, service_day);
create table clinic_reception.visit_usage_lines(
  id uuid primary key default gen_random_uuid(),
  usage_id uuid not null references clinic_reception.visit_usage(id),
  item_id uuid not null references public.inventory_items(id),
  location_id uuid not null references public.inventory_locations(id),
  quantity numeric(14,3) not null check (quantity > 0),
  cost numeric(14,2) not null check (cost >= 0),
  unique (usage_id, item_id, location_id)
);
alter table clinic_reception.visit_usage enable row level security;
alter table clinic_reception.visit_usage_lines enable row level security;
revoke all on clinic_reception.visit_usage, clinic_reception.visit_usage_lines from public, anon, authenticated;

create function public.clinic_reception_visit_usage(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid; today date := (now() at time zone 'Africa/Cairo')::date; v_day date; tok uuid;
  prev clinic_reception.commands%rowtype; vis clinic_reception.visits%rowtype; ord clinic_reception.orders%rowtype;
  pat clinic_reception.patients%rowtype; svc text; u uuid; r jsonb; it public.inventory_items%rowtype; rx uuid; rloc uuid;
  q numeric; c numeric; total numeric := 0; outcome jsonb; v_rows jsonb;
begin
  me := clinic_reception.access(p_workspace, 'collect');
  if not exists (select 1 from clinic_reception.workspaces where id = p_workspace and mode = 'live') then
    raise exception 'استخدم مساحة الاستقبال المتصلة';
  end if;

  if p_action = 'list' then
    v_day := coalesce(nullif(p_payload->>'day', '')::date, today - 1);
    if v_day > today or v_day < today - 14 then raise exception 'اختار يوم من آخر 14 يوم'; end if;
    perform clinic_reception.sync_native_links(p_workspace);
    with o as (
      select v.id visit_id, v.visit_no, v.opened_at, p.name patient, p.file_no, od.id order_id, od.status order_status,
             coalesce(s.name, od.snapshot->>'name', 'خدمة') service, coalesce(s.department, od.snapshot->>'department', '') department,
             pr.name provider, od.quantity,
             vu.status usage_status, vu.total_cost, vu.created_at usage_at, a.name usage_by,
             (select coalesce(sum(-m.quantity * m.unit_cost), 0) from clinic_reception.movements m
               where m.workspace_id = p_workspace and m.source_id = od.id and m.kind = 'included') bom_cost,
             (select coalesce(jsonb_agg(jsonb_build_object('item', i.name, 'unit', i.base_unit, 'location', l.name,
                       'quantity', ul.quantity, 'cost', ul.cost) order by i.name), '[]')
                from clinic_reception.visit_usage_lines ul join public.inventory_items i on i.id = ul.item_id
                join public.inventory_locations l on l.id = ul.location_id where ul.usage_id = vu.id) usage_lines
        from clinic_reception.visits v
        join clinic_reception.patients p on p.id = v.patient_id
        join clinic_reception.orders od on od.visit_id = v.id and od.status <> 'cancelled'
        left join clinic_reception.services s on s.id = od.service_id
        left join clinic_reception.providers pr on pr.id = od.provider_id
        left join clinic_reception.visit_usage vu on vu.order_id = od.id
        left join public.admins a on a.id = vu.created_by
       where v.workspace_id = p_workspace and (v.opened_at at time zone 'Africa/Cairo')::date = v_day
    )
    select coalesce(jsonb_agg(jsonb_build_object('visit_id', x.visit_id, 'visit_no', x.visit_no,
             'time', to_char(x.opened_at at time zone 'Africa/Cairo', 'HH24:MI'), 'patient', x.patient, 'file_no', x.file_no,
             'orders', x.orders, 'done', x.done) order by x.opened_at), '[]')
      into v_rows
      from (select o.visit_id, o.visit_no, o.opened_at, o.patient, o.file_no,
                   bool_and(o.usage_status is not null or o.bom_cost > 0) done,
                   jsonb_agg(jsonb_build_object('order_id', o.order_id, 'service', o.service, 'department', o.department,
                     'provider', o.provider, 'quantity', o.quantity, 'order_status', o.order_status,
                     'usage_status', o.usage_status, 'total_cost', o.total_cost, 'usage_by', o.usage_by,
                     'usage_time', to_char(o.usage_at at time zone 'Africa/Cairo', 'HH24:MI'), 'lines', o.usage_lines,
                     'bom_cost', round(o.bom_cost, 2)) order by o.service) orders
              from o group by o.visit_id, o.visit_no, o.opened_at, o.patient, o.file_no) x;
    return jsonb_build_object('day', v_day, 'rows', v_rows,
      'counts', jsonb_build_object('all', jsonb_array_length(v_rows),
        'done', (select count(*) from jsonb_array_elements(v_rows) e where (e->>'done')::boolean),
        'missing', (select count(*) from jsonb_array_elements(v_rows) e where not (e->>'done')::boolean),
        'cost', (select coalesce(sum(vu.total_cost), 0) from clinic_reception.visit_usage vu
                  where vu.workspace_id = p_workspace and vu.service_day = v_day)),
      'locations', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'main', l.is_main) order by l.is_main desc, l.name), '[]')
                      from public.inventory_locations l where l.active),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.base_unit,
                  'stock', (select coalesce(jsonb_object_agg(m.location_id, m.qty), '{}') from
                             (select location_id, sum(quantity_delta) qty from public.inventory_movements
                               where item_id = i.id and lot_id is not null group by location_id having sum(quantity_delta) > 0) m),
                  'cost', round(coalesce((select sum(quantity_delta * unit_cost) / nullif(sum(quantity_delta), 0)
                                            from public.inventory_movements where item_id = i.id), 0), 2)) order by i.name), '[]')
                  from public.inventory_items i where i.active));
  end if;

  if p_action <> 'save' then raise exception 'إجراء غير معروف'; end if;

  tok := nullif(p_payload->>'token', '')::uuid;
  if tok is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 20000 then
    raise exception 'طلب غير صالح';
  end if;
  perform 1 from clinic_reception.workspaces where id = p_workspace for update;
  select * into prev from clinic_reception.commands where workspace_id = p_workspace and actor_id = me and token = tok;
  if found then
    if prev.action <> 'visit_usage' or prev.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر'; end if;
    return prev.response;
  end if;
  perform clinic_finance.lock_day();

  select * into vis from clinic_reception.visits where id = nullif(p_payload->>'visit_id', '')::uuid and workspace_id = p_workspace;
  if not found then raise exception 'الزيارة مش موجودة'; end if;
  v_day := (vis.opened_at at time zone 'Africa/Cairo')::date;
  if v_day > today or v_day < today - 14 then raise exception 'الزيارة أقدم من 14 يوم؛ راجع مسؤول المخزن'; end if;
  select * into ord from clinic_reception.orders where id = nullif(p_payload->>'order_id', '')::uuid and visit_id = vis.id
     and workspace_id = p_workspace and status <> 'cancelled' for update;
  if not found then raise exception 'الخدمة مش ضمن الزيارة دي'; end if;
  if exists (select 1 from clinic_reception.visit_usage where order_id = ord.id) then
    raise exception 'استهلاك الخدمة دي اتسجل قبل كده';
  end if;
  select * into pat from clinic_reception.patients where id = vis.patient_id;
  select coalesce(s.name, ord.snapshot->>'name', 'خدمة') into svc from clinic_reception.services s where s.id = ord.service_id;
  svc := coalesce(svc, 'خدمة');

  if coalesce((p_payload->>'none')::boolean, false) then
    if jsonb_array_length(coalesce(p_payload->'lines', '[]')) > 0 then raise exception 'اختار «مفيش مستلزمات» أو اكتب المستلزمات، مش الاتنين'; end if;
    insert into clinic_reception.visit_usage(workspace_id, visit_id, order_id, service_day, status, total_cost, created_by)
      values (p_workspace, vis.id, ord.id, v_day, 'none', 0, me) returning id into u;
  else
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 30 then
      raise exception 'أضف المستلزمات (من 1 لـ 30) أو اختار «مفيش مستلزمات»';
    end if;
    if (select count(distinct (x->>'item_id') || '|' || (x->>'location_id')) from jsonb_array_elements(p_payload->'lines') x)
       <> jsonb_array_length(p_payload->'lines') then raise exception 'المستلزم متكرر؛ اجمع الكمية في سطر واحد'; end if;
    perform clinic_reception.sync_native_links(p_workspace);
    perform clinic_reception.sync_stock(p_workspace);
    insert into clinic_reception.visit_usage(workspace_id, visit_id, order_id, service_day, status, total_cost, created_by)
      values (p_workspace, vis.id, ord.id, v_day, 'recorded', 0, me) returning id into u;
    for r in select * from jsonb_array_elements(p_payload->'lines') loop
      select * into it from public.inventory_items where id = nullif(r->>'item_id', '')::uuid and active;
      if not found then raise exception 'مستلزم غير موجود'; end if;
      q := clinic_reception.number(r->>'quantity', 3);
      if q is null or q <= 0 then raise exception 'راجع كمية «%»', it.name; end if;
      select id into rx from clinic_reception.items where workspace_id = p_workspace and inventory_item_id = it.id;
      select id into rloc from clinic_reception.locations where workspace_id = p_workspace and inventory_location_id = nullif(r->>'location_id', '')::uuid;
      if rx is null or rloc is null then raise exception 'تعذر قراءة ربط «%» أو المخزن', it.name; end if;
      c := clinic_reception.consume(p_workspace, rx, rloc, q, 'included', ord.id);
      insert into clinic_reception.visit_usage_lines(usage_id, item_id, location_id, quantity, cost)
        values (u, it.id, (r->>'location_id')::uuid, q, c);
      total := total + c;
    end loop;
    update clinic_reception.visit_usage set total_cost = total where id = u;
    update public.inventory_movements
       set note = 'استهلاك خدمة ' || svc || ' — ملف ' || pat.file_no || ' / زيارة ' || vis.visit_no || ' — يوم ' || to_char(v_day, 'YYYY-MM-DD')
     where id in (select inventory_movement_id from clinic_reception.movements
                   where workspace_id = p_workspace and source_id = ord.id and kind = 'included' and inventory_movement_id is not null
                     and created_at = transaction_timestamp());
  end if;

  outcome := jsonb_build_object('id', u, 'order_id', ord.id, 'status', (select status from clinic_reception.visit_usage where id = u),
                                'total_cost', total, 'day', v_day);
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'visit_usage', u, p_payload || outcome);
  insert into clinic_reception.commands values (p_workspace, me, tok, 'visit_usage', p_payload, outcome);
  return outcome;
end $$;
revoke all on function public.clinic_reception_visit_usage(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_visit_usage(uuid, text, jsonb) to authenticated;

commit;
