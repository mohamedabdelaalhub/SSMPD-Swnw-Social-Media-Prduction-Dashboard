-- Rollback for 20261122270000_inventory_supplies_flow.sql.
-- Refuses if «استهلاك أمس» already consumed stock (those movements and postings must be reversed by a count/adjustment,
-- not by dropping the evidence). Direct supplier invoices stay as normal receipts; only the RPC is removed.
begin;
do $$ begin
  if exists (select 1 from clinic_reception.visit_usage_lines) then
    raise exception 'استهلاك أمس فيه بنود مسجلة؛ مينفعش نرجع الملف ده';
  end if;
end $$;
drop function if exists public.clinic_reception_visit_usage(uuid, text, jsonb);
drop table if exists clinic_reception.visit_usage_lines;
drop table if exists clinic_reception.visit_usage;
drop function if exists public.inventory_direct_invoice(text, jsonb);
alter table public.inventory_locations drop column if exists is_main;
commit;
