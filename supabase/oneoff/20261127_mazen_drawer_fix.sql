-- APPLY (main chat only, after the owner's order).
begin;
-- «خزينة مازن» correction v2 (register 3b39cfc5…) — REPLACES v1 (which booked the 550 as surplus income: WRONG, see below).
-- Facts: diagnostic dffba770 (11:36Z) + the owner (11:42Z): the real cash in Mazen's drawer now is 205, the book says 305.
--   * 23-11 (6bc7c41a): book 0, a handover (treasury_transfer_out) of 550 to the main treasury, no cash receipt on 23/24-11.
--   * 25-11 (ad1dfc0a): one cash receipt of 100; counted 0; no handover.
--   * 26-11 → now (dc9c3521): receipts 1110 + 50, doctor payout 405.
--   Real cash flow: 0 + 100 (25-11) + 1160 − 405 − 550 (handed) = 305 = the BOOK. The real drawer is 205 → 100 missing.
--   So the 550 handover is REAL money that reached the main treasury (it is just recorded on the 23-11 shift, before the money was
--   collected); it is NOT an unexplained surplus. The −550 / −450 openings are the correct carry of that early handover.
--   The only real difference is 100 = the 25-11 cash receipt that was not in the drawer at its count (counted 0).
-- What this script does (nothing posted, nothing moved, nothing deleted):
--   1) checks the numbers are still exactly the diagnostic's (else refuses);
--   2) marks the 23-11 (+550) and 25-11 (+450) cash cases, if they exist, as NOT real surpluses (review note) so nobody settles them
--      as income through «تسوية فروق الخزن»;
--   3) prints the reconciliation: book 305 − real 205 = 100 shortage = the 25-11 receipt. That 100 is settled the normal way at
--      today's close (count 205 vs expected 305 → case −100 → the owner decides: عجز خزينة / على الموظف / اتسلّم من غير تسجيل).
--   4) RC-2026-000022 evidence only (a duplicate would mean the book is 50 too high and the shortage is 50, not 100).
do $$
declare reg uuid; s23 clinic_finance.shifts%rowtype; s25 clinic_finance.shifts%rowtype; s26 clinic_finance.shifts%rowtype; actor uuid; n int; dup record;
begin
  select id into reg from clinic_finance.registers where id::text like '3b39cfc5%';
  select * into s23 from clinic_finance.shifts where id::text like '6bc7c41a%' and register_id = reg;
  select * into s25 from clinic_finance.shifts where id::text like 'ad1dfc0a%' and register_id = reg;
  select * into s26 from clinic_finance.shifts where id::text like 'dc9c3521%' and register_id = reg;
  if reg is null or s23.id is null or s25.id is null or s26.id is null then raise exception 'drawer / shifts not found'; end if;
  if clinic_finance.shift_cash(s23.id) <> -550 or s25.opening_book <> -550 or s26.opening_book <> -450 or s26.status <> 'open' then
    raise exception 'numbers changed since the diagnostic (23-11 book %, 25-11 opening %, today opening % / %)', clinic_finance.shift_cash(s23.id), s25.opening_book, s26.opening_book, s26.status; end if;
  select a.id into actor from public.admins a where a.active and coalesce(a.name, '') <> 'Admin Test' and a.role = 'super_admin' order by (a.name like '%عبدالعال%') desc, a.id limit 1;
  if actor is null then raise exception 'no real super admin to record the owner''s order'; end if;
  raise notice 'drawer book now % (today''s shift book %) — real cash counted by the owner: 205 → difference % (the 25-11 receipt of 100)',
    clinic_finance.treasury_balance(reg), clinic_finance.shift_cash(s26.id), clinic_finance.shift_cash(s26.id) - 205;

  update clinic_finance.cash_cases set review_note = trim(coalesce(review_note, '') || ' | بأمر المالك 27-11: مش زيادة حقيقية — تسليم 550 للخزنة الرئيسية اتسجل على وردية 23-11 قبل ما الفلوس تتحصّل؛ ماتتسوّاش كإيراد'),
         updated_by = actor, updated_at = now()
   where shift_id in (s23.id, s25.id) and coalesce(settle_status, '') not in ('pending', 'approved') and coalesce(review_note, '') not like '%بأمر المالك 27-11%';
  get diagnostics n = row_count;
  raise notice 'cash cases annotated as not-real surpluses: % (23-11 / 25-11)', n;
  if exists (select 1 from clinic_finance.cash_cases where shift_id in (s23.id, s25.id) and settle_status in ('pending', 'approved')) then
    raise notice 'WARNING: a 23-11 / 25-11 case already has a settlement request — check it before anything else'; end if;
  insert into clinic_finance.audit(actor, action, entity_id, detail)
    values (actor, 'drawer_fix_note', s26.id, jsonb_build_object('book', clinic_finance.shift_cash(s26.id), 'real', 205, 'shortage', clinic_finance.shift_cash(s26.id) - 205, 'cause', '25-11 receipt 100 not in the drawer'));

  for dup in select p.receipt_no, p.amount, p.credit_amount, p.method, (p.created_at at time zone 'Africa/Cairo')::time t,
                    p.patient_id = (select patient_id from clinic_reception.payments where receipt_no = 'RC-2026-000021' limit 1) same_patient
               from clinic_reception.payments p where p.receipt_no in ('RC-2026-000021', 'RC-2026-000022') order by p.created_at loop
    raise notice 'RC evidence % : amount %, credit %, %, at % (same patient as 021: %)', dup.receipt_no, dup.amount, dup.credit_amount, dup.method, dup.t, dup.same_patient;
  end loop;
end $$;
commit;
