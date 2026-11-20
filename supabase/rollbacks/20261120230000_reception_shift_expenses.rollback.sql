-- Rollback of 20261120230000_reception_shift_expenses.sql. Columns, bucket and posted entries stay (history kept).
begin;
drop function if exists public.clinic_finance_shift_expense(text, jsonb);
drop function if exists clinic_finance.shift_expense_spent(uuid);
drop function if exists clinic_finance.shift_expense_items();
do $$ declare d text; begin
  select def into d from clinic_finance.shift_expense_saved_defs where name = 'cash_line_guard';
  if d is not null then execute d; end if;
end $$;
drop table if exists clinic_finance.shift_expense_saved_defs;
drop policy if exists shift_expense_receipts_insert on storage.objects;
drop policy if exists shift_expense_receipts_read on storage.objects;
commit;
