-- «اعرض الرقمين» (owner 2026-11-24): treasury movements (screen + PDF) show the system receipt number printed on the patient's receipt
-- (clinic_reception.payments.receipt_no, «RC-…») AND the reference typed at collection (transaction / slip number) under it.
-- READ-ONLY: public.clinic_finance_shift_movements rows get 'receipt_no' (null for rows that are not reception payments).
-- In-place anchor patch after 20261122390000 (multi payment note added 'source_id'); old body saved for rollback.
-- Rollback: supabase/rollbacks/20261124220000_shift_movements_receipt_no.rollback.sql
begin;
do $$ declare d text; a constant text := $a$'source_id',a.source_id) order by a.at_time$a$; begin
  if to_regprocedure('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)') is null then raise exception 'حركات الخزن غير موجودة'; end if;
  d := pg_get_functiondef('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)'::regprocedure);
  if position('''receipt_no''' in d) > 0 then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'نقطة الربط في حركات الخزن مش موجودة مرة واحدة (md5 %)', md5(d); end if;
  create table clinic_finance.receipt_no_saved_defs(name text primary key, def text not null);
  revoke all on clinic_finance.receipt_no_saved_defs from public, anon, authenticated;
  insert into clinic_finance.receipt_no_saved_defs values ('shift_movements', d);
  execute replace(d, a, $b$'source_id',a.source_id,'receipt_no',(select rp.receipt_no from clinic_reception.payments rp where rp.id = a.source_id)) order by a.at_time$b$);
end $$;
commit;
