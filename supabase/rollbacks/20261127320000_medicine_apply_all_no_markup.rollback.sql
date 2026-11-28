-- Rollback of 20261127320000_medicine_apply_all_no_markup.sql: the medicine trigger body from 20261122300000 and no history guard.
-- Repaired medicine prices stay as they are (they are the correct no-markup prices).
begin;
drop trigger if exists inventory_medicine_history on public.inventory_price_history;
drop function if exists public.inventory_medicine_history_guard();
create or replace function public.inventory_medicine_no_markup() returns trigger
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
revoke all on function public.inventory_medicine_no_markup() from public, anon, authenticated;
commit;
