-- Hotfix (applied live 2026-11-20 20:53Z by main chat 4, owner «موافق على تصليح فتح الملفات»); this file records it.
-- 20261120230000 created storage policy shift_expense_receipts_read calling clinic_finance.allowed('review') directly.
-- `authenticated` has no EXECUTE on that private function, and Postgres may evaluate the call for rows of ANY bucket, so
-- every storage.objects read by a signed-in user failed («permission denied for function allowed» — e.g. opening videos).
-- Fix: a narrow SECURITY DEFINER wrapper callable by authenticated, and the policy recreated with the same logic.
-- Idempotent. Rollback: supabase/rollbacks/20261120340000_shift_expense_receipts_policy_fix.rollback.sql
begin;

create or replace function public.shift_expense_receipt_review_allowed() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(clinic_finance.allowed('review'), false)
$$;
revoke all on function public.shift_expense_receipt_review_allowed() from public, anon;
grant execute on function public.shift_expense_receipt_review_allowed() to authenticated;

drop policy if exists shift_expense_receipts_read on storage.objects;
create policy shift_expense_receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'shift-expense-receipts'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.shift_expense_receipt_review_allowed()));

commit;
