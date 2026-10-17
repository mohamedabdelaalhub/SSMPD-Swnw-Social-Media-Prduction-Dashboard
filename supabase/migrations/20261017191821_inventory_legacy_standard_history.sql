-- Older clients must record the applied standard, not a stale submitted markup, in price history.
create or replace function public.inventory_save_item(p_id uuid,p_sku text,p_name text,p_category text,p_base_unit text,p_units_per_pack numeric,p_minimum numeric,p_markup numeric,p_sale_price numeric) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare cost numeric;setting clinic_finance.inventory_pricing_settings%rowtype;begin
 if not public.inventory_is_manager() then raise exception 'إدارة الصنف لمسؤول المخزن';end if;
 if p_id is not null then perform 1 from public.inventory_items where id=p_id for update;end if;
 select * into setting from clinic_finance.inventory_pricing_settings where id;
 if setting.configured and (p_id is null or coalesce((select use_standard_markup from public.inventory_items where id=p_id),false)) then p_markup:=setting.markup_percent;end if;
 if p_id is not null then cost:=clinic_finance.inventory_highest_purchase(p_id);if cost is not null then p_sale_price:=round(cost*(1+p_markup/100),2);end if;end if;
 return clinic_finance.inventory_item_before_pricing(p_id,p_sku,p_name,p_category,p_base_unit,p_units_per_pack,p_minimum,p_markup,p_sale_price);
end $$;
revoke all on function public.inventory_save_item(uuid,text,text,text,text,numeric,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.inventory_save_item(uuid,text,text,text,text,numeric,numeric,numeric,numeric) to authenticated;
