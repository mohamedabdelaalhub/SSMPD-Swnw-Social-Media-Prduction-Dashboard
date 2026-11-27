-- READ-ONLY: every medicine the 20261127320000 repair would touch (on the standard markup or carrying a markup), with its
-- purchase price, the price the repair gives it, and its last 3 price-history rows (when, who, old → new price / markup).
-- Item SKUs / prices and staff names only — no patient data.
begin read only;
with m as (
  select i.id, i.sku, i.name, i.current_sale_price price, i.markup_percent markup, i.use_standard_markup std,
         clinic_finance.inventory_highest_purchase(i.id) purchase
  from public.inventory_items i where i.pricing_kind = 'medicine' and (i.use_standard_markup or i.markup_percent <> 0)
)
select m.sku, m.name, m.price, m.markup, m.std, m.purchase,
       coalesce(m.purchase, m.price) as price_after_repair,
       h.n as hist_rank, to_char(h.changed_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') as changed_at,
       (select a.name || ' (' || a.role || ')' from public.admins a where a.id = h.changed_by) as changed_by,
       h.previous_price, h.new_price, h.previous_markup, h.new_markup
from m left join lateral (
  select ph.*, row_number() over (order by ph.changed_at desc) n from public.inventory_price_history ph where ph.item_id = m.id
  order by ph.changed_at desc limit 3) h on true
order by m.sku, h.n;

-- how often «طبّق على الكل» ran, and when (audit)
select to_char(e.created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') at_, (select a.name from public.admins a where a.id = e.actor_id) who, e.detail
from public.inventory_audit_events e where e.kind = 'standard_markup' order by e.created_at;
rollback;
