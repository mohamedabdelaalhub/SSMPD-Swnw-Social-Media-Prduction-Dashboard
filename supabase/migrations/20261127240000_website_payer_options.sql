-- Website booking form, payment step: read-only helpers for the booking agent (service role only; never exposed to anon / authenticated).
--   * website_payer_options(): NAMES ONLY of the contracting entities with an ACTIVE contract today, grouped for the form:
--       insurance  = category 'insurance'; membership = category 'unions'; entity = category 'cash' (nurseries, clubs, gyms ... contracts).
--     No prices, no percentages, no contract terms.
--   * website_payer_quote(entity, base_price, day): the price the patient pays ONLY when it is unambiguous: an 'entity' (cash category) with an ACTIVE
--     contract with a discount % and NO price list on that contract (a list would override the %). Otherwise NULL, and the form says «يُحدَّد عند الحضور».
--     Insurance is never quoted (coverage % comes from the approval and is typed by reception).
-- Rollback: supabase/rollbacks/20261127240000_website_payer_options.rollback.sql
begin;
do $$ begin
  if to_regclass('public.contracting_entities') is null or to_regclass('public.contracting_entity_contracts') is null then raise exception 'جداول التعاقدات غير موجودة'; end if;
  if to_regprocedure('public.website_payer_options()') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function public.website_payer_options() returns jsonb
language sql stable security definer set search_path = '' as $$
  with active as (
    select e.id, e.name, case e.category when 'insurance' then 'insurance' when 'unions' then 'membership' when 'cash' then 'entity' end as grp
    from public.contracting_entities e
    where e.category in ('insurance', 'unions', 'cash')
      and exists (select 1 from public.contracting_entity_contracts c where c.entity_id = e.id and c.status = 'active'
                  and c.start_date <= current_date and (c.end_date is null or c.end_date >= current_date)))
  select jsonb_build_object(
    'insurance', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from active where grp = 'insurance'), '[]'::jsonb),
    'membership', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from active where grp = 'membership'), '[]'::jsonb),
    'entity', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from active where grp = 'entity'), '[]'::jsonb));
$$;

create function public.website_payer_quote(p_entity uuid, p_base numeric, p_day date) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare v_pct numeric; v_contract uuid; v_cat text;
begin
  if p_entity is null or p_base is null or p_base <= 0 or p_base::text in ('NaN', 'Infinity') then return null; end if;
  select category into v_cat from public.contracting_entities where id = p_entity;
  if v_cat is distinct from 'cash' then return null; end if;
  select c.id, c.discount_percent into v_contract, v_pct from public.contracting_entity_contracts c
   where c.entity_id = p_entity and c.status = 'active' and c.start_date <= coalesce(p_day, current_date)
     and (c.end_date is null or c.end_date >= coalesce(p_day, current_date))
   order by c.start_date desc limit 1;
  if v_contract is null or coalesce(v_pct, 0) <= 0 then return null; end if;
  if to_regclass('clinic_prices.lists') is not null and exists (select 1 from clinic_prices.lists l where l.contract_id = v_contract and l.status = 'active') then return null; end if;
  return round(p_base * (1 - v_pct / 100));
end $$;

revoke all on function public.website_payer_options() from public, anon, authenticated;
revoke all on function public.website_payer_quote(uuid, numeric, date) from public, anon, authenticated;
grant execute on function public.website_payer_options() to service_role;
grant execute on function public.website_payer_quote(uuid, numeric, date) to service_role;
commit;
