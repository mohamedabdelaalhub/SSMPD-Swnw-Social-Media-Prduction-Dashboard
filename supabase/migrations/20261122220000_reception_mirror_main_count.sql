-- Fix for 20261122200000 («جرد الخزينة الرئيسية»): the main treasury may now have one OPEN main shift plus older main shifts waiting
-- for review. The reception mirror (clinic_reception.sync_native_links, called by clinic_reception_snapshot) copies every finance shift
-- into clinic_reception.shifts, whose unique indexes still allowed ONE unreviewed shift per register and per cashier → the snapshot
-- failed for everyone with «duplicate key … shifts_register_id_idx» as soon as the custodian opened the new main shift (2026-11-22 23:07).
-- Same rule as the finance side, on the mirror:
--   * clinic_reception.shifts.is_main (set by trigger from the linked finance register: treasury_kind = 'main');
--   * main mirrors: at most one OPEN per register and per (workspace, cashier); reviews may queue;
--   * every other shift (collection, trial workspaces): unchanged — one unreviewed per register and per (workspace, cashier).
-- No data is changed except the new flag. Rollback: supabase/rollbacks/20261122220000_reception_mirror_main_count.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_finance_main_count(jsonb,text,uuid)') is null then raise exception 'طبّق 20261122200000 الأول'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'shifts' and column_name = 'is_main') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regclass('clinic_reception.shifts_register_id_idx') is null or to_regclass('clinic_reception.shifts_workspace_id_cashier_id_idx') is null then
    raise exception 'فهارس ورديات الاستقبال مش بالأسماء المتوقعة'; end if;
end $$;

alter table clinic_reception.shifts add column is_main boolean not null default false;
update clinic_reception.shifts s set is_main = true
  from clinic_reception.registers r join clinic_finance.registers f on f.id = r.finance_register_id
 where r.id = s.register_id and f.treasury_kind = 'main';

create function clinic_reception.shift_is_main() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  new.is_main := exists (select 1 from clinic_reception.registers r join clinic_finance.registers f on f.id = r.finance_register_id
                          where r.id = new.register_id and f.treasury_kind = 'main');
  return new;
end $$;
revoke all on function clinic_reception.shift_is_main() from public, anon, authenticated;
create trigger shift_is_main before insert or update of register_id on clinic_reception.shifts for each row execute function clinic_reception.shift_is_main();

drop index clinic_reception.shifts_register_id_idx;
create unique index shifts_register_id_idx on clinic_reception.shifts(register_id) where status <> 'reviewed' and not is_main;
create unique index shifts_register_main_open on clinic_reception.shifts(register_id) where status = 'open' and is_main;
drop index clinic_reception.shifts_workspace_id_cashier_id_idx;
create unique index shifts_workspace_id_cashier_id_idx on clinic_reception.shifts(workspace_id, cashier_id) where status <> 'reviewed' and not is_main;
create unique index shifts_cashier_main_open on clinic_reception.shifts(workspace_id, cashier_id) where status = 'open' and is_main;

commit;
