-- Rollback of 20261121210000_test_tool_patient_credit.sql: the test-record tool forgets type 'patient_credit'; the previous functions (the 'register' wrappers of 20261118210000) come back untouched.
-- Refuses while a patient credit is still flagged «تجريبي» (unflag it from the panel first). Flags of credits that were already deleted are history and stay, with their archive;
-- the record_type check is then restored NOT VALID (it still refuses any new 'patient_credit' flag) instead of deleting that history.
begin;
do $$ begin
  if to_regprocedure('clinic_finance.test_plan_pre_patient_credit(text,text)') is null or to_regprocedure('clinic_finance.test_find_pre_patient_credit(text,text)') is null then raise exception 'الملف 20261121210000 غير مطبَّق'; end if;
  if exists(select 1 from clinic_finance.test_flags where record_type = 'patient_credit' and unflagged_at is null and deleted_at is null) then
    raise exception 'توجد أرصدة مرضى مُعلَّمة «تجريبي»؛ ألغِ العلامة من الشاشة أولًا';
  end if;
end $$;
drop function clinic_finance.test_plan(text, text);
alter function clinic_finance.test_plan_pre_patient_credit(text, text) rename to test_plan;
drop function public.clinic_finance_test_find(text, text);
alter function clinic_finance.test_find_pre_patient_credit(text, text) rename to clinic_finance_test_find;
alter function clinic_finance.clinic_finance_test_find(text, text) set schema public;
revoke all on function public.clinic_finance_test_find(text, text) from public, anon;
grant execute on function public.clinic_finance_test_find(text, text) to authenticated;
revoke all on function clinic_finance.test_plan(text, text) from public, anon, authenticated;
alter table clinic_finance.test_flags drop constraint test_flags_record_type_check;
alter table clinic_finance.test_flags add constraint test_flags_record_type_check check (record_type in ('invoice', 'doctor_key', 'doctor_contract', 'inventory_item', 'pricing_supply', 'advance', 'register')) not valid;
do $$ begin
  if not exists(select 1 from clinic_finance.test_flags where record_type = 'patient_credit') then alter table clinic_finance.test_flags validate constraint test_flags_record_type_check; end if;
end $$;
commit;
