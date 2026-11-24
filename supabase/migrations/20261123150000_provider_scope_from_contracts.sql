-- An approved doctor contract makes the service bookable for that doctor (live case 2026-11-24: د. شادي حسام has an ACTIVE
-- performed / service contract for 0001316 / 0001317 «ليزر 1000 نبضة» valid 2026-11-09 … 2027-12-31, but the booking / order / execution
-- gate refused him — "لا يمكن" — because clinic_reception.provider_service_scopes had no row for him. Main chat 4 counted 262 active,
-- valid-today contracts across 36 active doctors with no scope row: finance approved them, reception could not use them).
-- The gate itself (has_provider_service_scope_contract, 20261114180000) is unchanged: scope row AND matching active contract.
--   1) clinic_reception.sync_scope_from_contracts(doctor_key or null): adds the missing scope rows for every ACTIVE provider whose
--      contract matches the gate's own rule (status active, basis performed, base_scope service, deduction none / cost) and is
--      valid today or later. Idempotent (ON CONFLICT DO NOTHING). Every row it adds is logged in
--      clinic_reception.provider_scope_autofill (provider, code, contract, when) so the rollback removes exactly those rows.
--   2) Backfill now (count in a NOTICE).
--   3) Never again: AFTER triggers on clinic_finance.doctor_contracts (a contract becomes / is updated while active) and on
--      clinic_reception.providers (doctor_key set / changed, or re-activated) call the same function for that doctor_key.
-- Why rows and not "drop the row requirement": the booking screen reads provider_service_scopes from the snapshot to offer the
-- doctor for a service, so the rows must exist for the UI too; unit providers (المعمل / التمريض) also use these rows on their own.
-- A scope row never grants anything by itself for a doctor: the gate still needs the active contract valid on that day.
-- Rollback: supabase/rollbacks/20261123150000_provider_scope_from_contracts.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.provider_service_scopes') is null or to_regclass('clinic_finance.doctor_contracts') is null then
    raise exception 'مكونات نطاق الأطباء غير موجودة'; end if;
  if to_regclass('clinic_reception.provider_scope_autofill') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.provider_scope_autofill (
  provider_id uuid not null references clinic_reception.providers(id) on delete cascade,
  service_code text not null,
  contract_id uuid,
  source text not null check (source in ('backfill', 'contract', 'provider')),
  created_at timestamptz not null default now(),
  primary key (provider_id, service_code)
);
alter table clinic_reception.provider_scope_autofill enable row level security;
revoke all on clinic_reception.provider_scope_autofill from public, anon, authenticated;

create function clinic_reception.sync_scope_from_contracts(p_doctor_key text default null, p_source text default 'backfill') returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare n integer := 0; r record; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  for r in
    select distinct on (p.id, c.service_scope) p.id as provider_id, c.service_scope as code, c.id as contract_id
      from clinic_reception.providers p
      join clinic_finance.doctor_contracts c on c.doctor_key = p.doctor_key
     where p.active and p.doctor_key is not null and (p_doctor_key is null or p.doctor_key = p_doctor_key)
       and c.status = 'active' and c.valid_to >= today
       and c.basis = 'performed' and c.base_scope = 'service' and c.deduction in ('none', 'cost')
       and length(btrim(coalesce(c.service_scope, ''))) > 0
       and not exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p.id and sc.service_code = c.service_scope)
     order by p.id, c.service_scope, c.valid_from
  loop
    insert into clinic_reception.provider_service_scopes(provider_id, service_code) values (r.provider_id, r.code) on conflict do nothing;
    if found then
      n := n + 1;
      insert into clinic_reception.provider_scope_autofill(provider_id, service_code, contract_id, source)
        values (r.provider_id, r.code, r.contract_id, p_source) on conflict do nothing;
    end if;
  end loop;
  return n;
end $$;
revoke all on function clinic_reception.sync_scope_from_contracts(text, text) from public, anon, authenticated;

create function clinic_reception.scope_from_contract_trg() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'active' and new.doctor_key is not null then
    perform clinic_reception.sync_scope_from_contracts(new.doctor_key, 'contract');
  end if;
  return new;
end $$;
revoke all on function clinic_reception.scope_from_contract_trg() from public, anon, authenticated;
create trigger scope_from_contract after insert or update of status, doctor_key, service_scope, valid_to, basis, base_scope, deduction
  on clinic_finance.doctor_contracts for each row execute function clinic_reception.scope_from_contract_trg();

create function clinic_reception.scope_from_provider_trg() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.active and new.doctor_key is not null then
    perform clinic_reception.sync_scope_from_contracts(new.doctor_key, 'provider');
  end if;
  return new;
end $$;
revoke all on function clinic_reception.scope_from_provider_trg() from public, anon, authenticated;
create trigger scope_from_provider after insert or update of doctor_key, active
  on clinic_reception.providers for each row execute function clinic_reception.scope_from_provider_trg();

do $$ declare n integer; gap integer; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  n := clinic_reception.sync_scope_from_contracts(null, 'backfill');
  select count(*) into gap from clinic_reception.providers p join clinic_finance.doctor_contracts c on c.doctor_key = p.doctor_key
   where p.active and c.status = 'active' and today between c.valid_from and c.valid_to and c.basis = 'performed' and c.base_scope = 'service'
     and c.deduction in ('none', 'cost')
     and not exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p.id and sc.service_code = c.service_scope);
  raise notice 'scope rows added from active contracts: %; contracts valid today still without a scope row: %', n, gap;
end $$;

commit;
