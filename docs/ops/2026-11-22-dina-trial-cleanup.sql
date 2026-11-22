-- Remove the TRIAL «خزينة دينا (تجريبية)» and its 1,000 patient credit through the owner's test-record tool (owner: «احذف خزينة دينا التجريبية»,
-- «احنا لغينا خزينة دينا ورصيدها», main chat 4, 2026-11-22). Uses ONLY the released, audited tool functions (20261109130000 + 20261118210000
-- 'register' + 20261121210000 'patient_credit'): owner identity, flag «تجريبي» then delete «حذف», full rows archived in
-- clinic_finance.test_deletion_rows before any delete, one transaction. No direct DELETE/UPDATE anywhere in this file.
--
-- Why it still shows: on 2026-11-19 the OLD registers «خزينة dina» (efecf87f…, 0102010102) and «mahmoud» were deleted — NOT this one.
-- «خزينة دينا (تجريبية)» = clinic_finance.registers a57dbbdf-f7a2-4a87-894d-20afef506b87 (account 0102010107) with its shift 0f8e62ca…
-- (open, ended, end_counted 1000) and the trial «رصيد لصالح المريض» (reception journal ca8cb7a7…, finance entry 175: Dr 0102010107 1000 /
-- Cr 2150). The register type refuses while that credit exists (blockers reception_payments / entries / account_lines), so the credit goes first.
-- A name search like '%دينا%' can miss the row (Arabic yeh variants ي / ی / ى) — every step below works by id.
--
-- DRY-RUN by default: the file ends with ROLLBACK. To apply after the owner's OK, change the last line to COMMIT (nothing else).
-- Undo after COMMIT: every removed row is in clinic_finance.test_deletion_rows (deletion ids are printed in step 2/4) and can be re-inserted
-- from row_data in reverse order; the tool itself has no «restore» button.

begin;

-- ===================== 0. state BEFORE (read-only) =====================
select 'register' what, id::text, name, treasury_kind, account_code from clinic_finance.registers where id = 'a57dbbdf-f7a2-4a87-894d-20afef506b87';
select 'shift' what, id::text, status, opened_at, ended_at, end_counted from clinic_finance.shifts where register_id = 'a57dbbdf-f7a2-4a87-894d-20afef506b87';
select 'reception register' what, id::text, name from clinic_reception.registers where finance_register_id = 'a57dbbdf-f7a2-4a87-894d-20afef506b87';
select 'credit journal' what, id::text, source, source_id::text from clinic_reception.journal where id = 'ca8cb7a7-8f28-4a2d-8b5d-0687319a27b2';
select 'lines on 0102010107' what, count(*)::text n, coalesce(sum(debit - credit), 0)::text balance from clinic_finance.lines where account = '0102010107';

-- ===================== act as the OWNER (the super_admin who used this tool on 2026-11-19) =====================
-- If this picks the wrong person, replace the subquery with the owner's admins.user_id.
select set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', (select a.user_id from public.admins a
     where a.id = (select f.flagged_by from clinic_finance.test_flags f where f.record_type = 'register' order by f.flagged_at limit 1)))::text, true);
set local role authenticated;
select public.my_admin_id() as acting_admin;   -- must be the owner; the tool refuses anyone else

-- ===================== 1. the trial patient credit: scan =====================
select public.clinic_finance_test_scan('patient_credit', 'ca8cb7a7-8f28-4a2d-8b5d-0687319a27b2') as credit_scan;   -- expect deletable=true, blockers=[]

-- ===================== 2. flag + delete it (archive first, audited) =====================
select public.clinic_finance_test_flag('patient_credit', 'ca8cb7a7-8f28-4a2d-8b5d-0687319a27b2', 'رصيد تجريبي على خزينة دينا التجريبية — قرار المالك', 'تجريبي') as credit_flag;
select public.clinic_finance_test_delete('patient_credit', 'ca8cb7a7-8f28-4a2d-8b5d-0687319a27b2', 'حذف رصيد التجربة قبل حذف خزينة دينا التجريبية', 'حذف') as credit_deletion_id;

-- ===================== 3. the trial register: scan =====================
select public.clinic_finance_test_scan('register', 'a57dbbdf-f7a2-4a87-894d-20afef506b87') as register_scan;        -- expect deletable=true; takes its shift, reception register/shift, rejected handover, empty account

-- ===================== 4. flag + delete it =====================
select public.clinic_finance_test_flag('register', 'a57dbbdf-f7a2-4a87-894d-20afef506b87', 'خزينة تجريبية — قرار المالك «احنا لغينا خزينة دينا ورصيدها»', 'تجريبي') as register_flag;
select public.clinic_finance_test_delete('register', 'a57dbbdf-f7a2-4a87-894d-20afef506b87', 'حذف خزينة دينا التجريبية ورصيدها', 'حذف') as register_deletion_id;

reset role;

-- ===================== 5. state AFTER (expect: no register, no shift, no reception register, no journal, no lines on 0102010107) =====================
select 'register' what, count(*) n from clinic_finance.registers where id = 'a57dbbdf-f7a2-4a87-894d-20afef506b87'
union all select 'shifts', count(*) from clinic_finance.shifts where register_id = 'a57dbbdf-f7a2-4a87-894d-20afef506b87'
union all select 'reception registers', count(*) from clinic_reception.registers where finance_register_id = 'a57dbbdf-f7a2-4a87-894d-20afef506b87'
union all select 'credit journal', count(*) from clinic_reception.journal where id = 'ca8cb7a7-8f28-4a2d-8b5d-0687319a27b2'
union all select 'lines on 0102010107', count(*) from clinic_finance.lines where account = '0102010107'
union all select 'archived rows (this run)', count(*) from clinic_finance.test_deletion_rows r join clinic_finance.test_deletions d on d.id = r.deletion_id
  where d.record_key in ('ca8cb7a7-8f28-4a2d-8b5d-0687319a27b2', 'a57dbbdf-f7a2-4a87-894d-20afef506b87');
select 'journal still balances' what, coalesce(sum(debit - credit), 0) diff from clinic_finance.lines;

rollback;   -- DRY-RUN. Change to COMMIT to apply after the owner's OK.
