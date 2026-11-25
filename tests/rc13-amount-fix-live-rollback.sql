-- DRY-RUN of docs/ops/2026-11-25-rc13-amount-fix.sql (rule 9): same body, ROLLBACK. No patient names.
begin;
do $$
declare fm uuid; fm_admin uuid; p clinic_reception.payments%rowtype; al clinic_reception.allocations%rowtype; rid uuid := gen_random_uuid(); v uuid; e uuid;
  msh uuid; mreg text; mbefore numeric; mafter numeric; d numeric; dims jsonb;
begin
  select user_id, id into fm, fm_admin from public.admins where active and user_id is not null and role = 'financial_manager' order by id limit 1;
  if fm is null then raise exception 'need a financial manager with a login'; end if;
  perform set_config('request.jwt.claim.sub', fm::text, true);
  perform clinic_finance.lock_day();
  select * into p from clinic_reception.payments where receipt_no = 'RC-2026-000013' for update;
  if not found or p.method <> 'cash' or p.amount <> 800 then raise exception 'receipt is not 800 cash anymore: % %', p.method, p.amount; end if;
  if (select count(*) from clinic_reception.allocations where payment_id = p.id) <> 1 then raise exception 'expected one allocation'; end if;
  select * into al from clinic_reception.allocations where payment_id = p.id for update;
  if al.amount <> 800 then raise exception 'allocation is %, expected 800', al.amount; end if;
  if exists (select 1 from clinic_reception.requests where subject_id in (p.id, al.invoice_id) and kind in ('refund', 'method_fix', 'credit_note') and status in ('pending', 'approved')) then
    raise exception 'receipt / invoice already has a refund / correction / credit-note request'; end if;
  -- Maryam's shift is ended + handed over (920 received by main): the 100 that was never collected comes off the MAIN treasury's book
  select fs.id, r.name into msh, mreg from clinic_finance.shifts fs join clinic_finance.registers r on r.id = fs.register_id
   where r.treasury_kind = 'main' and fs.is_main and fs.status = 'open' and fs.ended_at is null order by fs.opened_at desc limit 1;
  if msh is null then raise exception 'no open main-treasury shift — open it first'; end if;
  mbefore := clinic_finance.treasury_balance((select register_id from clinic_finance.shifts where id = msh));
  dims := jsonb_build_object('patient_id', p.patient_id, 'payment_id', p.id, 'finance_shift_id', msh,
    'ops', 'RC-2026-000013 amount fix (owner 2026-11-25): recorded 800, collected 700 cash — 30% discount not applied; cash leg on the main treasury');
  insert into clinic_reception.journal(workspace_id, source, source_id, description, dimensions, actor_id)
    values (p.workspace_id, 'receipt_amount_fix', rid, 'إيصال RC-2026-000013 اتسجل 800 والمحصل فعلاً 700 — خصم 30% ما اتطبقش', dims, fm_admin) returning id into v;
  insert into clinic_reception.journal_lines values (v, '1122', 100, 0), (v, '1111', 0, 100);
  insert into clinic_finance.entries(source, source_id, description, shift_id, created_by)
    values ('reception_receipt_amount_fix', v, 'إيصال RC-2026-000013 اتسجل 800 والمحصل فعلاً 700 — خصم 30% ما اتطبقش', msh, fm_admin) returning id into e;
  insert into clinic_finance.lines(entry_id, account, debit, credit) values (e, clinic_reception.account('1122'), 100, 0), (e, clinic_reception.account('1111'), 0, 100);
  update clinic_reception.journal set finance_entry_id = e where id = v;
  update clinic_reception.payments set amount = 700 where id = p.id;
  update clinic_reception.allocations set amount = 700 where id = al.id;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (fm_admin, 'ops_receipt_amount_fix', p.id,
    jsonb_build_object('receipt', 'RC-2026-000013', 'from', '800 cash', 'to', '700 cash', 'reason', 'إيصال اتسجل 800 والمحصل فعلاً 700 — خصم 30% ما اتطبقش', 'journal_id', v, 'finance_entry', e, 'main_shift', msh));
  d := clinic_reception.due(al.invoice_id);
  if d <> 300 then raise exception 'invoice due after fix is %, expected 300', d; end if;
  if (select sum(debit) - sum(credit) from clinic_finance.lines where entry_id = e) <> 0 then raise exception 'finance entry not balanced'; end if;
  mafter := clinic_finance.treasury_balance((select register_id from clinic_finance.shifts where id = msh));
  raise notice 'RC-13 amount fix: payment 800 → 700 cash, invoice due 300 (next: credit note 300 on screen). Main «%» book % → % (−100).', mreg, mbefore, mafter;
end $$;
rollback;
