-- Rollback of 20261126010000_shift_expense_more_items.sql: restores the three functions (items, spend, post). Expenses already recorded under the new items stay
-- (posted to 5224 / 5216 with their item key) — nothing is deleted.
begin;
do $$ begin
  execute (select def from clinic_finance.shift_expense_items_saved_defs where name = 'shift_expense_items');
  execute (select def from clinic_finance.shift_expense_items_saved_defs where name = 'clinic_finance_shift_expense');
  execute (select def from clinic_finance.shift_expense_items_saved_defs where name = 'post');
end $$;
drop table clinic_finance.shift_expense_items_saved_defs;
commit;
