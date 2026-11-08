-- Doctor accounts tab + HR staff picker (read-only).
-- Owner feedback 2026-11-08: (1) a separate «حساب الأطباء» tab listing ONLY doctors who have an account, with balance / payable-now / waiting, so nobody opens every doctor to see who is owed;
--                            (2) new doctors registered in HR must show up in accounts so their contract can be set up (pick the HR person instead of typing a code).
-- ADDITIVE: 2 internal read-only functions + 2 public read-only wrappers. No table, column or existing function is changed; nothing is written.
-- Numbers follow the doctor statement exactly (clinic_finance.doctor_statement): waiting = fees of invoices not yet fully paid (insurance / credit), payable_now = max(0, balance - waiting).
-- Needs 20261108250000_doctor_statement.sql to be applied first (same rules); reads clinic_people.people (HR) with SELECT only and returns NO phone / email / birth date / notes.
-- Rollback: supabase/rollbacks/20261108270000_doctor_accounts_tab.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_finance.doctor_statement(text,date,date)') is null then raise exception 'طبّق ملف حساب الدكتور (20261108250000) أولًا'; end if;
  if to_regclass('clinic_people.people') is null then raise exception 'جدول الموارد البشرية غير موجود'; end if;
  if to_regprocedure('clinic_finance.allowed(text)') is null then raise exception 'دالة الصلاحيات المالية غير موجودة'; end if;
  if to_regprocedure('clinic_finance.doctor_accounts()') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- One row per doctor key that HAS an account: any accrual, payout or invoice allocation, or a non-zero balance (opening balance included) or a payout waiting for review.
-- A key that only has a contract (nothing accrued, nothing paid, balance 0) is NOT listed: that doctor has no account yet.
create function clinic_finance.doctor_accounts() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not (clinic_finance.allowed('create') or clinic_finance.allowed('review')) then raise exception 'ليس لديك صلاحية لهذه العملية المالية' using errcode = '42501'; end if;
  return (
  with keys as (
    select doctor_key from clinic_finance.doctor_contracts
    union select doctor_key from clinic_finance.doctor_accruals
    union select doctor_key from clinic_finance.doctor_payouts
    union select doctor_key from clinic_finance.doctor_allocations),
  acc as (select doctor_key, invoice_id, sum(delta) fee from clinic_finance.doctor_accruals where invoice_id is not null group by doctor_key, invoice_id),
  base as (
    select acc.doctor_key, i.id, i.amount, i.voided, acc.fee,
      coalesce((select sum(x.amount) from clinic_finance.requests x where x.invoice_id = i.id and x.kind = 'refund' and x.status = 'approved'), 0) refund,
      coalesce((select sum(x.amount) from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id = x.claim_id where c.invoice_id = i.id and x.kind = 'contractual' and x.status = 'approved'), 0) adj,
      coalesce((select sum(amount) from clinic_finance.payments where invoice_id = i.id), 0) paid_patient,
      coalesce((select sum(x.amount) from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id = x.claim_id where c.invoice_id = i.id and x.kind = 'payment' and x.status = 'approved'), 0) paid_ins
    from acc join clinic_finance.invoices i on i.id = acc.invoice_id),
  calc as (select *, case when voided then 0 else greatest(0, amount - refund - adj) end net, greatest(0, paid_patient - refund + paid_ins) collected from base),
  st as (select *, case when voided then 'void' when collected >= net - 0.005 then 'paid' else 'waiting' end status from calc),
  per as (
    select doctor_key, coalesce(sum(fee), 0) accrued, coalesce(sum(fee) filter (where status <> 'paid' and fee > 0), 0) waiting, count(*) filter (where status <> 'paid' and fee > 0) waiting_invoices
    from st group by doctor_key),
  pay as (
    select doctor_key, coalesce(sum(gross) filter (where status = 'approved'), 0) paid_out, coalesce(sum(gross) filter (where status = 'pending'), 0) pending_payouts, count(*) cnt from clinic_finance.doctor_payouts group by doctor_key),
  nm as (select doctor_key, max(doctor_name) doctor_name, bool_or(status = 'active') has_active from clinic_finance.doctor_contracts group by doctor_key),
  rows as (
    select k.doctor_key, coalesce(nm.doctor_name, k.doctor_key) doctor_name, coalesce(nm.has_active, false) has_active,
      coalesce(per.accrued, 0) accrued, coalesce(per.waiting, 0) waiting, coalesce(per.waiting_invoices, 0) waiting_invoices,
      coalesce(pay.paid_out, 0) paid_out, coalesce(pay.pending_payouts, 0) pending_payouts, coalesce(pay.cnt, 0) payout_count,
      clinic_finance.doctor_balance(k.doctor_key) balance,
      exists(select 1 from clinic_finance.doctor_accruals a where a.doctor_key = k.doctor_key) or exists(select 1 from clinic_finance.doctor_allocations a where a.doctor_key = k.doctor_key) has_accruals
    from keys k left join nm on nm.doctor_key = k.doctor_key left join per on per.doctor_key = k.doctor_key left join pay on pay.doctor_key = k.doctor_key)
  select jsonb_build_object('generated_at', now(), 'doctors', coalesce(jsonb_agg(jsonb_build_object(
      'doctor_key', r.doctor_key, 'doctor_name', r.doctor_name, 'has_active_contract', r.has_active,
      'accrued', round(r.accrued, 2), 'paid_out', round(r.paid_out, 2), 'balance', round(r.balance, 2),
      'waiting', round(r.waiting, 2), 'waiting_invoices', r.waiting_invoices,
      'payable_now', round(greatest(0, r.balance - r.waiting), 2), 'pending_payouts', round(r.pending_payouts, 2))
    order by greatest(0, r.balance - r.waiting) desc, r.doctor_name, r.doctor_key), '[]'::jsonb))
  from rows r
  where r.has_accruals or r.payout_count > 0 or r.balance <> 0 or r.pending_payouts > 0);
end $$;

-- HR staff that can be given a fee contract. Minimal columns only (no phone, email, birth date, notes, national ids).
-- contract_key = the fixed doctor key to use on the contract: the HR doctor_key when HR already linked one, otherwise the HR code (EMP-xxxxxx).
-- A person "needs a contract" when no pending or active contract exists under either key.
create function clinic_finance.hr_staff_for_contracts() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not (clinic_finance.allowed('create') or clinic_finance.allowed('review')) then raise exception 'ليس لديك صلاحية لهذه العملية المالية' using errcode = '42501'; end if;
  return (
  select jsonb_build_object('people', coalesce(jsonb_agg(jsonb_build_object(
      'person_id', p.id, 'code', p.code, 'full_name', p.full_name, 'kind', p.kind, 'status', p.status, 'department', p.department, 'job_title', p.job_title,
      'doctor_key', p.doctor_key, 'contract_key', coalesce(nullif(p.doctor_key, ''), p.code),
      'active_contracts', c.active, 'pending_contracts', c.pending, 'needs_contract', (c.active + c.pending) = 0) order by p.full_name, p.code), '[]'::jsonb))
  from clinic_people.people p
  left join lateral (select count(*) filter (where k.status = 'active') active, count(*) filter (where k.status = 'pending') pending
                     from clinic_finance.doctor_contracts k where k.doctor_key = p.code or (p.doctor_key is not null and k.doctor_key = p.doctor_key)) c on true
  where p.status <> 'ended');
end $$;

create function public.clinic_finance_doctor_accounts() returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_finance.doctor_accounts()
$$;
create function public.clinic_finance_hr_staff() returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_finance.hr_staff_for_contracts()
$$;

revoke all on function clinic_finance.doctor_accounts(), clinic_finance.hr_staff_for_contracts() from public, anon, authenticated;
revoke all on function public.clinic_finance_doctor_accounts(), public.clinic_finance_hr_staff() from public, anon;
grant execute on function public.clinic_finance_doctor_accounts(), public.clinic_finance_hr_staff() to authenticated;

commit;
