-- HOTFIX record (applied live 2026-11-22 21:32–21:33Z by main chat 4, owner «صلّح خطأ الوردية فورا»). After 20261122200000 («جرد
-- الخزينة الرئيسية») the main treasury may have one OPEN main shift plus older ones waiting for review; the reception mirror
-- (clinic_reception.sync_native_links via clinic_reception_snapshot) copies every finance shift and failed for everyone with
-- «duplicate key … shifts_register_id_idx». The mirror's two unique indexes now only forbid a second OPEN shift:
--   shifts_register_id_idx              (register_id)            WHERE status = 'open'   (was status <> 'reviewed')
--   shifts_workspace_id_cashier_id_idx  (workspace_id, cashier_id) WHERE status = 'open'   (was status <> 'reviewed')
-- Live collection treasuries keep «no new shift before review»: every live reception shift is opened together with its finance shift
-- (bridge), and the finance side keeps fin_register_active / fin_cashier_collection_active + the clear-message trigger.
-- Idempotent (already applied on live). Rollback: supabase/rollbacks/20261122220000_reception_shift_index_hotfix.rollback.sql
begin;
do $$
declare def text;
begin
  select indexdef into def from pg_indexes where schemaname = 'clinic_reception' and indexname = 'shifts_register_id_idx';
  if def is null or def not like '%status = ''open''%' then
    execute 'drop index if exists clinic_reception.shifts_register_id_idx';
    execute 'create unique index shifts_register_id_idx on clinic_reception.shifts(register_id) where status = ''open''';
  end if;
  select indexdef into def from pg_indexes where schemaname = 'clinic_reception' and indexname = 'shifts_workspace_id_cashier_id_idx';
  if def is null or def not like '%status = ''open''%' then
    execute 'drop index if exists clinic_reception.shifts_workspace_id_cashier_id_idx';
    execute 'create unique index shifts_workspace_id_cashier_id_idx on clinic_reception.shifts(workspace_id, cashier_id) where status = ''open''';
  end if;
end $$;
commit;
