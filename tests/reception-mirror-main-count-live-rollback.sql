-- Live rollback test for 20261122220000_reception_mirror_main_count.sql: inside ONE transaction ending with ROLLBACK, apply the fix and
-- call the real clinic_reception_snapshot as an active super admin (the call that returned 409 «shifts_register_id_idx» for everyone).
-- Nothing is kept. Run the whole file as one script.
begin;
-- ===== migration body (20261122220000) =====

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

-- ===== test =====
do $$
declare u uuid; w uuid; snap jsonb; n int; d date := (now() at time zone 'Africa/Cairo')::date;
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select user_id into u from public.admins where role = 'super_admin' and active and user_id is not null order by id limit 1;
  if w is null or u is null then raise exception 'Need the live workspace and an active super admin'; end if;
  perform set_config('request.jwt.claim.sub', u::text, true); execute 'set local role authenticated';
  snap := public.clinic_reception_snapshot(w, d, d);
  execute 'reset role';
  if snap is null then raise exception 'Snapshot returned null'; end if;
  select count(*) into n from clinic_reception.shifts s join clinic_finance.shifts f on f.id = s.finance_shift_id where s.workspace_id = w and f.is_main and f.status <> 'reviewed';
  if n <> (select count(*) from clinic_finance.shifts where is_main and status <> 'reviewed') then raise exception 'Main shifts not all mirrored (% mirrored)', n; end if;
  if (select count(*) from clinic_reception.shifts where workspace_id = w and is_main and status = 'open') > 1 then raise exception 'More than one open main mirror'; end if;
  raise notice 'reception mirror main count live rollback OK: snapshot works, % unreviewed main shifts mirrored', n;
end $$;
rollback;
select jsonb_build_object('test', 'reception mirror main count live rollback passed',
  'fix_left_applied', exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'shifts' and column_name = 'is_main'));
