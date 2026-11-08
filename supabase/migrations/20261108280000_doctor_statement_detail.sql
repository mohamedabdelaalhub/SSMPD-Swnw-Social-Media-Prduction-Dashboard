-- Doctor statement DETAIL (read-only), owner decisions 2026-11-08:
--  (1) insurance invoices: split what is still owed by the PATIENT (invoice amount - claim amount, minus patient payments net of refunds)
--      from what is still owed by the INSURER (claim amount - approved contractual adjustments - approved insurer payments);
--  (2) «خدمات بدون عقد ساري»: services COMPLETED by the doctor in the reception module (clinic_reception.orders) on a date where the doctor had NO active contract covering the service
--      (exact service code or the whole department), only for doctors that have at least one active contract.
-- LIMITATION (by design of the data): finance invoices can only be tied to a doctor through doctor_allocations, and billing refuses a doctor service without a matching contract,
-- so an uncovered service cannot exist there. Reception orders are the only place where a performed service is linked to a doctor without a contract check.
-- ADDITIVE: wraps the existing clinic_finance.doctor_statement (unchanged) and adds 2 read-only functions. Needs 20261108250000. Nothing is written.
-- Rollback: supabase/rollbacks/20261108280000_doctor_statement_detail.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_finance.doctor_statement(text,date,date)') is null then raise exception 'طبّق ملف حساب الدكتور (20261108250000) أولًا'; end if;
  if to_regprocedure('clinic_finance.doctor_statement_detail(text,date,date)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function clinic_finance.doctor_statement_detail(p_doctor text, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare base jsonb; v_invoices jsonb; v_active boolean; v_uncovered jsonb := null;
begin
  base := clinic_finance.doctor_statement(p_doctor, p_from, p_to);   -- performs the access check and validates the input
  select coalesce(jsonb_agg(inv.v || jsonb_build_object('claim_amount', round(x.claim, 2), 'patient_open', round(x.patient_open, 2), 'insurer_open', round(x.insurer_open, 2)) order by inv.ord), '[]'::jsonb) into v_invoices
  from jsonb_array_elements(coalesce(base->'invoices', '[]'::jsonb)) with ordinality inv(v, ord)
  left join lateral (
    select c.claim,
      greatest(0, greatest(0, i.amount - c.claim) - greatest(0, c.paid_patient - c.refund)) patient_open,
      greatest(0, c.claim - c.adj - c.paid_ins) insurer_open
    from clinic_finance.invoices i
    cross join lateral (select
      coalesce((select sum(k.amount) from clinic_finance.insurance_claims k where k.invoice_id = i.id), 0) claim,
      coalesce((select sum(a.amount) from clinic_finance.insurance_actions a join clinic_finance.insurance_claims k on k.id = a.claim_id where k.invoice_id = i.id and a.kind = 'contractual' and a.status = 'approved'), 0) adj,
      coalesce((select sum(a.amount) from clinic_finance.insurance_actions a join clinic_finance.insurance_claims k on k.id = a.claim_id where k.invoice_id = i.id and a.kind = 'payment' and a.status = 'approved'), 0) paid_ins,
      coalesce((select sum(amount) from clinic_finance.payments where invoice_id = i.id), 0) paid_patient,
      coalesce((select sum(r.amount) from clinic_finance.requests r where r.invoice_id = i.id and r.kind = 'refund' and r.status = 'approved'), 0) refund) c
    where i.id = (inv.v->>'invoice_id')::uuid) x on true;

  select exists(select 1 from clinic_finance.doctor_contracts where doctor_key = p_doctor and status = 'active') into v_active;
  if v_active and to_regclass('clinic_reception.orders') is not null and to_regclass('clinic_reception.providers') is not null and to_regclass('clinic_reception.services') is not null and to_regclass('clinic_reception.workspaces') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('order_id', u.id, 'date', u.d, 'service_code', u.code, 'service_name', u.name, 'department', u.department, 'amount', u.amount,
        'reason', case when exists(select 1 from clinic_finance.doctor_contracts c where c.doctor_key = p_doctor and c.status = 'active' and (c.service_scope = u.code or c.service_scope = 'قسم:' || u.department) and c.valid_from > u.d) then 'starts_later'
                       when exists(select 1 from clinic_finance.doctor_contracts c where c.doctor_key = p_doctor and c.status = 'active' and (c.service_scope = u.code or c.service_scope = 'قسم:' || u.department) and c.valid_to < u.d) then 'expired'
                       when exists(select 1 from clinic_finance.doctor_contracts c where c.doctor_key = p_doctor and c.status = 'pending' and (c.service_scope = u.code or c.service_scope = 'قسم:' || u.department)) then 'pending'
                       else 'none' end) order by u.d desc, u.id), '[]'::jsonb) into v_uncovered
    from (select o.id, (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date d, s.code, s.name, s.department, round(o.price * o.quantity * (1 - o.discount / 100), 2) amount
          from clinic_reception.orders o
          join clinic_reception.providers p on p.id = o.provider_id and p.doctor_key = p_doctor
          join clinic_reception.workspaces w on w.id = o.workspace_id and w.mode = 'live'
          join clinic_reception.services s on s.id = o.service_id
          where o.status = 'completed' and (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date between p_from and p_to
            and not exists(select 1 from clinic_finance.doctor_contracts c where c.doctor_key = p_doctor and c.status = 'active' and (c.service_scope = s.code or c.service_scope = 'قسم:' || s.department)
                           and c.valid_from <= (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date and c.valid_to >= (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date)
          order by 2 desc limit 200) u;
  end if;
  return jsonb_set(base, '{invoices}', v_invoices) || jsonb_build_object('has_active_contract', v_active, 'uncovered', v_uncovered);
end $$;

create function public.clinic_finance_doctor_statement_detail(p_doctor_key text, p_from date, p_to date) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_finance.doctor_statement_detail(p_doctor_key, p_from, p_to)
$$;

revoke all on function clinic_finance.doctor_statement_detail(text, date, date) from public, anon, authenticated;
revoke all on function public.clinic_finance_doctor_statement_detail(text, date, date) from public, anon;
grant execute on function public.clinic_finance_doctor_statement_detail(text, date, date) to authenticated;

commit;
