-- Doctor statement: «خدمات بدون عقد ساري» also for doctors with NO active contract at all (owner «اعمل التعديل والقايمة» 2026-11-26).
-- Before: clinic_finance.doctor_statement_detail filled `uncovered` only when the doctor had at least one active contract, so a doctor
-- who works without any contract saw an EMPTY statement (has_active_contract=false, uncovered=null) — as if nothing was done.
-- Now: the completed live reception orders of the doctor in the period are listed for every doctor (reason 'none' / 'pending' /
-- 'starts_later' / 'expired', unchanged rules). READ-ONLY: nothing is computed or written — these orders still carry no fee until a
-- contract is created and approved. The screens already render the section whenever `uncovered` is an array.
-- In-place patch at one anchor; saved def for rollback. Rollback: supabase/rollbacks/20261126050000_doctor_uncovered_without_contract.rollback.sql
begin;

do $$ declare d text; a constant text := $a$if v_active and to_regclass('clinic_reception.orders') is not null$a$; begin
  if to_regprocedure('clinic_finance.doctor_statement_detail(text,date,date)') is null then raise exception 'طبّق ملف تفاصيل حساب الدكتور أولًا'; end if;
  if to_regclass('clinic_finance.doctor_uncovered_saved_defs') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  d := pg_get_functiondef('clinic_finance.doctor_statement_detail(text,date,date)'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط في doctor_statement_detail اتغيّرت (md5 %)', md5(d); end if;
end $$;

create table clinic_finance.doctor_uncovered_saved_defs(name text primary key, def text not null);
revoke all on clinic_finance.doctor_uncovered_saved_defs from public, anon, authenticated;
insert into clinic_finance.doctor_uncovered_saved_defs values
  ('doctor_statement_detail', pg_get_functiondef('clinic_finance.doctor_statement_detail(text,date,date)'::regprocedure));

do $$ begin
  execute replace(pg_get_functiondef('clinic_finance.doctor_statement_detail(text,date,date)'::regprocedure),
    $a$if v_active and to_regclass('clinic_reception.orders') is not null$a$,
    $b$if to_regclass('clinic_reception.orders') is not null$b$);
end $$;

commit;
