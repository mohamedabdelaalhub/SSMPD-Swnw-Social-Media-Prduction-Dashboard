-- Rollback of 20261123140000: restore the strict mirror indexes (will fail while two unreviewed finance-linked shifts share a register/cashier).
begin;
drop index clinic_reception.shifts_register_id_idx;
create unique index shifts_register_id_idx on clinic_reception.shifts(register_id) where status <> 'reviewed' and not is_main;
drop index clinic_reception.shifts_workspace_id_cashier_id_idx;
create unique index shifts_workspace_id_cashier_id_idx on clinic_reception.shifts(workspace_id, cashier_id) where status <> 'reviewed' and not is_main;
commit;
