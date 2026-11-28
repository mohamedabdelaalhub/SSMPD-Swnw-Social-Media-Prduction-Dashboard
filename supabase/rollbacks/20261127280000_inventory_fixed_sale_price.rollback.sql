-- Rollback of 20261127280000_inventory_fixed_sale_price.sql. Fixed items go back to «مستلزمات» KEEPING their current price
-- (nothing is repriced here); the setter, guards and column are removed and the old «نوع التسعير» setter is restored.
begin;
do $$ begin if to_regprocedure('public.inventory_set_fixed_price(uuid,numeric)') is null then raise exception 'الملف مش متطبق'; end if; end $$;
drop trigger zz_inventory_fixed_price on public.inventory_items;
drop trigger inventory_fixed_price_history on public.inventory_price_history;
update public.inventory_items set pricing_kind = 'supply', use_standard_markup = false where pricing_kind = 'fixed';
drop function public.inventory_set_pricing_kind(uuid, text, numeric);
alter function clinic_finance.inventory_set_pricing_kind_before_fixed(uuid, text, numeric) set schema public;
alter function public.inventory_set_pricing_kind_before_fixed(uuid, text, numeric) rename to inventory_set_pricing_kind;
revoke all on function public.inventory_set_pricing_kind(uuid, text, numeric) from public, anon;
grant execute on function public.inventory_set_pricing_kind(uuid, text, numeric) to authenticated;
drop function public.inventory_set_fixed_price(uuid, numeric);
drop function public.inventory_fixed_price_history_guard();
drop function public.inventory_fixed_price_guard();
alter table public.inventory_items drop constraint inventory_items_fixed_has_price;
alter table public.inventory_items drop column fixed_sale_price;
alter table public.inventory_items drop constraint inventory_items_pricing_kind_check;
alter table public.inventory_items add constraint inventory_items_pricing_kind_check check (pricing_kind in ('supply', 'medicine', 'shortage'));
commit;
