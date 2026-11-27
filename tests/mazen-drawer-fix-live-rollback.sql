-- DRY-RUN: ends in ROLLBACK, writes nothing.
begin;
-- «خزينة مازن» correction (register 3b39cfc5…). Diagnostic dffba770 (READ ONLY, 11:36Z) showed: shift 6bc7c41a (23-11) handed over 550
-- while its book was 0 and NO cash receipt exists for 23/24-11 → an unexplained surplus of 550 that was never booked, so every later
-- shift opened 550 too low (25-11 opening −550, today −450). Corrections (main chat applies only after the owner's order):
--   A) 23-11 surplus 550 → «إيراد فروق زيادة الخزينة» on that shift: Dr drawer / Cr 4119 (source cash_case_settlement, the
--      shift's own cash case if it has one — marked settled «بأمر المالك»). Same entry the existing «تسوية فروق الخزن» posts.
--   B) 25-11 shift ad1dfc0a: opening_book −550 → 0 and end_expected −450 → 100; its cash case becomes −100 (counted 0 vs 100):
--      a SHORTAGE of 100, left «recorded» for the owner's decision (عجز خزينة / على الموظف) — nothing posted for it here.
--   C) today's open shift dc9c3521: opening_book −450 → 0, so its expected cash becomes 755 (0 + 1110 + 50 − 405).
--   D) RC-2026-000022 (50 «رصيد مقدم», 23 s after RC-2026-000021): evidence printed only — no change (confirm with Mazen first).
-- Nothing is deleted. Every change is audited. Refuses if any number differs from the diagnostic.
do $$
declare reg uuid; s23 clinic_finance.shifts%rowtype; s25 clinic_finance.shifts%rowtype; s26 clinic_finance.shifts%rowtype;
  c23 clinic_finance.cash_cases%rowtype; c25 clinic_finance.cash_cases%rowtype; actor uuid; e uuid; b0 numeric; r record; dup record;
begin
  select id into reg from clinic_finance.registers where id::text like '3b39cfc5%';
  select * into s23 from clinic_finance.shifts where id::text like '6bc7c41a%' and register_id = reg;
  select * into s25 from clinic_finance.shifts where id::text like 'ad1dfc0a%' and register_id = reg;
  select * into s26 from clinic_finance.shifts where id::text like 'dc9c3521%' and register_id = reg;
  if reg is null or s23.id is null or s25.id is null or s26.id is null then raise exception 'drawer / shifts not found'; end if;
  if clinic_finance.shift_cash(s23.id) <> -550 or coalesce(s23.end_counted, 0) <> 550 then raise exception '23-11 shift is not book −550 / counted 550 any more (book %, counted %)', clinic_finance.shift_cash(s23.id), s23.end_counted; end if;
  if s25.opening_book <> -550 then raise exception '25-11 opening is % not −550', s25.opening_book; end if;
  if s26.opening_book <> -450 or s26.status <> 'open' then raise exception 'today''s shift opening % / status % changed', s26.opening_book, s26.status; end if;
  select a.id into actor from public.admins a where a.active and coalesce(a.name, '') <> 'Admin Test' and a.role = 'super_admin' order by (a.name like '%عبدالعال%') desc, a.id limit 1;
  if actor is null then raise exception 'no real super admin to record the owner''s order'; end if;
  perform clinic_finance.lock_day();
  b0 := clinic_finance.treasury_balance(reg);
  raise notice 'BEFORE: drawer balance %, 23-11 book %, 25-11 opening % book %, today opening % book %', b0, clinic_finance.shift_cash(s23.id),
    s25.opening_book, clinic_finance.shift_cash(s25.id), s26.opening_book, clinic_finance.shift_cash(s26.id);

  -- A) 23-11 surplus 550 → 4119
  select * into c23 from clinic_finance.cash_cases where shift_id = s23.id for update;
  if c23.id is not null and c23.settle_status in ('pending', 'approved') then raise exception '23-11 case already has a settlement (%)', c23.settle_status; end if;
  insert into clinic_finance.entries(source, source_id, description, shift_id, created_by)
    values ('cash_case_settlement', coalesce(c23.id, gen_random_uuid()), 'تصحيح خزينة مازن بأمر المالك — زيادة 550 اتسلّمت يوم 23-11 من غير تحصيل مسجل (إيراد فروق زيادة الخزينة)', s23.id, actor)
    returning id into e;
  insert into clinic_finance.lines(entry_id, account, debit, credit) values (e, '1111', 550, 0), (e, '4119', 0, 550);
  if c23.id is not null then
    update clinic_finance.cash_cases set settle_status = 'approved', settle_kind = 'surplus_income', settle_note = 'بأمر المالك — زيادة بدون تحصيل مسجل',
      settle_by = actor, settle_at = now(), settle_reviewed_by = actor, settle_reviewed_at = now(), settle_review_note = 'بأمر المالك', settle_entry_id = e,
      updated_by = actor, updated_at = now() where id = c23.id;
  end if;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (actor, 'drawer_fix_surplus_550', s23.id, jsonb_build_object('entry', e, 'case', c23.id, 'amount', 550));

  -- B) 25-11: opening −550 → 0, expected −450 → 100, case → −100 shortage (owner decides)
  update clinic_finance.shifts set opening_book = 0, end_expected = coalesce(end_expected, 0) + 550 where id = s25.id;
  select * into c25 from clinic_finance.cash_cases where shift_id = s25.id for update;
  if c25.id is not null then
    if c25.settle_status in ('pending', 'approved') then raise exception '25-11 case already settled (%) — stop', c25.settle_status; end if;
    update clinic_finance.cash_cases set difference = coalesce(s25.end_counted, s25.counted, 0) - (coalesce(s25.end_expected, 0) + 550),
      review_note = trim(coalesce(review_note, '') || ' | تصحيح بأمر المالك: الفرق كان +450 بسبب بداية سالبة (−550) غلط؛ الحقيقي عجز 100'),
      updated_by = actor, updated_at = now() where id = c25.id;
  else
    insert into clinic_finance.cash_cases(shift_id, difference, review_note, updated_by)
      values (s25.id, coalesce(s25.end_counted, s25.counted, 0) - (coalesce(s25.end_expected, 0) + 550), 'تصحيح بأمر المالك: عجز 100 بعد تصحيح البداية السالبة', actor);
  end if;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (actor, 'drawer_fix_opening', s25.id, jsonb_build_object('opening_from', -550, 'opening_to', 0));

  -- C) today: opening −450 → 0
  update clinic_finance.shifts set opening_book = 0 where id = s26.id;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (actor, 'drawer_fix_opening', s26.id, jsonb_build_object('opening_from', -450, 'opening_to', 0));

  -- D) RC-2026-000022 evidence only
  for dup in select p.receipt_no, p.amount, p.credit_amount, p.method, p.created_at, p.patient_id = (select patient_id from clinic_reception.payments where receipt_no = 'RC-2026-000021' limit 1) same_patient
               from clinic_reception.payments p where p.receipt_no in ('RC-2026-000021', 'RC-2026-000022') order by p.created_at loop
    raise notice 'D % : amount %, credit %, %, at % (same patient as 021: %)', dup.receipt_no, dup.amount, dup.credit_amount, dup.method, (dup.created_at at time zone 'Africa/Cairo')::time, dup.same_patient;
  end loop;

  select * into s25 from clinic_finance.shifts where id = s25.id; select * into s26 from clinic_finance.shifts where id = s26.id;
  select * into c25 from clinic_finance.cash_cases where shift_id = s25.id;
  raise notice 'AFTER: drawer balance % (was %), 23-11 book %, 25-11 opening % book % (case difference % — shortage for the owner''s decision), today opening % book %',
    clinic_finance.treasury_balance(reg), b0, clinic_finance.shift_cash(s23.id), s25.opening_book, clinic_finance.shift_cash(s25.id), c25.difference, s26.opening_book, clinic_finance.shift_cash(s26.id);
  if clinic_finance.shift_cash(s26.id) <> 755 then raise exception 'today''s expected is % not 755', clinic_finance.shift_cash(s26.id); end if;
end $$;
rollback;
