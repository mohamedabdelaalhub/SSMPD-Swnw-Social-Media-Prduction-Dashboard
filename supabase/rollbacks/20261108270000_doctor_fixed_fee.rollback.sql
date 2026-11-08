-- Rollback of 20261108270000_doctor_fixed_fee.sql: restores bill / doctor_sync / clinic_finance_doctor_command exactly as they were (they were only moved/renamed),
-- the statement and doctor_held_fees texts, and removes the fixed-fee columns and the extra-performer tables.
-- REFUSED while anything still depends on the new features (a percent-only function would silently recompute a fixed fee as 0 and reverse the accrual):
--   active/pending fixed contracts, invoices allocated to a fixed contract, or invoices with extra performers. Reject/expire those first.
-- Rejected/superseded fixed contracts are copied to clinic_finance.doctor_contracts_fixed_backup before the columns are dropped.
begin;
do $$ begin
  if to_regprocedure('clinic_finance.bill_before_fixed(jsonb,uuid)') is null then raise exception 'ملف المبلغ الثابت غير مطبق؛ لا يوجد ما يُتراجع عنه'; end if;
  if exists (select 1 from clinic_finance.doctor_contracts where fee_kind = 'fixed' and status in ('pending', 'active'))
     or exists (select 1 from clinic_finance.doctor_allocation_lines l join clinic_finance.doctor_contracts k on k.id = l.contract_id where k.fee_kind = 'fixed')
     or exists (select 1 from clinic_finance.doctor_allocations a join clinic_finance.doctor_contracts k on k.id = a.contract_id where k.fee_kind = 'fixed')
     or exists (select 1 from clinic_finance.doctor_extra_allocations) then
    raise exception 'توجد عقود أو فواتير بمبلغ ثابت أو مشاركون في الأداء؛ لا يمكن التراجع قبل رفضها/إنهائها';
  end if;
end $$;

drop function public.clinic_finance_fixed_fee_enabled();

do $mig$
declare f text;
begin
  if to_regprocedure('clinic_finance.doctor_held_fees(text)') is not null then
    execute $q$create or replace function clinic_finance.doctor_held_fees(p_key text) returns numeric language sql stable security definer set search_path = pg_catalog, public as $b$
  select coalesce(sum(a.earned), 0) from clinic_finance.doctor_allocations a
  where a.doctor_key = p_key and a.earned > 0 and not clinic_finance.invoice_fully_paid(a.invoice_id)
$b$$q$;
  end if;
  if to_regprocedure('clinic_finance.doctor_statement(text,date,date)') is not null then
    f := pg_get_functiondef('clinic_finance.doctor_statement(text,date,date)'::regprocedure);
    f := replace(f, ' ''fee_kind'', (select c.fee_kind from clinic_finance.doctor_contracts c where c.id = l.contract_id), ''fixed_amount'', (select c.fixed_amount from clinic_finance.doctor_contracts c where c.id = l.contract_id),', '');
    f := replace(f, '''fee_estimate'', case when (select c.fee_kind from clinic_finance.doctor_contracts c where c.id = l.contract_id) = ''fixed'' then round((select c.fixed_amount from clinic_finance.doctor_contracts c where c.id = l.contract_id), 2) else round(greatest(0, l.amount - coalesce(l.line_deduction, 0)) * coalesce((l.terms->>''rate'')::numeric, 0) / 100, 2) end',
                    '''fee_estimate'', round(greatest(0, l.amount - coalesce(l.line_deduction, 0)) * coalesce((l.terms->>''rate'')::numeric, 0) / 100, 2)');
    execute f;
  end if;
  if to_regclass('clinic_reception.doctor_agreements') is not null then
    execute 'drop trigger if exists doctor_agreements_refuse_fixed on clinic_reception.doctor_agreements';
    execute 'drop function if exists clinic_reception.refuse_fixed_contract_link()';
  end if;
end $mig$;

drop function public.clinic_finance_bill(jsonb, uuid);
alter function clinic_finance.bill_before_fixed(jsonb, uuid) set schema public;
alter function public.bill_before_fixed(jsonb, uuid) rename to clinic_finance_bill;
drop function clinic_finance.doctor_sync(uuid);
alter function clinic_finance.doctor_sync_pre_fixed(uuid) rename to doctor_sync;
drop function public.clinic_finance_doctor_command(text, jsonb, uuid);
alter function clinic_finance.doctor_command_before_fixed(text, jsonb, uuid) set schema public;
alter function public.doctor_command_before_fixed(text, jsonb, uuid) rename to clinic_finance_doctor_command;

drop function clinic_finance.doctor_extra_sync(uuid);
drop function clinic_finance.doctor_sync_fixed(uuid);
drop function clinic_finance.doctor_invoice_money(uuid);
drop table clinic_finance.doctor_extra_lines;
drop table clinic_finance.doctor_extra_allocations;

create table if not exists clinic_finance.doctor_contracts_fixed_backup as select * from clinic_finance.doctor_contracts where false;
insert into clinic_finance.doctor_contracts_fixed_backup select c.* from clinic_finance.doctor_contracts c where c.fee_kind = 'fixed' and not exists (select 1 from clinic_finance.doctor_contracts_fixed_backup b where b.id = c.id);
revoke all on clinic_finance.doctor_contracts_fixed_backup from public, anon, authenticated;
drop trigger doctor_contracts_fee_from_payload on clinic_finance.doctor_contracts;
drop function clinic_finance.contract_fee_from_payload();
alter table clinic_finance.doctor_contracts drop constraint doctor_contracts_fee_ck;
alter table clinic_finance.doctor_contracts drop column fee_kind, drop column fixed_amount;
commit;
