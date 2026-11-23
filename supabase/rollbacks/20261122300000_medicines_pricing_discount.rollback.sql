-- Rollback for 20261122300000_medicines_pricing_discount.sql. Refuses once a month-end discount was approved (its
-- posting and supplier event must be reversed by finance, not dropped). Item prices stay as they are.
begin;
do $$ begin
  if exists (select 1 from clinic_finance.supplier_month_discounts where status = 'approved') then
    raise exception 'فيه خصم آخر شهر معتمد؛ مينفعش نرجع الملف ده';
  end if;
end $$;
drop function if exists public.clinic_finance_supplier_discount(text, jsonb);
drop function if exists clinic_finance.supplier_month_invoices(uuid, date);
drop table if exists clinic_finance.supplier_month_discounts;
drop function if exists public.inventory_pricing_list();
drop function if exists public.inventory_set_pricing_kind(uuid, text, numeric);
drop trigger if exists inventory_medicine_no_markup on public.inventory_items;
drop function if exists public.inventory_medicine_no_markup();
alter table public.inventory_items drop column if exists pricing_kind;
commit;
