-- Owner 2026-11-28 (urgent, nursing saw «تكلفة المستلزمات (سعر الشراء)» in «استهلاك أمس»):
-- «سعر التكلفة يظهر فقط للمحاسب والمدير المالي، المالك، السوبر ادمن، لكن يظهر للموظف ليه؟» + «في أي شاشة تمريض أو استقبال تانية».
-- The purchase / cost price is no longer SENT by the server to anyone else (not only hidden in the screen).
-- Cost viewers (clinic_reception.can_see_cost): accountant, financial_manager, general_manager, super_admin (main or extra role).
-- Rename-wrap only (the live bodies, whatever patches they carry, are kept untouched); every wrapper adds can_see_cost:
--  1) «استهلاك أمس»  public.clinic_reception_visit_usage → clinic_reception.visit_usage_full
--     strips cost / total_cost / bom_cost / unit_cost / avg_cost (bom_cost > 0 → boolean «bom» for the chip).
--  2) reports head_nursing can open (report_access seed): report_supplies_consumption / report_medicines_consumption /
--     report_nursing_variance → clinic_reception.<name>_full; strips cost / included_cost / loss_cost / sold_cost / margin /
--     variance_value. The reports stay open to the same roles (quantities, items, services) — only the money columns go.
--  3) inventory_workspace_snapshot → clinic_reception.inventory_snapshot_full: for a NON-manager of the store who is not a cost
--     viewer (nursing / reception staff on a store) strips unit_cost / profit_amount / requested_unit_cost / package_cost /
--     current_average_cost / highest_purchase_cost / reference_purchase_price / cost from their own movements / requests / imports.
--     Store managers (can_manage: super_admin, GM, the store's storekeeper/manager) are unchanged — they price purchases.
--  4) clinic_reception_nursing → public.nursing_before_cost: strips the vitals-kit «cost» (never shown, sent only).
-- Rollback: supabase/rollbacks/20261128140000_hide_supply_cost.rollback.sql
do $$ begin
  if to_regprocedure('public.clinic_reception_visit_usage(uuid,text,jsonb)') is null then raise exception 'clinic_reception_visit_usage مش موجودة'; end if;
  if to_regprocedure('clinic_reception.visit_usage_full(uuid,text,jsonb)') is not null then raise exception 'تم تطبيق 20261128140000 قبل كده'; end if;
end $$;
begin;
create or replace function clinic_reception.can_see_cost() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.has_role('accountant') or public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin')
$$;
revoke all on function clinic_reception.can_see_cost() from public, anon;
grant execute on function clinic_reception.can_see_cost() to authenticated;

create or replace function clinic_reception.strip_cost(j jsonb, k text[]) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case jsonb_typeof(j)
    when 'object' then
      coalesce((select jsonb_object_agg(e.key, clinic_reception.strip_cost(e.value, k)) from jsonb_each(j) e
                 where not (e.key = any(k))), '{}'::jsonb)
      || case when 'bom_cost' = any(k) and j ? 'bom_cost' then jsonb_build_object('bom', coalesce((j->>'bom_cost')::numeric, 0) > 0) else '{}'::jsonb end
    when 'array' then
      coalesce((select jsonb_agg(clinic_reception.strip_cost(a.v, k) order by a.n) from jsonb_array_elements(j) with ordinality a(v, n)), '[]'::jsonb)
    else j end
$$;
revoke all on function clinic_reception.strip_cost(jsonb, text[]) from public, anon;

-- 1) «استهلاك أمس»
alter function public.clinic_reception_visit_usage(uuid, text, jsonb) rename to clinic_reception_visit_usage_full;
alter function public.clinic_reception_visit_usage_full(uuid, text, jsonb) set schema clinic_reception;
alter function clinic_reception.clinic_reception_visit_usage_full(uuid, text, jsonb) rename to visit_usage_full;
revoke all on function clinic_reception.visit_usage_full(uuid, text, jsonb) from public, anon, authenticated;
create function public.clinic_reception_visit_usage(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb; see boolean := clinic_reception.can_see_cost();
begin
  r := clinic_reception.visit_usage_full(p_workspace, p_action, p_payload);
  if not see then r := clinic_reception.strip_cost(r, array['cost', 'total_cost', 'bom_cost', 'unit_cost', 'avg_cost']); end if;
  if jsonb_typeof(r) = 'object' then r := r || jsonb_build_object('can_see_cost', see); end if;
  return r;
end $$;
revoke all on function public.clinic_reception_visit_usage(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_visit_usage(uuid, text, jsonb) to authenticated;

-- 2) reports
do $r$ declare f text; begin
  foreach f in array array['report_supplies_consumption', 'report_medicines_consumption', 'report_nursing_variance'] loop
    continue when to_regprocedure('public.' || f || '(date,date,uuid)') is null;   -- (live has all three; partial test databases may not)
    execute format('alter function public.%I(date, date, uuid) set schema clinic_reception', f);
    execute format('alter function clinic_reception.%I(date, date, uuid) rename to %I', f, f || '_full');
    execute format('revoke all on function clinic_reception.%I(date, date, uuid) from public, anon, authenticated', f || '_full');
    execute format($w$create function public.%I(p_from date, p_to date, p_branch uuid default null) returns jsonb
      language plpgsql stable security definer set search_path = pg_catalog, public as $b$
      declare r jsonb := clinic_reception.%I(p_from, p_to, p_branch); see boolean := clinic_reception.can_see_cost();
      begin
        if not see then r := clinic_reception.strip_cost(r, array['cost', 'included_cost', 'loss_cost', 'sold_cost', 'margin', 'variance_value']); end if;
        return case when jsonb_typeof(r) = 'object' then r || jsonb_build_object('can_see_cost', see) else r end;
      end $b$ $w$, f, f || '_full');
    execute format('revoke all on function public.%I(date, date, uuid) from public, anon', f);
    execute format('grant execute on function public.%I(date, date, uuid) to authenticated', f);
  end loop;
end $r$;

-- 3) inventory workspace (non-manager staff only)
do $o$ begin
  if to_regprocedure('public.inventory_workspace_snapshot(uuid)') is null then return; end if;
  execute $x$alter function public.inventory_workspace_snapshot(uuid) set schema clinic_reception;
alter function clinic_reception.inventory_workspace_snapshot(uuid) rename to inventory_snapshot_full;
revoke all on function clinic_reception.inventory_snapshot_full(uuid) from public, anon, authenticated;
create function public.inventory_workspace_snapshot(p_location uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r jsonb := clinic_reception.inventory_snapshot_full(p_location); see boolean := clinic_reception.can_see_cost();
begin
  if jsonb_typeof(r) <> 'object' then return r; end if;
  if not see and not coalesce((r->>'can_manage')::boolean, false) then
    r := clinic_reception.strip_cost(r, array['unit_cost', 'profit_amount', 'requested_unit_cost', 'package_cost', 'current_average_cost',
                                             'highest_purchase_cost', 'reference_purchase_price', 'cost']);
  end if;
  return r || jsonb_build_object('can_see_cost', see or coalesce((r->>'can_manage')::boolean, false));
end $$;
revoke all on function public.inventory_workspace_snapshot(uuid) from public, anon;
grant execute on function public.inventory_workspace_snapshot(uuid) to authenticated;

$x$;
end $o$;

-- 4) nursing day (vitals kit cost was sent, never shown)
do $o$ begin
  if to_regprocedure('public.clinic_reception_nursing(uuid,text,jsonb)') is null then return; end if;
  execute $x$alter function public.clinic_reception_nursing(uuid, text, jsonb) rename to nursing_before_cost;
revoke all on function public.nursing_before_cost(uuid, text, jsonb) from public, anon, authenticated;
create function public.clinic_reception_nursing(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb := public.nursing_before_cost(p_workspace, p_action, p_payload);
begin
  if not clinic_reception.can_see_cost() then r := clinic_reception.strip_cost(r, array['cost', 'unit_cost', 'total_cost']); end if;
  return r;
end $$;
revoke all on function public.clinic_reception_nursing(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_nursing(uuid, text, jsonb) to authenticated;
$x$;
end $o$;
commit;
