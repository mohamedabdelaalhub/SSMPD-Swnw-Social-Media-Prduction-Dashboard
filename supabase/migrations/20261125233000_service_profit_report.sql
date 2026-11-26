-- «ربح كل خدمة بعد المستلزمات» (owner «طبق تقرير ربح الخدمات وضيف عمود بعد أتعاب الدكتور» 2026-11-25; mockup
-- docs/ui-references/mockups/service-profit.html). Reports center, area profitability. Visible to the SUPER ADMIN (is_super) and the
-- FINANCIAL MANAGER only (owner: «يشوف التقرير ده السوبر أدمن والمدير المالي بس").
-- Per service, for a period: orders, revenue (net after discount − insurer contractual cut), ACTUAL included-supplies cost
-- (clinic_reception.movements kind 'included': the service BOM + «استهلاك أمس», at stock cost), cost per visit (over visits that have
-- recorded usage), the PLANNED cost per visit from the price model (pricing_services.supplies_used), margin after supplies,
-- doctor + referral fees, margin after doctor fees, and a status: price below supplies / usage missing («ناقص») / ok / no supplies.
-- Plus the supplies SOLD to the patient (medicines and billable nursing supplies): quantity, sale value, cost, profit.
-- READ-ONLY: one registry row, one access row, one function. Reuses report_order_costs / report_stock_out (wave 5/7). Nothing moves.
-- Rollback: supabase/rollbacks/20261125233000_service_profit_report.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.report_order_costs(date,date,uuid)') is null or to_regprocedure('public.report_stock_out(date,date,uuid)') is null
     or to_regclass('clinic_reception.visit_usage') is null then
    raise exception 'طبّق مركز التقارير (الموجة 5 و7) و«استهلاك أمس» أولًا';
  end if;
  if to_regprocedure('public.report_service_profit(date,date,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

insert into public.report_registry(code, title, area, sort, sensitive) values ('service_profit', 'ربح كل خدمة بعد المستلزمات', 'profitability', 182, true);
insert into public.report_access(report_code, role) values ('service_profit', 'financial_manager');

create function public.report_service_profit(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('service_profit');
  perform public.report_check_period(p_from, p_to);
  with o as (
    select c.order_id, c.service, c.specialty, c.net - c.contractual revenue, c.doctor_fee + c.referral_fee doctor_fees, c.supplies,
           (c.supplies > 0 or exists (select 1 from clinic_reception.visit_usage u where u.order_id = c.order_id)) has_usage,
           coalesce((select sum((l->>'quantity')::numeric * sp.package_price / nullif(sp.units_per_package, 0))
                       from clinic_reception.orders ro join clinic_reception.services s on s.id = ro.service_id
                       join public.pricing_services ps on ps.id = s.pricing_service_id
                       cross join lateral jsonb_array_elements(case when jsonb_typeof(ps.supplies_used) = 'array' then ps.supplies_used else '[]'::jsonb end) l
                       join public.pricing_supplies sp on sp.id = nullif(l->>'supply_id', '')::uuid
                      where ro.id = c.order_id) * (select ro.quantity from clinic_reception.orders ro where ro.id = c.order_id), 0) bom
      from public.report_order_costs(p_from, p_to, p_branch) c),
  g as (
    select service, specialty, count(*) orders, round(sum(revenue), 2) revenue, round(sum(supplies), 2) supplies,
           count(*) filter (where has_usage) used_orders, round(sum(bom), 2) bom, round(sum(doctor_fees), 2) doctor_fees,
           case when sum(bom) > 0 or bool_or(has_usage) then count(*) filter (where not has_usage) else 0 end missing
      from o group by service, specialty),
  r as (
    select g.*, round(supplies / nullif(used_orders, 0), 2) per_visit, round(bom / nullif(orders, 0), 2) bom_per_visit,
           revenue - supplies margin, case when revenue > 0 then round(100 * (revenue - supplies) / revenue, 1) end margin_pct,
           revenue - supplies - doctor_fees net_margin, case when revenue > 0 then round(100 * (revenue - supplies - doctor_fees) / revenue, 1) end net_margin_pct,
           case when revenue - supplies < 0 then 'below' when missing > 0 then 'missing' when supplies = 0 and bom = 0 and used_orders = 0 then 'no_supplies' else 'ok' end status
      from g),
  items as (
    select service, item, unit, round(sum(quantity), 3) qty, round(sum(cost), 2) cost
      from public.report_stock_out(p_from, p_to, p_branch) where reason = 'included' and service is not null group by service, item, unit),
  sold as (
    select case when is_medicine then 'medicines' else 'nursing' end kind, round(sum(quantity), 3) qty, round(sum(sale), 2) sale, round(sum(cost), 2) cost
      from public.report_stock_out(p_from, p_to, p_branch) where reason = 'sold' group by 1)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by (r.status = 'below') desc, r.margin_pct nulls last, r.service) from r), '[]'::jsonb),
    'items', coalesce((select jsonb_object_agg(service, x) from (select service, jsonb_agg(jsonb_build_object('item', item, 'unit', unit, 'qty', qty, 'cost', cost) order by cost desc) x
                         from items group by service) y), '{}'::jsonb),
    'sold', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'qty', qty, 'sale', sale, 'cost', cost, 'profit', sale - cost,
                         'pct', case when sale > 0 then round(100 * (sale - cost) / sale, 1) end) order by kind) from sold), '[]'::jsonb),
    'costs_from', date '2026-11-24',
    'totals', (select jsonb_build_object('orders', coalesce(sum(orders), 0), 'revenue', coalesce(sum(revenue), 0), 'supplies', coalesce(sum(supplies), 0),
                 'bom', coalesce(sum(bom), 0), 'doctor_fees', coalesce(sum(doctor_fees), 0), 'margin', coalesce(sum(margin), 0),
                 'net_margin', coalesce(sum(net_margin), 0),
                 'margin_pct', case when sum(revenue) > 0 then round(100 * sum(margin) / sum(revenue), 1) end,
                 'net_margin_pct', case when sum(revenue) > 0 then round(100 * sum(net_margin) / sum(revenue), 1) end,
                 'below', count(*) filter (where status = 'below'), 'missing', coalesce(sum(missing), 0)) from r))
    into v;
  return v;
end $$;
revoke all on function public.report_service_profit(date, date, uuid) from public, anon;
grant execute on function public.report_service_profit(date, date, uuid) to authenticated;

commit;
