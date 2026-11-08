-- Doctor dues by invoice (owner request 2026-11-09): the dues screen lists EVERY case the doctor treated with its status, and the payout request carries the CHOSEN invoices.
--   * clinic_finance.doctor_payout_invoices : which invoices (and their fee at request time) each payout covers. Created empty, written only by the command below.
--   * public.clinic_finance_doctor_dues(doctor, from, to)           : READ-ONLY. Statement detail + per-invoice dues_status: payable / requested (in a pending payout) / paid_out (approved payout)
--                                                                       / waiting_patient / waiting_insurer / waiting_both; plus services without an active contract; totals incl. the amount the payout gate allows now.
--   * public.clinic_finance_doctor_payout_invoices(...)             : creates the payout through the EXISTING public.clinic_finance_doctor_command('payout') (all its gates stay: payable-now cap, tax/withholding rules, cash shift, maker-checker review by the financial manager),
--                                                                       with gross = sum of the chosen invoices' fees (all must be fully paid and not already in a pending/approved payout). A rejected payout frees its invoices again.
-- ADDITIVE: 1 new table + 3 functions. No existing function/table/ledger posting is changed. Needs 20261108250000, 20261108260000 (payout phase 2) and 20261108280000 (statement detail).
-- Limitation: payouts made BEFORE this change (lump sums) are not linked to invoices, so their invoices still show as payable; the payout gate (balance - held fees - pending) still stops any over-payment.
-- Rollback: supabase/rollbacks/20261109100000_doctor_payout_by_invoice.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_finance.doctor_statement_detail(text,date,date)') is null then raise exception 'طبّق ملف تفاصيل حساب الدكتور (20261108280000) أولًا'; end if;
  if to_regprocedure('clinic_finance.doctor_payable_now(text)') is null or to_regprocedure('clinic_finance.invoice_fully_paid(uuid)') is null then raise exception 'طبّق ملف صرف الأطباء المرحلة الثانية (20261108260000) أولًا'; end if;
  if to_regclass('clinic_finance.doctor_payout_invoices') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_finance.doctor_payout_invoices (
  payout_id uuid not null references clinic_finance.doctor_payouts(id),
  invoice_id uuid not null references clinic_finance.invoices(id),
  doctor_key text not null,
  fee numeric(14,2) not null check (fee > 0),
  created_at timestamptz not null default now(),
  primary key (payout_id, invoice_id)
);
create index doctor_payout_invoices_lookup on clinic_finance.doctor_payout_invoices(doctor_key, invoice_id);
alter table clinic_finance.doctor_payout_invoices enable row level security;
revoke all on clinic_finance.doctor_payout_invoices from public, anon, authenticated;

create function clinic_finance.doctor_dues(p_doctor text, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d jsonb; v_inv jsonb; v_pending numeric; v_now numeric; v_sum jsonb;
begin
  d := clinic_finance.doctor_statement_detail(p_doctor, p_from, p_to);   -- access check (create) + input validation + statement fields
  select coalesce(jsonb_agg(x.v || jsonb_build_object('dues_status', x.st, 'selectable', x.st = 'payable', 'payout_id', x.pid) order by x.ord), '[]'::jsonb) into v_inv
  from (
    select inv.ord, inv.v, l.payout_id pid,
      case when l.status = 'approved' then 'paid_out' when l.status = 'pending' then 'requested'
           when inv.v->>'status' = 'paid' then 'payable'
           when inv.v->>'status' = 'insurance' then case when coalesce((inv.v->>'patient_open')::numeric, 0) > 0 and coalesce((inv.v->>'insurer_open')::numeric, 0) > 0 then 'waiting_both'
                                                          when coalesce((inv.v->>'patient_open')::numeric, 0) > 0 then 'waiting_patient' else 'waiting_insurer' end
           else 'waiting_patient' end st
    from jsonb_array_elements(coalesce(d->'invoices', '[]'::jsonb)) with ordinality inv(v, ord)
    left join lateral (select k.payout_id, q.status from clinic_finance.doctor_payout_invoices k join clinic_finance.doctor_payouts q on q.id = k.payout_id
                       where k.doctor_key = p_doctor and k.invoice_id = (inv.v->>'invoice_id')::uuid and q.status in ('pending', 'approved') order by q.created_at desc limit 1) l on true
    where inv.v->>'status' <> 'void' and coalesce((inv.v->>'fee')::numeric, 0) > 0) x;
  v_pending := coalesce((select sum(gross) from clinic_finance.doctor_payouts where doctor_key = p_doctor and status = 'pending'), 0);
  v_now := clinic_finance.doctor_payable_now(p_doctor);
  select jsonb_build_object(
    'payable_total', coalesce(sum((i->>'fee')::numeric) filter (where i->>'dues_status' = 'payable'), 0),
    'requested_total', coalesce(sum((i->>'fee')::numeric) filter (where i->>'dues_status' = 'requested'), 0),
    'paid_out_total', coalesce(sum((i->>'fee')::numeric) filter (where i->>'dues_status' = 'paid_out'), 0),
    'waiting_total', coalesce(sum((i->>'fee')::numeric) filter (where i->>'dues_status' like 'waiting%'), 0),
    'payable_now', v_now, 'pending_payouts', v_pending, 'available_now', greatest(0, v_now - v_pending)) into v_sum
  from jsonb_array_elements(v_inv) i;
  return jsonb_set(d, '{invoices}', v_inv) || jsonb_build_object('dues', v_sum);
end $$;

create function public.clinic_finance_doctor_dues(p_doctor_key text, p_from date, p_to date) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_finance.doctor_dues(p_doctor_key, p_from, p_to)
$$;

create function public.clinic_finance_doctor_payout_invoices(p_doctor_key text, p_invoice_ids uuid[], p_tax_pct numeric, p_withholding_pct numeric, p_method text, p_shift_id uuid, p_reference text, p_from date, p_to date, p_token uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; v uuid; ex record; ids uuid[]; v_gross numeric := 0; v_fee numeric; one uuid; v_pl jsonb; fees jsonb := '{}'::jsonb; tax_amt numeric; wh_amt numeric;
begin
  me := clinic_finance.require_access('create');
  if p_doctor_key is null or length(trim(p_doctor_key)) < 2 then raise exception 'اختر الطبيب'; end if;
  if p_invoice_ids is null or coalesce(array_length(p_invoice_ids, 1), 0) = 0 then raise exception 'اختر فاتورة واحدة على الأقل'; end if;
  if p_tax_pct is null or p_withholding_pct is null then raise exception 'حدد نسبة الضريبة ونسبة الاستقطاع (اكتب 0 إن لم تنطبق)'; end if;
  select array_agg(distinct x order by x) into ids from unnest(p_invoice_ids) x where x is not null;
  perform pg_advisory_xact_lock(hashtext('doctor_payout_invoices'), hashtext(p_doctor_key));
  select id, payload into ex from clinic_finance.doctor_payouts where created_by = me and token = p_token;
  if found then   -- idempotent replay: same token must mean the same request
    if ex.payload->'invoice_ids' is distinct from to_jsonb(ids) or ex.payload->>'doctor_key' is distinct from p_doctor_key then raise exception 'مفتاح طلب مختلف'; end if;
    return ex.id;
  end if;
  foreach one in array ids loop
    select coalesce(sum(delta), 0) into v_fee from clinic_finance.doctor_accruals where doctor_key = p_doctor_key and invoice_id = one;
    if v_fee <= 0 then raise exception 'إحدى الفواتير ليست من أتعاب هذا الطبيب'; end if;
    if exists(select 1 from clinic_finance.invoices where id = one and voided) then raise exception 'إحدى الفواتير ملغاة'; end if;
    if not clinic_finance.invoice_fully_paid(one) then raise exception 'إحدى الفواتير لم تُسدَّد بالكامل بعد؛ لا تُصرف أتعابها الآن'; end if;
    if exists(select 1 from clinic_finance.doctor_payout_invoices k join clinic_finance.doctor_payouts q on q.id = k.payout_id where k.doctor_key = p_doctor_key and k.invoice_id = one and q.status in ('pending', 'approved')) then
      raise exception 'إحدى الفواتير مشمولة بطلب صرف سابق (معلّق أو معتمد)'; end if;
    v_gross := v_gross + v_fee; fees := fees || jsonb_build_object(one::text, v_fee);
  end loop;
  tax_amt := round(v_gross * p_tax_pct / 100, 2); wh_amt := round(v_gross * p_withholding_pct / 100, 2);
  v_pl := jsonb_build_object('doctor_key', p_doctor_key, 'gross', v_gross, 'tax_pct', p_tax_pct, 'withholding_pct', p_withholding_pct, 'withheld', tax_amt + wh_amt, 'method', p_method,
    'reference', p_reference, 'from', p_from, 'to', p_to, 'invoice_ids', to_jsonb(ids));
  if p_shift_id is not null then v_pl := v_pl || jsonb_build_object('shift_id', p_shift_id); end if;
  v := public.clinic_finance_doctor_command('payout', v_pl, p_token);   -- every existing gate (payable-now cap, tax rules, cash shift, reference) runs here
  insert into clinic_finance.doctor_payout_invoices(payout_id, invoice_id, doctor_key, fee) select v, k::uuid, p_doctor_key, (fees->>k)::numeric from jsonb_object_keys(fees) k;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'doctor_payout_invoices', v, jsonb_build_object('doctor_key', p_doctor_key, 'invoice_count', array_length(ids, 1), 'gross', v_gross));
  return v;
end $$;

revoke all on function clinic_finance.doctor_dues(text, date, date) from public, anon, authenticated;
revoke all on function public.clinic_finance_doctor_dues(text, date, date), public.clinic_finance_doctor_payout_invoices(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) from public, anon;
grant execute on function public.clinic_finance_doctor_dues(text, date, date), public.clinic_finance_doctor_payout_invoices(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) to authenticated;

commit;
