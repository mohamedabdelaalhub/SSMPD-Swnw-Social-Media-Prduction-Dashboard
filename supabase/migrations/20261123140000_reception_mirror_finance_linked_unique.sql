-- 20261123140000_reception_mirror_finance_linked_unique.sql
-- Fix (owner report 2026-11-24 09:2xZ): «duplicate key value violates unique constraint "shifts_register_id_idx"» for EVERYONE.
-- Cause: clinic_reception.shifts is a mirror of clinic_finance.shifts (sync_native_links copies status). Since #777 (mig 20261123100000)
-- finance lets a cashier start a new collection shift once the old one is ENDED (status 'open', ended_at set) — but the mirror kept
-- «one non-reviewed row per register / per cashier», so inserting the new shift's mirror fails inside clinic_reception_snapshot.
-- Fix: those two mirror indexes now apply only to native (non-finance) reception shifts. For finance-linked rows the source of truth
-- is finance's own fin_register_collection_open / fin_cashier_collection_open (open and not ended). Main-treasury indexes unchanged.
begin;
do $$ begin
  if to_regclass('clinic_reception.shifts_register_id_idx') is null or to_regclass('clinic_reception.shifts_workspace_id_cashier_id_idx') is null
     or to_regclass('clinic_finance.fin_register_collection_open') is null then
    raise exception 'الفهارس مش بالأسماء المتوقعة'; end if;
end $$;
drop index clinic_reception.shifts_register_id_idx;
create unique index shifts_register_id_idx on clinic_reception.shifts(register_id)
  where status <> 'reviewed' and not is_main and finance_shift_id is null;
drop index clinic_reception.shifts_workspace_id_cashier_id_idx;
create unique index shifts_workspace_id_cashier_id_idx on clinic_reception.shifts(workspace_id, cashier_id)
  where status <> 'reviewed' and not is_main and finance_shift_id is null;
commit;
