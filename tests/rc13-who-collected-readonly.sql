-- READ-ONLY: did Maryam really collect RC-2026-000013 (P-2026-001619, 25-11)? Everything the system holds about that receipt and her shift.
-- No writes, ends with ROLLBACK. Patient identified by file number only; staff names only.
begin read only;
-- 1) the receipt: who, when, how, proof / reference / note, which shift
select p.receipt_no, p.method, p.amount, p.reference, p.note, (p.proof_path is not null) has_proof, p.created_at at time zone 'Africa/Cairo' created_cairo,
       (select name from public.admins where id = p.created_by) created_by, p.shift_id rx_shift, rs.finance_shift_id
  from clinic_reception.payments p left join clinic_reception.shifts rs on rs.id = p.shift_id where p.receipt_no = 'RC-2026-000013';
-- 2) the visit / order timeline for that file today (arrival, service, completion, who did each)
select o.id order_id, o.status, o.price, o.discount, o.created_at at time zone 'Africa/Cairo' ordered_cairo, o.completed_at at time zone 'Africa/Cairo' completed_cairo,
       (select name from public.admins where id = o.created_by) ordered_by, v.status visit_status, v.created_at at time zone 'Africa/Cairo' visit_opened_cairo
  from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id join clinic_reception.patients pt on pt.id = v.patient_id
 where pt.file_no = 'P-2026-001619' and (o.created_at at time zone 'Africa/Cairo')::date = date '2026-11-25';
-- 3) every receipt on Maryam's 25-11 shift (what her expected 920 is made of)
select p.receipt_no, p.method, p.amount, p.created_at at time zone 'Africa/Cairo' at_cairo, pt.file_no
  from clinic_reception.payments p join clinic_reception.patients pt on pt.id = p.patient_id
 where p.shift_id = (select shift_id from clinic_reception.payments where receipt_no = 'RC-2026-000013') order by p.created_at;
-- 4) her finance shift: opening, count, expected, handover, review
select fs.id, fs.opened_at at time zone 'Africa/Cairo' opened, fs.ended_at at time zone 'Africa/Cairo' ended, fs.opening_book, fs.end_counted, fs.end_expected, fs.end_counts, fs.note,
       fs.status, (select name from public.admins where id = fs.reviewed_by) reviewed_by
  from clinic_finance.shifts fs where fs.id = (select rs.finance_shift_id from clinic_reception.payments p join clinic_reception.shifts rs on rs.id = p.shift_id where p.receipt_no = 'RC-2026-000013');
select t.amount, t.status, t.created_at at time zone 'Africa/Cairo' at_cairo, (select name from public.admins where id = t.reviewed_by) received_by, t.review_note
  from clinic_finance.treasury_transfers t where t.from_shift = (select rs.finance_shift_id from clinic_reception.payments p join clinic_reception.shifts rs on rs.id = p.shift_id where p.receipt_no = 'RC-2026-000013');
-- 5) audit / command log around the receipt (who pressed what, when)
select a.created_at at time zone 'Africa/Cairo' at_cairo, (select name from public.admins where id = a.actor) actor, a.action, left(a.detail::text, 200) detail
  from clinic_finance.audit a where a.created_at::date = date '2026-11-25' and (a.entity_id = (select id from clinic_reception.payments where receipt_no = 'RC-2026-000013')
        or a.detail::text like '%RC-2026-000013%') order by a.created_at;
-- 6) the cash-count attempts on her shift (count-check log)
select ca.counted, ca.matched, ca.counts, ca.created_at at time zone 'Africa/Cairo' at_cairo from clinic_finance.count_attempts ca
 where ca.shift_id = (select rs.finance_shift_id from clinic_reception.payments p join clinic_reception.shifts rs on rs.id = p.shift_id where p.receipt_no = 'RC-2026-000013') order by ca.created_at;
rollback;
