-- Owner 2026-11-28 (urgent, nursing saw «تكلفة المستلزمات (سعر الشراء)» in «استهلاك أمس»):
-- «سعر التكلفة يظهر فقط للمحاسب والمدير المالي، المالك، السوبر ادمن، لكن يظهر للموظف ليه؟».
-- The purchase / cost price is no longer SENT by the server to anyone else (not only hidden in the screen).
-- Rename-wrap (the live body, whatever patches it carries, is kept untouched):
--   public.clinic_reception_visit_usage → clinic_reception.visit_usage_full (no grants)
--   new public.clinic_reception_visit_usage = same signature; for non cost-viewers every key named
--   cost / total_cost / bom_cost / unit_cost / avg_cost is removed from the reply (lists, lines, items, counts, save
--   result, replays); bom_cost > 0 becomes the boolean «bom» so the «included with the service» chip still shows.
--   The reply carries can_see_cost so the screen hides the empty columns.
-- Cost viewers: accountant, financial_manager, general_manager, super_admin (public.has_role, main or extra role).
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

create or replace function clinic_reception.strip_cost(j jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case jsonb_typeof(j)
    when 'object' then
      coalesce((select jsonb_object_agg(e.k, clinic_reception.strip_cost(e.v)) from jsonb_each(j) e(k, v)
                 where e.k not in ('cost', 'total_cost', 'bom_cost', 'unit_cost', 'avg_cost')), '{}'::jsonb)
      || case when j ? 'bom_cost' then jsonb_build_object('bom', coalesce((j->>'bom_cost')::numeric, 0) > 0) else '{}'::jsonb end
    when 'array' then
      coalesce((select jsonb_agg(clinic_reception.strip_cost(a.v) order by a.n) from jsonb_array_elements(j) with ordinality a(v, n)), '[]'::jsonb)
    else j end
$$;
revoke all on function clinic_reception.strip_cost(jsonb) from public, anon;

alter function public.clinic_reception_visit_usage(uuid, text, jsonb) rename to clinic_reception_visit_usage_full;
alter function public.clinic_reception_visit_usage_full(uuid, text, jsonb) set schema clinic_reception;
alter function clinic_reception.clinic_reception_visit_usage_full(uuid, text, jsonb) rename to visit_usage_full;
revoke all on function clinic_reception.visit_usage_full(uuid, text, jsonb) from public, anon, authenticated;

create function public.clinic_reception_visit_usage(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb; see boolean := clinic_reception.can_see_cost();
begin
  r := clinic_reception.visit_usage_full(p_workspace, p_action, p_payload);
  if not see then r := clinic_reception.strip_cost(r); end if;
  if jsonb_typeof(r) = 'object' then r := r || jsonb_build_object('can_see_cost', see); end if;
  return r;
end $$;
revoke all on function public.clinic_reception_visit_usage(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_visit_usage(uuid, text, jsonb) to authenticated;
commit;
