-- Medicines store (owner 2026-11-22 «طبقه», mockup docs/ui-references/mockups/medicines-store.html).
--
-- 1) Pricing kind per item — public.inventory_items.pricing_kind:
--      supply    (default) sale = purchase cost + markup; the standard markup is 35% (set from «هامش الربح الموحّد»),
--                or a per-item %.
--      medicine  the supplier invoices at the public price → purchase cost = public price = sale price. Markup is
--                forced to 0 by a trigger, so «هامش الربح الموحّد … على كل الأصناف» can never mark a medicine up.
--      shortage  «دواء ناقص»: bought at its real price, sold at cost + margin (default 35%, per item), and excluded
--                from the month-end supplier discount.
--    public.inventory_set_pricing_kind(item, kind, markup) and public.inventory_pricing_list() — inventory manager /
--    central-store manager.
--
-- 2) Month-end supplier discount — clinic_finance.supplier_month_discounts:
--    public.clinic_finance_supplier_discount(action, payload):
--      preview {supplier_id, month}     the month's supplier invoices (by invoice date) with total, shortage part
--                                       (excluded) and the discount basis.
--      create  {supplier_id, month, percent | amount, document_url, note, token}   accountant («create» right).
--                                       One open/approved document per supplier+month. Amount ≤ basis.
--      review  {id, approve, note}      «المدير المالي» only (clinic_finance.allowed('review')), never the creator.
--                                       Approve → Dr 2111 supplier payable / Cr 4118 «خصم مشتريات مكتسب» and a negative
--                                       supplier_events row (the supplier balance drops). Item costs are NOT revalued:
--                                       most of the month's medicines are already sold when the discount arrives.
--      list    {month?}                 documents.
--      report  {month}                  medicines sales/cost by kind, discounts per supplier, suppliers still without
--                                       a discount for the month.
-- Rollback: supabase/rollbacks/20261122300000_medicines_pricing_discount.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.supplier_month_discounts') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- ---------------------------------------------------------------- 1) pricing kind
alter table public.inventory_items add column pricing_kind text not null default 'supply'
  check (pricing_kind in ('supply', 'medicine', 'shortage'));

-- A medicine is always sold at the price it was bought at (the public price). Any write that puts a markup on it —
-- including «apply the standard markup to every item» — is brought back to 0 with the matching price.
create function public.inventory_medicine_no_markup() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare base numeric;
begin
  if new.pricing_kind = 'medicine' and new.markup_percent <> 0 then
    base := clinic_finance.inventory_highest_purchase(new.id);
    if base is null then base := round(new.current_sale_price / (1 + new.markup_percent / 100), 2); end if;
    new.markup_percent := 0;
    new.current_sale_price := round(base, 2);
  end if;
  return new;
end $$;
create trigger inventory_medicine_no_markup before insert or update on public.inventory_items
  for each row execute function public.inventory_medicine_no_markup();

create function public.inventory_set_pricing_kind(p_item uuid, p_kind text, p_markup numeric default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); i public.inventory_items%rowtype; m numeric; base numeric; price numeric;
begin
  if me is null or not (public.inventory_is_manager() or public.inventory_location_can('00000000-0000-4000-8000-000000000001', 'manage')) then
    raise exception 'تسعير الأصناف لمسؤول المخزن' using errcode = '42501';
  end if;
  if p_kind not in ('supply', 'medicine', 'shortage') then raise exception 'نوع التسعير غير معروف'; end if;
  select * into i from public.inventory_items where id = p_item and active for update;
  if not found then raise exception 'الصنف غير موجود'; end if;
  m := case when p_kind = 'medicine' then 0 else coalesce(p_markup, 35) end;
  if m < 0 or m > 1000 or m::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'راجع نسبة الربح'; end if;
  base := coalesce(clinic_finance.inventory_highest_purchase(i.id),
                   round(i.current_sale_price / (1 + i.markup_percent / 100), 4), 0);
  price := round(base * (1 + m / 100), 2);
  if price <> i.current_sale_price or m <> i.markup_percent then
    insert into public.inventory_price_history(item_id, previous_price, new_price, previous_markup, new_markup, changed_by)
      values (i.id, i.current_sale_price, price, i.markup_percent, m, me);
  end if;
  update public.inventory_items set pricing_kind = p_kind, markup_percent = m, current_sale_price = price, updated_at = now() where id = i.id;
  insert into public.inventory_audit_events(entity_id, kind, actor_id, detail)
    values (i.id, 'pricing_kind', me, p_kind || ' — ' || m || '%');
  return jsonb_build_object('id', i.id, 'pricing_kind', p_kind, 'markup_percent', m, 'sale_price', price);
end $$;
revoke all on function public.inventory_set_pricing_kind(uuid, text, numeric) from public, anon;
grant execute on function public.inventory_set_pricing_kind(uuid, text, numeric) to authenticated;
revoke all on function public.inventory_medicine_no_markup() from public, anon, authenticated;

create function public.inventory_pricing_list() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if public.my_admin_id() is null or not (public.inventory_is_manager() or public.inventory_location_can('00000000-0000-4000-8000-000000000001', 'manage')) then
    raise exception 'تسعير الأصناف لمسؤول المخزن' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'category', i.category, 'unit', i.base_unit,
            'pricing_kind', i.pricing_kind, 'markup_percent', i.markup_percent, 'sale_price', i.current_sale_price,
            'purchase_price', clinic_finance.inventory_highest_purchase(i.id)) order by i.category, i.name), '[]')
            from public.inventory_items i where i.active);
end $$;
revoke all on function public.inventory_pricing_list() from public, anon;
grant execute on function public.inventory_pricing_list() to authenticated;

-- ---------------------------------------------------------------- 2) month-end supplier discount
insert into clinic_finance.accounts(code, name, kind) values ('4118', 'خصم مشتريات مكتسب من الموردين', 'income') on conflict do nothing;

create table clinic_finance.supplier_month_discounts(
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id),
  month date not null check (month = date_trunc('month', month)::date),
  basis numeric(14,2) not null check (basis > 0),
  percent numeric(6,3) check (percent is null or (percent > 0 and percent <= 100)),
  amount numeric(14,2) not null check (amount > 0),
  invoices jsonb not null,
  document_url text not null default '' check (length(document_url) <= 2000),
  note text not null default '' check (length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.admins(id),
  reviewed_at timestamptz,
  review_note text not null default '',
  token uuid not null,
  unique (created_by, token),
  check (amount <= basis)
);
create unique index supplier_month_discount_open on clinic_finance.supplier_month_discounts(supplier_id, month) where status <> 'rejected';
alter table clinic_finance.supplier_month_discounts enable row level security;
revoke all on clinic_finance.supplier_month_discounts from public, anon, authenticated;

-- The month's invoices of one supplier, with the shortage-medicine part excluded from the discount basis.
create function clinic_finance.supplier_month_invoices(p_supplier uuid, p_month date) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'reference', x.reference, 'invoice_date', x.invoice_date,
           'total', x.total, 'excluded', x.excluded, 'basis', x.total - x.excluded) order by x.invoice_date, x.reference), '[]')
    from (select r.id, r.reference, coalesce(r.invoice_date, (r.created_at at time zone 'Africa/Cairo')::date) invoice_date,
                 round(coalesce(sum(m.quantity_delta * m.unit_cost), 0), 2) total,
                 round(coalesce(sum(m.quantity_delta * m.unit_cost) filter (where i.pricing_kind = 'shortage'), 0), 2) excluded
            from clinic_finance.supplier_receipts r
            left join public.inventory_movements m on m.reference_type = 'purchase' and m.reference_id = r.order_id and m.movement_type = 'receipt'
            left join public.inventory_items i on i.id = m.item_id
           where r.supplier_id = p_supplier
             and date_trunc('month', coalesce(r.invoice_date, (r.created_at at time zone 'Africa/Cairo')::date))::date = p_month
           group by r.id) x;
$$;
revoke all on function clinic_finance.supplier_month_invoices(uuid, date) from public, anon, authenticated;

create function public.clinic_finance_supplier_discount(p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid; v_month date; sup public.inventory_suppliers%rowtype; inv jsonb; v_basis numeric; v_pct numeric; v_amt numeric;
  d clinic_finance.supplier_month_discounts%rowtype; tok uuid; url text; v_id uuid;
begin
  if p_action in ('preview', 'create', 'list', 'report') then me := clinic_finance.require_access(case when p_action = 'create' then 'create' else 'view' end);
  elsif p_action = 'review' then me := clinic_finance.require_access('review');
  else raise exception 'إجراء غير معروف'; end if;
  v_month := date_trunc('month', coalesce(nullif(p_payload->>'month', '')::date, (now() at time zone 'Africa/Cairo')::date))::date;

  if p_action = 'preview' or p_action = 'create' then
    select * into sup from public.inventory_suppliers where id = nullif(p_payload->>'supplier_id', '')::uuid;
    if not found then raise exception 'اختار المورد'; end if;
    inv := clinic_finance.supplier_month_invoices(sup.id, v_month);
    select coalesce(sum((e->>'basis')::numeric), 0) into v_basis from jsonb_array_elements(inv) e;
    if p_action = 'preview' then
      return jsonb_build_object('supplier', sup.name, 'month', v_month, 'invoices', inv, 'basis', v_basis,
        'existing', (select to_jsonb(x) from clinic_finance.supplier_month_discounts x where x.supplier_id = sup.id and x.month = v_month and x.status <> 'rejected'));
    end if;
    tok := nullif(p_payload->>'token', '')::uuid;
    if tok is null then raise exception 'طلب غير صالح'; end if;
    perform pg_advisory_xact_lock(hashtextextended('supplier-discount:' || sup.id || ':' || v_month, 0));
    select * into d from clinic_finance.supplier_month_discounts where created_by = me and token = tok;
    if found then return to_jsonb(d) || jsonb_build_object('repeat', true); end if;
    if v_month >= date_trunc('month', (now() at time zone 'Africa/Cairo')::date)::date + interval '1 month' then raise exception 'الشهر لسه مجاش'; end if;
    if exists (select 1 from clinic_finance.supplier_month_discounts where supplier_id = sup.id and month = v_month and status <> 'rejected') then
      raise exception 'خصم الشهر ده للمورد ده اتسجل قبل كده';
    end if;
    if v_basis <= 0 then raise exception 'مفيش فواتير عليها خصم للمورد ده في الشهر ده'; end if;
    v_pct := nullif(p_payload->>'percent', '')::numeric; v_amt := nullif(p_payload->>'amount', '')::numeric;
    if (v_pct is null) = (v_amt is null) then raise exception 'اكتب نسبة الخصم أو المبلغ (واحد بس)'; end if;
    if v_pct is not null then
      if v_pct <= 0 or v_pct > 100 then raise exception 'راجع نسبة الخصم'; end if;
      v_amt := round(v_basis * v_pct / 100, 2);
    elsif v_amt <= 0 or v_amt > v_basis or v_amt <> round(v_amt, 2) then raise exception 'المبلغ لازم يكون أكبر من صفر ومايزيدش عن إجمالي الفواتير';
    end if;
    url := trim(coalesce(p_payload->>'document_url', ''));
    if url <> '' and url !~* '^https?://[^[:space:]]+$' then raise exception 'راجع رابط إشعار الخصم'; end if;
    insert into clinic_finance.supplier_month_discounts(supplier_id, month, basis, percent, amount, invoices, document_url, note, created_by, token)
      values (sup.id, v_month, v_basis, v_pct, v_amt, inv, url, left(trim(coalesce(p_payload->>'note', '')), 500), me, tok) returning * into d;
    insert into clinic_finance.audit(actor, action, entity_id) values (me, 'supplier_discount_created', d.id);
    return to_jsonb(d) || jsonb_build_object('repeat', false);
  end if;

  if p_action = 'review' then
    select * into d from clinic_finance.supplier_month_discounts where id = nullif(p_payload->>'id', '')::uuid for update;
    if not found or d.status <> 'pending' then raise exception 'الخصم اتراجع قبل كده أو مش موجود'; end if;
    if d.created_by = me then raise exception 'المراجعة لازم من شخص غير اللي سجّل الخصم'; end if;
    perform clinic_finance.lock_day();
    if coalesce((p_payload->>'approve')::boolean, false) then
      insert into clinic_finance.supplier_events(supplier_id, movement_id, amount, description)
        values (d.supplier_id, null, -d.amount, 'خصم آخر الشهر ' || to_char(d.month, 'YYYY-MM'));
      perform clinic_finance.post('supplier_month_discount', d.id, 'خصم مشتريات آخر الشهر ' || to_char(d.month, 'YYYY-MM'), null, '2111', '4118', d.amount);
      update clinic_finance.supplier_month_discounts set status = 'approved', reviewed_by = me, reviewed_at = now(),
        review_note = left(trim(coalesce(p_payload->>'note', '')), 500) where id = d.id returning * into d;
    else
      if length(trim(coalesce(p_payload->>'note', ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.supplier_month_discounts set status = 'rejected', reviewed_by = me, reviewed_at = now(),
        review_note = left(trim(p_payload->>'note'), 500) where id = d.id returning * into d;
    end if;
    insert into clinic_finance.audit(actor, action, entity_id) values (me, 'supplier_discount_' || d.status, d.id);
    return to_jsonb(d);
  end if;

  if p_action = 'list' then
    return (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('supplier', s.name, 'created_by_name', a.name, 'reviewed_by_name', b.name)
                    order by x.month desc, s.name), '[]')
              from clinic_finance.supplier_month_discounts x join public.inventory_suppliers s on s.id = x.supplier_id
              join public.admins a on a.id = x.created_by left join public.admins b on b.id = x.reviewed_by
             where nullif(p_payload->>'month', '') is null or x.month = v_month);
  end if;

  -- report
  return jsonb_build_object('month', v_month,
    'sales', (select coalesce(jsonb_object_agg(k.kind, jsonb_build_object('revenue', k.revenue, 'cost', k.cost)), '{}')
                from (select i.pricing_kind kind, round(sum(-m.quantity_delta * m.unit_sale_price), 2) revenue, round(sum(-m.quantity_delta * m.unit_cost), 2) cost
                        from public.inventory_movements m join public.inventory_items i on i.id = m.item_id
                       where m.movement_type = 'sale' and date_trunc('month', m.occurred_at at time zone 'Africa/Cairo')::date = v_month
                       group by i.pricing_kind) k),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('supplier_id', s.id, 'supplier', s.name, 'purchases', p.total, 'basis', p.basis,
                    'discount', x.amount, 'percent', x.percent, 'status', coalesce(x.status, 'missing')) order by s.name), '[]')
                    from public.inventory_suppliers s
                    cross join lateral (select coalesce(sum((e->>'total')::numeric), 0) total, coalesce(sum((e->>'basis')::numeric), 0) basis
                                          from jsonb_array_elements(clinic_finance.supplier_month_invoices(s.id, v_month)) e) p
                    left join clinic_finance.supplier_month_discounts x on x.supplier_id = s.id and x.month = v_month and x.status <> 'rejected'
                   where p.total > 0 and exists (select 1 from clinic_finance.supplier_receipts r
                          join public.inventory_movements m on m.reference_type = 'purchase' and m.reference_id = r.order_id and m.movement_type = 'receipt'
                          join public.inventory_items i on i.id = m.item_id
                         where r.supplier_id = s.id and i.pricing_kind in ('medicine', 'shortage'))),
    'discounts', (select coalesce(sum(amount), 0) from clinic_finance.supplier_month_discounts where month = v_month and status = 'approved'));
end $$;
revoke all on function public.clinic_finance_supplier_discount(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_supplier_discount(text, jsonb) to authenticated;

commit;
