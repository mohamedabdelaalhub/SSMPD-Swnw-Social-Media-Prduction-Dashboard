-- Rollback of 20261126210000_employee_debt.sql. Refuses once any debt was approved (its journal / allocation / advance rows are
-- real books — reverse them with entries, never by deleting). Restores the two cash guards, the business command and the
-- allocations source check, then drops the feature.
begin;
do $$ begin
  if to_regclass('clinic_finance.employee_debts') is null then raise exception 'الملف مش متطبق'; end if;
  if exists (select 1 from clinic_finance.employee_debts where status = 'approved') then
    raise exception 'فيه مديونيات موظفين اتعتمدت — مينفعش ترجع الملف'; end if;
end $$;
do $$ begin
  execute (select def from clinic_finance.employee_debt_saved_defs where name = 'cash_line_guard');
  execute (select def from clinic_finance.employee_debt_saved_defs where name = 'ended_shift_entry_guard');
end $$;
drop function public.clinic_finance_business_command(text, jsonb, uuid);
alter function clinic_finance.business_command_before_employee_debt(text, jsonb, uuid) rename to clinic_finance_business_command;
alter function clinic_finance.clinic_finance_business_command(text, jsonb, uuid) set schema public;
revoke all on function public.clinic_finance_business_command(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_business_command(text, jsonb, uuid) to authenticated;
drop function public.clinic_finance_employee_debt(text, jsonb);
drop function clinic_finance.employee_debt_row(clinic_finance.employee_debts);
drop function clinic_finance.employee_debt_materialize(uuid);
drop function clinic_finance.employee_debt_post(uuid, text, uuid, text, text, text, numeric, jsonb, uuid, uuid);
drop function clinic_finance.employee_debt_ok(uuid, uuid, numeric);
alter table clinic_reception.allocations drop constraint allocations_source_check;
alter table clinic_reception.allocations add constraint allocations_source_check check (source in ('payment', 'package', 'credit'));
drop table clinic_finance.employee_debt_installments;
drop table clinic_finance.employee_debts;
drop table clinic_finance.employee_debt_saved_defs;
commit;
