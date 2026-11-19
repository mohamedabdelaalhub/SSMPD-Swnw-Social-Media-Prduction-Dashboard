-- Reports center — wave 5 (owner request 2026-11-19): stock & pharmacy.
-- Single stock ledger: public.inventory_movements (live reception stock is mirrored there by clinic_reception.mirror_stock;
-- clinic_reception.movements.inventory_movement_id tells whether an outflow was «included» in a service or «sold» to the patient).
-- The pharmacy is just another store (owner decision): medicines = items whose store or category says أدوية/دواء.
-- Branch: inventory_locations.branch_id; the central store (no branch) is shown only under «كل الفروع».
-- Expected consumption for nursing variance = completed orders × the BOM frozen on the order (orders.snapshot->'bom', included=true).
begin;

insert into public.report_registry(code, title, area, sort, sensitive) values
  ('supplies_consumption', 'استهلاك المستلزمات لكل عيادة وإجراء', 'stock', 130, false),
  ('medicines_consumption','استهلاك الأدوية (الصيدلية)',          'stock', 135, false),
  ('stock_shortage_expiry','نواقص المخزن والصلاحية',              'stock', 140, false),
  ('nursing_variance',     'مطابقة مستهلكات التمريض مع الجلسات',   'stock', 145, false);

insert into public.report_access(report_code, role)
select r, x from (values
  ('supplies_consumption','general_manager'), ('supplies_consumption','financial_manager'), ('supplies_consumption','accountant'), ('supplies_consumption','head_nursing'),
  ('medicines_consumption','general_manager'), ('medicines_consumption','financial_manager'), ('medicines_consumption','accountant'), ('medicines_consumption','head_nursing'),
  ('stock_shortage_expiry','general_manager'), ('stock_shortage_expiry','financial_manager'), ('stock_shortage_expiry','accountant'), ('stock_shortage_expiry','head_nursing'),
  ('nursing_variance','general_manager'), ('nursing_variance','financial_manager'), ('nursing_variance','head_nursing')) v(r, x);

-- Stores in scope for a branch filter. Internal helper (not granted).
create function public.report_locations(p_branch uuid) returns table(location_id uuid, location text, location_kind text, branch_name text, is_pharmacy boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  select l.id, l.name, l.kind, coalesce(b.name, 'المخزن المركزي'), (l.name ~ '(ادوية|أدوية|دواء|صيدلية)')
    from public.inventory_locations l left join public.inventory_branches b on b.id = l.branch_id
   where p_branch is null or l.branch_id = p_branch
$$;
revoke all on function public.report_locations(uuid) from public, anon, authenticated;

-- Live reception stock movements that never reached public.inventory_movements (mirror link missing). Internal helper.
create function public.report_stock_health(p_branch uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('stock_unposted', (select count(*) from clinic_reception.movements rm
    join public.report_workspaces(p_branch) w on w.workspace_id = rm.workspace_id where rm.inventory_movement_id is null))
$$;
revoke all on function public.report_stock_health(uuid) from public, anon, authenticated;

-- Stock outflows with their reason. Internal helper (not granted).
create function public.report_stock_out(p_from date, p_to date, p_branch uuid)
returns table(day date, location_id uuid, location text, branch_name text, is_pharmacy boolean, item_id uuid, item text, category text, unit text,
              is_medicine boolean, reason text, quantity numeric, cost numeric, sale numeric, order_id uuid, service text, specialty text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select (m.occurred_at at time zone 'Africa/Cairo')::date, loc.location_id, loc.location, loc.branch_name, loc.is_pharmacy,
         i.id, i.name, i.category, i.base_unit,
         (loc.is_pharmacy or i.category ~ '(ادوية|أدوية|دواء|دوا)'),
         case when rm.kind = 'included' then 'included' when rm.kind = 'sale' or m.movement_type = 'sale' then 'sold'
              when m.movement_type in ('waste', 'expired') then m.movement_type when m.movement_type = 'transfer_out' then 'transfer'
              when m.movement_type = 'count_adjustment' then 'count' else 'issued' end,
         -m.quantity_delta, round(-m.quantity_delta * m.unit_cost, 2), round(-m.quantity_delta * m.unit_sale_price, 2),
         o.id, s.name, s.department
    from public.inventory_movements m
    join public.report_locations(p_branch) loc on loc.location_id = m.location_id
    join public.inventory_items i on i.id = m.item_id
    left join clinic_reception.movements rm on rm.inventory_movement_id = m.id
    left join clinic_reception.orders o on rm.kind = 'included' and o.id = rm.source_id
    left join clinic_reception.services s on s.id = o.service_id
   where m.quantity_delta < 0 and (m.occurred_at at time zone 'Africa/Cairo')::date between p_from and p_to
$$;
revoke all on function public.report_stock_out(date, date, uuid) from public, anon, authenticated;

-- ── Supplies consumption per store / item, and per procedure ──────────────────────────────────────────
create function public.report_supplies_consumption(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('supplies_consumption');
  perform public.report_check_period(p_from, p_to);
  with o as (select * from public.report_stock_out(p_from, p_to, p_branch) where reason <> 'transfer'),
  g as (
    select location, item, category, unit,
           coalesce(sum(quantity) filter (where reason = 'included'), 0) included_qty,
           coalesce(sum(quantity) filter (where reason = 'sold'), 0) sold_qty,
           coalesce(sum(quantity) filter (where reason = 'issued'), 0) issued_qty,
           coalesce(sum(quantity) filter (where reason in ('waste', 'expired', 'count')), 0) loss_qty,
           sum(cost) cost, coalesce(sum(sale) filter (where reason = 'sold'), 0) sales
      from o group by location, item, category, unit)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) order by cost desc, item) from g), '[]'::jsonb),
    'by_service', coalesce((select jsonb_agg(jsonb_build_object('service', service, 'specialty', specialty, 'orders', n, 'cost', c) order by c desc)
                              from (select service, specialty, count(distinct order_id) n, sum(cost) c from o where reason = 'included' and service is not null group by service, specialty) s), '[]'::jsonb),
    'totals', (select jsonb_build_object('cost', coalesce(sum(cost), 0), 'sales', coalesce(sum(sales), 0),
              'included_cost', coalesce((select sum(cost) from o where reason = 'included'), 0),
              'loss_cost', coalesce((select sum(cost) from o where reason in ('waste', 'expired', 'count')), 0), 'items', count(*)) from g))
    into v;
  return v || public.report_stock_health(p_branch);
end $$;

-- ── Medicines: included in the service vs sold to the patient ─────────────────────────────────────────
create function public.report_medicines_consumption(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('medicines_consumption');
  perform public.report_check_period(p_from, p_to);
  with o as (select * from public.report_stock_out(p_from, p_to, p_branch) where is_medicine and reason <> 'transfer'),
  g as (
    select item, unit, location,
           coalesce(sum(quantity) filter (where reason = 'included'), 0) included_qty,
           coalesce(sum(cost) filter (where reason = 'included'), 0) included_cost,
           coalesce(sum(quantity) filter (where reason = 'sold'), 0) sold_qty,
           coalesce(sum(cost) filter (where reason = 'sold'), 0) sold_cost,
           coalesce(sum(sale) filter (where reason = 'sold'), 0) sales,
           coalesce(sum(quantity) filter (where reason in ('waste', 'expired')), 0) wasted_qty,
           coalesce(sum(quantity) filter (where reason in ('issued', 'count')), 0) other_qty
      from o group by item, unit, location)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object('margin', round(sales - sold_cost, 2)) order by included_cost + sold_cost desc, item) from g), '[]'::jsonb),
    'totals', (select jsonb_build_object('included_cost', coalesce(sum(included_cost), 0), 'sold_cost', coalesce(sum(sold_cost), 0),
              'sales', coalesce(sum(sales), 0), 'margin', coalesce(sum(sales - sold_cost), 0), 'items', count(*)) from g))
    into v;
  return v || public.report_stock_health(p_branch);
end $$;

-- ── Shortages (on hand below minimum) and expiry (lots expiring within 60 days or expired) ─────────────
create function public.report_stock_shortage_expiry(p_as_of date default null, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_as_of, (now() at time zone 'Africa/Cairo')::date); v jsonb;
begin
  perform public.report_require('stock_shortage_expiry');
  with mv as (
    select m.item_id, m.location_id, m.lot_id, m.quantity_delta
      from public.inventory_movements m join public.report_locations(p_branch) l on l.location_id = m.location_id
     where (m.occurred_at at time zone 'Africa/Cairo')::date <= d),
  onhand as (select item_id, sum(quantity_delta) qty from mv group by item_id),
  short as (
    select i.name item, i.category, i.base_unit unit, coalesce(o.qty, 0) on_hand, i.minimum_quantity minimum, i.minimum_quantity - coalesce(o.qty, 0) gap
      from public.inventory_items i left join onhand o on o.item_id = i.id
     where i.active and i.minimum_quantity > 0 and coalesce(o.qty, 0) < i.minimum_quantity),
  lots as (
    select i.name item, l.lot_number, l.expiry_date, loc.location, sum(mv.quantity_delta) qty
      from mv join public.inventory_lots l on l.id = mv.lot_id join public.inventory_items i on i.id = l.item_id
      join public.report_locations(p_branch) loc on loc.location_id = mv.location_id
     where l.expiry_date is not null group by i.name, l.lot_number, l.expiry_date, loc.location
    having sum(mv.quantity_delta) > 0 and l.expiry_date <= d + 60)
  select jsonb_build_object(
    'as_of', d,
    'rows', coalesce((select jsonb_agg(to_jsonb(short) order by gap desc, item) from short), '[]'::jsonb),
    'expiry', coalesce((select jsonb_agg(jsonb_build_object('item', item, 'lot', lot_number, 'location', location, 'quantity', qty,
              'expiry_date', expiry_date, 'days_left', expiry_date - d) order by expiry_date, item) from lots), '[]'::jsonb),
    'totals', jsonb_build_object('short_items', (select count(*) from short),
              'expired_lots', (select count(*) from lots where expiry_date < d),
              'expiring_lots', (select count(*) from lots where expiry_date between d and d + 60)))
    into v;
  return v || public.report_stock_health(p_branch);
end $$;

-- ── Nursing variance: what the services should have used vs what was actually taken out ───────────────
create function public.report_nursing_variance(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('nursing_variance');
  perform public.report_check_period(p_from, p_to);
  with expected as (
    select ri.inventory_item_id item_id, sum((b->>'quantity')::numeric * ro.quantity) qty, count(distinct ro.id) orders
      from public.report_orders(p_from, p_to, p_branch) x
      join clinic_reception.orders ro on ro.id = x.order_id
      cross join lateral jsonb_array_elements(coalesce(ro.snapshot->'bom', '[]'::jsonb)) b
      join clinic_reception.items ri on ri.id = nullif(b->>'item_id', '')::uuid
     where coalesce((b->>'included')::boolean, true) and ri.inventory_item_id is not null
     group by ri.inventory_item_id),
  actual as (
    select item_id, coalesce(sum(quantity) filter (where reason = 'included'), 0) in_services,
           coalesce(sum(quantity) filter (where reason in ('issued', 'waste', 'expired', 'count')), 0) outside
      from public.report_stock_out(p_from, p_to, p_branch) group by item_id),
  g as (
    select i.name item, i.base_unit unit, coalesce(e.orders, 0) orders, round(coalesce(e.qty, 0), 3) expected,
           round(coalesce(a.in_services, 0), 3) in_services, round(coalesce(a.outside, 0), 3) outside,
           round(coalesce(a.in_services, 0) + coalesce(a.outside, 0) - coalesce(e.qty, 0), 3) variance,
           coalesce((select max(unit_cost) from public.inventory_lots l where l.item_id = i.id), (select max(m.unit_cost) from public.inventory_movements m where m.item_id = i.id and m.movement_type = 'receipt')) unit_cost
      from public.inventory_items i left join expected e on e.item_id = i.id left join actual a on a.item_id = i.id
     where coalesce(e.qty, 0) <> 0 or coalesce(a.in_services, 0) <> 0 or coalesce(a.outside, 0) <> 0)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) - 'unit_cost' || jsonb_build_object('variance_value', round(variance * coalesce(unit_cost, 0), 2))
              order by abs(variance * coalesce(unit_cost, 0)) desc, item) from g), '[]'::jsonb),
    'totals', (select jsonb_build_object('items', count(*), 'over_items', count(*) filter (where variance > 0), 'under_items', count(*) filter (where variance < 0),
              'variance_value', coalesce(round(sum(variance * coalesce(unit_cost, 0)), 2), 0)) from g))
    into v;
  return v || public.report_stock_health(p_branch);
end $$;

revoke all on function public.report_supplies_consumption(date, date, uuid), public.report_medicines_consumption(date, date, uuid),
  public.report_stock_shortage_expiry(date, uuid), public.report_nursing_variance(date, date, uuid) from public, anon;
grant execute on function public.report_supplies_consumption(date, date, uuid), public.report_medicines_consumption(date, date, uuid),
  public.report_stock_shortage_expiry(date, uuid), public.report_nursing_variance(date, date, uuid) to authenticated;

commit;
