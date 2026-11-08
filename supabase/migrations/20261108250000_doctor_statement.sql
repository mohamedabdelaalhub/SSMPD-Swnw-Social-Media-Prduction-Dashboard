-- Doctor statement (read-only): one doctor, per invoice, with the service lines, and whether the invoice is FULLY PAID (fee payable now) or still waiting (insurance / credit).
-- Owner decisions 2026-11-08: a fee is payable only once its invoice is paid in full (patient payments + approved insurer payments, net of refunds and approved contractual discounts);
-- credit patients are treated like insurance (waiting); the fee shown is the net fee already computed by the existing accrual (doctor_accruals), not a new calculation.
-- ADDITIVE: 2 new read-only functions. No table, column or existing function changes; nothing is written. NO payout rule changes here (the payout cap is a separate, later change).
-- Rollback: supabase/rollbacks/20261108250000_doctor_statement.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.doctor_allocation_lines') is null or to_regclass('clinic_finance.doctor_accruals') is null or to_regclass('clinic_finance.insurance_actions') is null then
    raise exception 'جداول الاستحقاق أو التأمين غير موجودة؛ طبّق الملفات السابقة أولًا';
  end if;
  if to_regprocedure('clinic_finance.doctor_statement(text,date,date)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function clinic_finance.doctor_statement(p_doctor text, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_name text; v_balance numeric; v_paid_out numeric; v_opening numeric; v_pending numeric; v_now numeric; v_acc numeric; v_inv jsonb;
begin
  perform clinic_finance.require_access('create');
  if p_doctor is null or btrim(p_doctor) = '' then raise exception 'حدد الطبيب'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'راجع فترة الكشف'; end if;
  select max(doctor_name) into v_name from clinic_finance.doctor_contracts where doctor_key = p_doctor;
  return (
  with acc as (select invoice_id, sum(delta) fee from clinic_finance.doctor_accruals where doctor_key = p_doctor group by invoice_id),
  base as (
    select i.id, i.reference, i.patient_ref, i.description, i.created_at, i.amount, i.voided, acc.fee,
      coalesce((select sum(x.amount) from clinic_finance.requests x where x.invoice_id = i.id and x.kind = 'refund' and x.status = 'approved'), 0) refund,
      coalesce((select sum(x.amount) from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id = x.claim_id where c.invoice_id = i.id and x.kind = 'contractual' and x.status = 'approved'), 0) adj,
      coalesce((select sum(amount) from clinic_finance.payments where invoice_id = i.id), 0) paid_patient,
      coalesce((select sum(x.amount) from clinic_finance.insurance_actions x join clinic_finance.insurance_claims c on c.id = x.claim_id where c.invoice_id = i.id and x.kind = 'payment' and x.status = 'approved'), 0) paid_ins,
      (select string_agg(distinct c.insurer, '، ') from clinic_finance.insurance_claims c where c.invoice_id = i.id) insurer
    from acc join clinic_finance.invoices i on i.id = acc.invoice_id),
  calc as (select *, case when voided then 0 else greatest(0, amount - refund - adj) end net, greatest(0, paid_patient - refund + paid_ins) collected from base),
  st as (select *, case when voided then 'void' when collected >= net - 0.005 then 'paid' when insurer is not null then 'insurance' else 'credit' end status from calc),
  totals as (
    select coalesce(sum(fee), 0) acc_total, coalesce(sum(fee) filter (where status = 'paid'), 0) now_total, coalesce(sum(fee) filter (where status <> 'paid' and fee > 0), 0) pending_total from st),
  listed as (
    select jsonb_agg(jsonb_build_object(
      'invoice_id', s.id, 'reference', s.reference, 'patient_ref', s.patient_ref, 'date', (s.created_at at time zone 'Africa/Cairo')::date, 'amount', s.amount, 'net', s.net, 'collected', s.collected,
      'status', s.status, 'insurer', s.insurer, 'fee', round(s.fee, 2),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('service_code', l.service_code, 'service_name', l.service_name, 'amount', l.amount, 'rate', (l.terms->>'rate')::numeric,
                    'fee_estimate', round(greatest(0, l.amount - coalesce(l.line_deduction, 0)) * coalesce((l.terms->>'rate')::numeric, 0) / 100, 2)) order by l.line_no)
                  from clinic_finance.doctor_allocation_lines l join clinic_finance.doctor_allocations a on a.invoice_id = l.invoice_id and a.doctor_key = p_doctor where l.invoice_id = s.id), '[]'::jsonb)
    ) order by s.created_at desc, s.id) j
    from (select * from st where (created_at at time zone 'Africa/Cairo')::date between p_from and p_to order by created_at desc limit 500) s)
  select jsonb_build_object(
    'doctor_key', p_doctor, 'doctor_name', v_name, 'from', p_from, 'to', p_to,
    'summary', jsonb_build_object(
      'accrued', round(t.acc_total, 2), 'payable_invoices', round(t.now_total, 2), 'pending', round(t.pending_total, 2),
      'paid_out', coalesce((select sum(gross) from clinic_finance.doctor_payouts where doctor_key = p_doctor and status = 'approved'), 0),
      'other_credits', round(clinic_finance.doctor_balance(p_doctor) - (select coalesce(sum(delta), 0) from clinic_finance.doctor_accruals where doctor_key = p_doctor) + coalesce((select sum(gross) from clinic_finance.doctor_payouts where doctor_key = p_doctor and status = 'approved'), 0), 2),
      'balance', clinic_finance.doctor_balance(p_doctor),
      'available_to_pay', greatest(0, clinic_finance.doctor_balance(p_doctor) - t.pending_total)),
    'invoices', coalesce((select j from listed), '[]'::jsonb))
  from totals t);
end $$;

create function public.clinic_finance_doctor_statement(p_doctor_key text, p_from date, p_to date) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_finance.doctor_statement(p_doctor_key, p_from, p_to)
$$;

revoke all on function clinic_finance.doctor_statement(text, date, date) from public, anon, authenticated;
revoke all on function public.clinic_finance_doctor_statement(text, date, date) from public, anon;
grant execute on function public.clinic_finance_doctor_statement(text, date, date) to authenticated;

commit;
