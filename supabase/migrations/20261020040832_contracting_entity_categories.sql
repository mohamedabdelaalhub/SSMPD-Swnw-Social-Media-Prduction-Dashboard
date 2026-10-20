-- Existing entities remain cash contracts, preserving their IDs and all related records.
alter table public.contracting_entities
  add column category text not null default 'cash'
  constraint contracting_entities_category_check check (category in (
    'cash', 'doctor_referrals', 'insurance', 'petroleum', 'unions',
    'government', 'international', 'medical_tourism'
  ));

-- Keep the existing RPC available for older clients. The new API inherits
-- its authorization and also applies the caller's existing entity SELECT RLS.
create function public.contracting_entities_overview_categories()
returns table (
  entity_id uuid, entity_name text, entity_type text, contract_status text,
  end_date date, next_follow_up_date date, patients_count bigint,
  documented_revenue numeric, cashback_due numeric, category text
) language sql stable security invoker set search_path = '' as $$
  select o.*, e.category
  from public.contracting_entities_overview() o
  join public.contracting_entities e on e.id = o.entity_id
  order by case o.contract_status when 'active' then 0 when 'negotiating' then 1 else 2 end,
    o.entity_name;
$$;
revoke all on function public.contracting_entities_overview_categories() from public, anon;
grant execute on function public.contracting_entities_overview_categories() to authenticated;
