-- Follow-up to 20261118030000 (owner 2026-11-18 «صرف حساب الدكتور من كاش التحصيل بعد الاعتماد»).
-- clinic_finance.cash_line_guard (20261018205000) refuses any cash credit on a non-main register while a main treasury exists, except the
-- handover to the main treasury (source treasury_transfer_out). Live has a main treasury, so an approved reception doctor payout from a
-- collection drawer was still refused («الصرف من الخزينة الرئيسية فقط»). Allow exactly that one case: a doctor_payment entry whose source is
-- a pending reception desk payout being approved now by a non-requester approver on its own shift (clinic_finance.desk_payout_from_collection).
-- Everything else from a collection register stays refused. In-place anchor patch with md5 notices.
-- Also: «حركة الوردية» (public.clinic_finance_shift_movements) listed money OUT only on account 1111, but cash_line_guard re-maps a bound
-- register's 1111 lines to its own cash account, so payouts / handovers from collection drawers were missing from the shift report.
-- Money out now counts any register cash account (clinic_finance.is_cash_account).
-- Rollback: supabase/rollbacks/20261118140000_desk_payout_cash_line_guard.rollback.sql
begin;
do $$
declare def text; patched text;
  old_txt constant text := $s$and e.source<>'treasury_transfer_out' then raise exception 'الصرف من الخزينة الرئيسية فقط؛ خزينة الاستقبال للتحصيل والتسليم';end if;$s$;
  new_txt constant text := $s$and e.source<>'treasury_transfer_out' and not (e.source='doctor_payment' and clinic_finance.desk_payout_from_collection(e.source_id,e.shift_id)) then raise exception 'الصرف من الخزينة الرئيسية فقط؛ خزينة الاستقبال للتحصيل والتسليم';end if;$s$;
begin
  if to_regprocedure('clinic_finance.desk_payout_from_collection(uuid,uuid)') is null then raise exception 'طبّق 20261118030000 الأول'; end if;
  def := pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure);
  if position(new_txt in def) > 0 then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if position(old_txt in def) = 0 then raise exception 'Missing patch target in clinic_finance.cash_line_guard (md5 %)', md5(def); end if;
  patched := replace(def, old_txt, new_txt); execute patched;
  raise notice 'cash_line_guard patched (before md5 %, after md5 %)', md5(def), md5(patched);
  def := pg_get_functiondef('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)'::regprocedure);
  if position($s$join clinic_finance.lines l on l.entry_id=e.id and l.account='1111' and l.credit>0$s$ in def) = 0 then raise exception 'Missing patch target in clinic_finance_shift_movements (md5 %)', md5(def); end if;
  patched := replace(def, $s$join clinic_finance.lines l on l.entry_id=e.id and l.account='1111' and l.credit>0$s$, $s$join clinic_finance.lines l on l.entry_id=e.id and clinic_finance.is_cash_account(l.account) and l.credit>0$s$);
  execute patched;
  raise notice 'clinic_finance_shift_movements patched (before md5 %, after md5 %)', md5(def), md5(patched);
end $$;
commit;
