-- Rollback of 20261122220000_reception_mirror_main_count.sql. Only possible while at most one main mirror is unreviewed per register / cashier
-- (review the queued main counts first); otherwise the old unique indexes cannot be rebuilt.
begin;
do $$ begin
  if exists (select 1 from clinic_reception.shifts where is_main and status <> 'reviewed' group by register_id having count(*) > 1)
     or exists (select 1 from clinic_reception.shifts where status <> 'reviewed' group by workspace_id, cashier_id having count(*) > 1) then
    raise exception 'راجع جرد الخزينة الرئيسية المستني الأول قبل الرجوع'; end if;
end $$;
drop index clinic_reception.shifts_cashier_main_open;
drop index clinic_reception.shifts_workspace_id_cashier_id_idx;
create unique index shifts_workspace_id_cashier_id_idx on clinic_reception.shifts(workspace_id, cashier_id) where status <> 'reviewed';
drop index clinic_reception.shifts_register_main_open;
drop index clinic_reception.shifts_register_id_idx;
create unique index shifts_register_id_idx on clinic_reception.shifts(register_id) where status <> 'reviewed';
drop trigger shift_is_main on clinic_reception.shifts;
drop function clinic_reception.shift_is_main();
alter table clinic_reception.shifts drop column is_main;
commit;
