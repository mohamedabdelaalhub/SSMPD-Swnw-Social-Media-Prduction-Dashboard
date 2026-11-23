-- «صرف مستحقات بالفواتير» shows the reception invoices too (owner 2026-11-22 «طبقه»; financial manager screenshot: «المتاح للصرف حسب
-- الرصيد 650» but «مفيش فواتير ليها أتعاب للدكتور في آخر سنة» for د. أحمد سمير).
-- On live a reception visit posts the doctor's fee ONLY in the reception journal (source doctor_fee / referral_fee, 5111 → 2120 with
-- provider_id + invoice_id; reversals service_void_doctor / doctor_credit_note / …), never as clinic_finance.doctor_accruals. The balance
-- (clinic_finance.doctor_balance) counts those lines, the reception desk «صرف الحساب» already lists them (clinic_finance.desk_rx_fees,
-- 20261119010000), but the accounting by-invoice screen (clinic_finance.doctor_dues / public.clinic_finance_doctor_payout_invoices,
-- 20261109100000) read accruals only — 5 doctors / 2,125.00 on live were payable but not choosable.
-- Change (wrappers; the earlier bodies are kept as *_before_rx and still handle finance invoices exactly as before):
--   * clinic_finance.doctor_dues adds every reception invoice with a fee for the doctor in the period (net of reversals, same source as the
--     desk): reference «RX-<no>», patient + file no, service, fee left after pending/approved payouts, status payable (patient part paid and
--     no open insurance claim) / waiting_patient / waiting_insurer / requested / paid_out; the totals include them.
--   * public.clinic_finance_doctor_payout_invoices accepts reception invoice ids next to finance ones. Reception lines are recorded in the
--     existing clinic_finance.desk_payout_rx (so the desk and this screen never pay the same line twice), finance lines as before. The payout
--     itself is still created by public.clinic_finance_doctor_command('payout') — payable-now cap, tax rules, cash shift, reference and the
--     financial manager's maker-checker review are unchanged. A rejected payout frees its lines again.
-- Rollback: supabase/rollbacks/20261122290000_doctor_dues_reception_invoices.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_finance.doctor_dues(text,date,date)') is null
     or to_regprocedure('public.clinic_finance_doctor_payout_invoices(text,uuid[],numeric,numeric,text,uuid,text,date,date,uuid)') is null
     or to_regprocedure('clinic_finance.desk_rx_fees(text)') is null or to_regclass('clinic_finance.desk_payout_rx') is null then
    raise exception 'مكونات صرف الأطباء بالفواتير أو صرف الاستقبال غير موجودة'; end if;
  if to_regprocedure('clinic_finance.doctor_dues_before_rx(text,date,date)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter function clinic_finance.doctor_dues(text, date, date) rename to doctor_dues_before_rx;
alter function public.clinic_finance_doctor_payout_invoices(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) rename to clinic_finance_doctor_payout_invoices_before_rx;
alter function public.clinic_finance_doctor_payout_invoices_before_rx(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) set schema clinic_finance;
revoke all on function clinic_finance.doctor_dues_before_rx(text, date, date) from public, anon, authenticated;
revoke all on function clinic_finance.clinic_finance_doctor_payout_invoices_before_rx(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) from public, anon, authenticated;

-- reception lines of one doctor with what is still payable on each
create function clinic_finance.rx_dues(p_doctor text) returns table(invoice_id uuid, reference text, created_at timestamptz, fee numeric, left_fee numeric,
  paid boolean, pending boolean, approved numeric, patient_open numeric, insurer_open numeric, insurer text, patient_ref text, service text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select r.invoice_id, r.reference, r.created_at, r.fee,
         r.fee - coalesce(lk.pending_fee, 0) - coalesce(lk.approved_fee, 0),
         r.paid, coalesce(lk.pending_fee, 0) > 0, coalesce(lk.approved_fee, 0),
         greatest(0, clinic_reception.due(r.invoice_id)),
         coalesce((select sum(c.amount - c.paid - c.contractual) from clinic_reception.claims c where c.invoice_id = r.invoice_id and c.paid + c.contractual < c.amount), 0),
         (select e.name from clinic_reception.claims c join clinic_reception.entities e on e.id = c.entity_id where c.invoice_id = r.invoice_id limit 1),
         (select pt.name || coalesce(' — ' || pt.file_no, '') from clinic_reception.invoices i join clinic_reception.patients pt on pt.id = i.patient_id where i.id = r.invoice_id),
         coalesce((select o.snapshot->>'name' from clinic_reception.invoices i join clinic_reception.orders o on o.id = i.order_id where i.id = r.invoice_id), r.description)
  from clinic_finance.desk_rx_fees(p_doctor) r
  left join lateral (select sum(k.fee) filter (where q.status = 'pending') pending_fee, sum(k.fee) filter (where q.status = 'approved') approved_fee
                       from clinic_finance.desk_payout_rx k join clinic_finance.doctor_payouts q on q.id = k.payout_id
                      where k.doctor_key = p_doctor and k.rx_invoice_id = r.invoice_id) lk on true
$$;
revoke all on function clinic_finance.rx_dues(text) from public, anon, authenticated;

create function clinic_finance.doctor_dues(p_doctor text, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d jsonb; rx jsonb; v_inv jsonb; v_sum jsonb;
begin
  d := clinic_finance.doctor_dues_before_rx(p_doctor, p_from, p_to);   -- access check + validation + finance invoices, unchanged
  select coalesce(jsonb_agg(jsonb_build_object(
      'invoice_id', x.invoice_id, 'source', 'reception', 'reference', x.reference, 'patient_ref', x.patient_ref,
      'date', to_char(x.created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'), 'lines', jsonb_build_array(jsonb_build_object('service_name', x.service)),
      'fee', case when x.st in ('payable', 'waiting_patient', 'waiting_insurer', 'waiting_both') then x.left_fee else x.fee end,
      'patient_open', x.patient_open, 'insurer_open', x.insurer_open, 'insurer', x.insurer,
      'dues_status', x.st, 'selectable', x.st = 'payable') order by x.created_at), '[]'::jsonb) into rx
  from (select q.*, case when q.left_fee <= 0 and q.pending then 'requested' when q.left_fee <= 0 then 'paid_out'
                         when q.paid then 'payable'
                         when q.patient_open > 0 and q.insurer_open > 0 then 'waiting_both'
                         when q.insurer_open > 0 then 'waiting_insurer' else 'waiting_patient' end st
          from clinic_finance.rx_dues(p_doctor) q
         where (q.created_at at time zone 'Africa/Cairo')::date between p_from and p_to) x;
  v_inv := coalesce(d->'invoices', '[]'::jsonb) || rx;
  select jsonb_build_object(
    'payable_total', coalesce(sum((i->>'fee')::numeric) filter (where i->>'dues_status' = 'payable'), 0),
    'requested_total', coalesce(sum((i->>'fee')::numeric) filter (where i->>'dues_status' = 'requested'), 0),
    'paid_out_total', coalesce(sum((i->>'fee')::numeric) filter (where i->>'dues_status' = 'paid_out'), 0),
    'waiting_total', coalesce(sum((i->>'fee')::numeric) filter (where i->>'dues_status' like 'waiting%'), 0),
    'reception_count', jsonb_array_length(rx)) into v_sum
  from jsonb_array_elements(v_inv) i;
  return jsonb_set(d, '{invoices}', v_inv) || jsonb_build_object('dues', coalesce(d->'dues', '{}'::jsonb) || v_sum);
end $$;
revoke all on function clinic_finance.doctor_dues(text, date, date) from public, anon, authenticated;

create function public.clinic_finance_doctor_payout_invoices(p_doctor_key text, p_invoice_ids uuid[], p_tax_pct numeric, p_withholding_pct numeric, p_method text, p_shift_id uuid, p_reference text, p_from date, p_to date, p_token uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; v uuid; ex record; ids uuid[]; rx_ids uuid[]; fin_ids uuid[]; one uuid; v_fee numeric; v_gross numeric := 0; fees jsonb := '{}'::jsonb; rxfees jsonb := '{}'::jsonb;
  r record; v_pl jsonb; tax_amt numeric; wh_amt numeric;
begin
  if p_invoice_ids is null or coalesce(array_length(p_invoice_ids, 1), 0) = 0 then
    return clinic_finance.clinic_finance_doctor_payout_invoices_before_rx(p_doctor_key, p_invoice_ids, p_tax_pct, p_withholding_pct, p_method, p_shift_id, p_reference, p_from, p_to, p_token);
  end if;
  select array_agg(distinct x order by x) into ids from unnest(p_invoice_ids) x where x is not null;
  select array_agg(x order by x) into rx_ids from unnest(ids) x where exists (select 1 from clinic_reception.invoices i where i.id = x) and not exists (select 1 from clinic_finance.invoices f where f.id = x);
  if rx_ids is null then   -- finance invoices only: exactly the earlier path
    return clinic_finance.clinic_finance_doctor_payout_invoices_before_rx(p_doctor_key, p_invoice_ids, p_tax_pct, p_withholding_pct, p_method, p_shift_id, p_reference, p_from, p_to, p_token);
  end if;
  me := clinic_finance.require_access('create');
  if p_doctor_key is null or length(trim(p_doctor_key)) < 2 then raise exception 'اختر الطبيب'; end if;
  if p_tax_pct is null or p_withholding_pct is null then raise exception 'حدد نسبة الضريبة ونسبة الاستقطاع (اكتب 0 إن لم تنطبق)'; end if;
  select array_agg(x order by x) into fin_ids from unnest(ids) x where not (x = any(rx_ids));
  perform pg_advisory_xact_lock(hashtext('doctor_payout_invoices'), hashtext(p_doctor_key));
  select id, payload into ex from clinic_finance.doctor_payouts where created_by = me and token = p_token;
  if found then
    if ex.payload->'invoice_ids' is distinct from to_jsonb(ids) or ex.payload->>'doctor_key' is distinct from p_doctor_key then raise exception 'مفتاح طلب مختلف'; end if;
    return ex.id;
  end if;
  foreach one in array coalesce(fin_ids, array[]::uuid[]) loop   -- same checks as the finance-only path
    select coalesce(sum(delta), 0) into v_fee from clinic_finance.doctor_accruals where doctor_key = p_doctor_key and invoice_id = one;
    if v_fee <= 0 then raise exception 'إحدى الفواتير ليست من أتعاب هذا الطبيب'; end if;
    if exists(select 1 from clinic_finance.invoices where id = one and voided) then raise exception 'إحدى الفواتير ملغاة'; end if;
    if not clinic_finance.invoice_fully_paid(one) then raise exception 'إحدى الفواتير لم تُسدَّد بالكامل بعد؛ لا تُصرف أتعابها الآن'; end if;
    if exists(select 1 from clinic_finance.doctor_payout_invoices k join clinic_finance.doctor_payouts q on q.id = k.payout_id where k.doctor_key = p_doctor_key and k.invoice_id = one and q.status in ('pending', 'approved')) then
      raise exception 'إحدى الفواتير مشمولة بطلب صرف سابق (معلّق أو معتمد)'; end if;
    v_gross := v_gross + v_fee; fees := fees || jsonb_build_object(one::text, v_fee);
  end loop;
  foreach one in array rx_ids loop
    select * into r from clinic_finance.rx_dues(p_doctor_key) q where q.invoice_id = one;
    if not found then raise exception 'إحدى فواتير الاستقبال ليست من أتعاب هذا الطبيب'; end if;
    if not r.paid then raise exception 'فاتورة % لم تُسدَّد بالكامل بعد (أو عليها مطالبة تأمين مفتوحة)؛ لا تُصرف أتعابها الآن', r.reference; end if;
    if r.left_fee <= 0 then raise exception 'فاتورة % مشمولة بطلب صرف سابق (معلّق أو معتمد)', r.reference; end if;
    v_gross := v_gross + r.left_fee; rxfees := rxfees || jsonb_build_object(one::text, r.left_fee);
  end loop;
  tax_amt := round(v_gross * p_tax_pct / 100, 2); wh_amt := round(v_gross * p_withholding_pct / 100, 2);
  v_pl := jsonb_build_object('doctor_key', p_doctor_key, 'gross', v_gross, 'tax_pct', p_tax_pct, 'withholding_pct', p_withholding_pct, 'withheld', tax_amt + wh_amt, 'method', p_method,
    'reference', p_reference, 'from', p_from, 'to', p_to, 'invoice_ids', to_jsonb(ids), 'reception_invoice_ids', to_jsonb(rx_ids));
  if p_shift_id is not null then v_pl := v_pl || jsonb_build_object('shift_id', p_shift_id); end if;
  v := public.clinic_finance_doctor_command('payout', v_pl, p_token);   -- every existing gate runs here
  insert into clinic_finance.doctor_payout_invoices(payout_id, invoice_id, doctor_key, fee) select v, k::uuid, p_doctor_key, (fees->>k)::numeric from jsonb_object_keys(fees) k;
  insert into clinic_finance.desk_payout_rx(payout_id, rx_invoice_id, doctor_key, fee) select v, k::uuid, p_doctor_key, (rxfees->>k)::numeric from jsonb_object_keys(rxfees) k;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'doctor_payout_invoices', v,
    jsonb_build_object('doctor_key', p_doctor_key, 'invoice_count', coalesce(array_length(fin_ids, 1), 0), 'reception_invoice_count', array_length(rx_ids, 1), 'gross', v_gross));
  return v;
end $$;
revoke all on function public.clinic_finance_doctor_payout_invoices(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) from public, anon;
grant execute on function public.clinic_finance_doctor_payout_invoices(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
