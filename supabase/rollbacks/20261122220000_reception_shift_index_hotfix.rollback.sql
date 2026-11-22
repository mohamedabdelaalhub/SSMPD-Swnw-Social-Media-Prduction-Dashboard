-- Rollback of 20261122220000_reception_shift_index_hotfix.sql: restores the old predicates (status <> 'reviewed'). Only possible while no register
-- and no cashier has more than one unreviewed reception shift (review the queued main counts first) — and note that 20261122200000 would then
-- break clinic_reception_snapshot again at the next main count, so roll 20261122200000 back first.
begin;
do $$ begin
  if exists (select 1 from clinic_reception.shifts where status <> 'reviewed' group by register_id having count(*) > 1)
     or exists (select 1 from clinic_reception.shifts where status <> 'reviewed' group by workspace_id, cashier_id having count(*) > 1) then
    raise exception 'راجع الورديات المستنية الأول (أكتر من وردية غير مراجعة على نفس الخزينة أو الموظف)'; end if;
end $$;
drop index clinic_reception.shifts_register_id_idx;
create unique index shifts_register_id_idx on clinic_reception.shifts(register_id) where status <> 'reviewed';
drop index clinic_reception.shifts_workspace_id_cashier_id_idx;
create unique index shifts_workspace_id_cashier_id_idx on clinic_reception.shifts(workspace_id, cashier_id) where status <> 'reviewed';
commit;
