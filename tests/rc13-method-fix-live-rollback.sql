-- RC-2026-000013 (P-2026-001619, psych session 25-11): recorded 800 CASH on Maryam's shift (now ended + reviewed); reality 700 by VISA
-- and a 30% agreed discount. DRY-RUN of the one-off ops step that the closed shift blocks on screen («تصحيح طريقة الدفع» refuses a
-- closed shift). ONE transaction, ends with ROLLBACK. No patient names printed.
-- Plan (owner approval needed for the real run):
--   ops (this file, run as the financial manager's identity): receipt 800 cash → 700 POS: Dr 1114 700 / Cr 1111 700 ('method_fix') and
--        Dr 1122 100 / Cr 1111 100 ('method_fix_ar' — the patient never paid the extra 100, it goes back to what the invoice still owes);
--        payment row → method pos, amount 700; its allocation → 700. Invoice then owes 300.
--   screen (after the real run): reception «طلب مالي» → «إشعار دائن لخدمة» 300 on the session ("خصم 30% من الجلسة العاشرة"), approved by
--        the FM → the 300 comes off the receivable (credit_note_ar), the doctor fee is cut 30% (doctor_credit_note). Final: revenue 700,
--        POS 700, cash 0, due 0, doctor paid on 700. No patient credit, no refund needed.
begin;
-- ===== facts (read-only) =====
select p.id payment_id, p.method, p.amount, p.credit_amount, p.reference, p.shift_id rx_shift, rs.status rx_shift_status, rs.finance_shift_id,
       fs.status fin_status, fs.ended_at, fs.end_counted, fs.end_expected, clinic_finance.shift_cash(fs.id) fin_book_now
  from clinic_reception.payments p left join clinic_reception.shifts rs on rs.id = p.shift_id left join clinic_finance.shifts fs on fs.id = rs.finance_shift_id
 where p.receipt_no = 'RC-2026-000013';
select a.invoice_id, a.amount, a.source, i.amount invoice_amount, i.credit_amount, i.payer_amount, clinic_reception.due(i.id) due_now, o.price, o.discount, o.doctor_fee
  from clinic_reception.allocations a join clinic_reception.invoices i on i.id = a.invoice_id left join clinic_reception.orders o on o.id = i.order_id
 where a.payment_id = (select id from clinic_reception.payments where receipt_no = 'RC-2026-000013');
select c.shift_id, c.difference, c.status, c.decision from clinic_finance.cash_cases c
 where c.shift_id = (select rs.finance_shift_id from clinic_reception.payments p join clinic_reception.shifts rs on rs.id = p.shift_id where p.receipt_no = 'RC-2026-000013');
-- ===== ops step + checks =====
do $$
declare fm uuid; p clinic_reception.payments%rowtype; al clinic_reception.allocations%rowtype; rid uuid := gen_random_uuid(); dims jsonb; fsid uuid; before numeric; after numeric; d numeric;
begin
  select user_id into fm from public.admins where active and user_id is not null and role = 'financial_manager' order by id limit 1;
  if fm is null then raise exception 'need a financial manager with a login'; end if;
  perform set_config('request.jwt.claim.sub', fm::text, true);
  select * into p from clinic_reception.payments where receipt_no = 'RC-2026-000013' for update;
  if not found or p.method <> 'cash' or p.amount <> 800 then raise exception 'receipt is not 800 cash anymore: % %', p.method, p.amount; end if;
  if (select count(*) from clinic_reception.allocations where payment_id = p.id) <> 1 then raise exception 'expected one allocation'; end if;
  select * into al from clinic_reception.allocations where payment_id = p.id for update;
  if al.amount <> 800 then raise exception 'allocation is %, expected 800', al.amount; end if;
  if exists (select 1 from clinic_reception.requests where subject_id = p.id and kind in ('refund', 'method_fix') and status in ('pending', 'approved')) then raise exception 'receipt already has a refund / correction request'; end if;
  select rs.finance_shift_id into fsid from clinic_reception.shifts rs where rs.id = p.shift_id;
  before := case when fsid is null then null else clinic_finance.shift_cash(fsid) end;
  dims := jsonb_build_object('patient_id', p.patient_id, 'payment_id', p.id, 'shift_id', p.shift_id, 'method_from', 'cash', 'method_to', 'pos', 'ops', 'closed-shift correction RC-2026-000013');
  perform clinic_reception.post(p.workspace_id, 'method_fix', rid, 'تصحيح طريقة السداد لإيصال تحصيل — RC-2026-000013 (وردية مقفولة، بموافقة المالك)', '1114', '1111', 700, dims);
  perform clinic_reception.post(p.workspace_id, 'method_fix_ar', rid, 'تصحيح مبلغ الإيصال — المريض دفع 700 فيزا مش 800 كاش (RC-2026-000013)', '1122', '1111', 100, dims);
  update clinic_reception.payments set method = 'pos', amount = 700, reference = 'تصحيح فيزا — RC-2026-000013' where id = p.id;
  update clinic_reception.allocations set amount = 700 where id = al.id;
  insert into clinic_finance.audit(actor, action, entity_id, detail)
    values ((select id from public.admins where user_id = fm), 'ops_receipt_method_fix', p.id, jsonb_build_object('receipt', 'RC-2026-000013', 'from', '800 cash', 'to', '700 pos', 'journal_id', rid));
  d := clinic_reception.due(al.invoice_id);
  if d <> 300 then raise exception 'invoice due after fix is %, expected 300', d; end if;
  after := case when fsid is null then null else clinic_finance.shift_cash(fsid) end;
  raise notice 'RC-13 ops dry-run OK: payment → 700 pos, invoice due 300 (for the 30%% credit note); Maryam finance shift book % → % (−800 cash)', before, after;
end $$;
rollback;
