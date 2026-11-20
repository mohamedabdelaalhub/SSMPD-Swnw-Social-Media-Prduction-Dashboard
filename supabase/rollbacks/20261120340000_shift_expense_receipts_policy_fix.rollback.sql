-- Rollback of 20261120340000. Do NOT restore the direct clinic_finance.allowed() call (it breaks every storage read);
-- this only removes the receipt read policy for reviewers' folder-less access and the wrapper.
begin;
drop policy if exists shift_expense_receipts_read on storage.objects;
create policy shift_expense_receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'shift-expense-receipts' and (storage.foldername(name))[1] = auth.uid()::text);
drop function if exists public.shift_expense_receipt_review_allowed();
commit;
