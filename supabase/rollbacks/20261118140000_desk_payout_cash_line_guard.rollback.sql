begin;
do $$
declare def text;
  new_txt constant text := $s$and e.source<>'treasury_transfer_out' and not (e.source='doctor_payment' and clinic_finance.desk_payout_from_collection(e.source_id,e.shift_id)) then raise exception 'الصرف من الخزينة الرئيسية فقط؛ خزينة الاستقبال للتحصيل والتسليم';end if;$s$;
  old_txt constant text := $s$and e.source<>'treasury_transfer_out' then raise exception 'الصرف من الخزينة الرئيسية فقط؛ خزينة الاستقبال للتحصيل والتسليم';end if;$s$;
begin
  def := pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure);
  if position(new_txt in def) = 0 then raise exception 'cash_line_guard is not patched (md5 %)', md5(def); end if;
  execute replace(def, new_txt, old_txt);
  def := pg_get_functiondef('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)'::regprocedure);
  execute replace(def, $s$join clinic_finance.lines l on l.entry_id=e.id and clinic_finance.is_cash_account(l.account) and l.credit>0$s$, $s$join clinic_finance.lines l on l.entry_id=e.id and l.account='1111' and l.credit>0$s$);
end $$;
commit;
