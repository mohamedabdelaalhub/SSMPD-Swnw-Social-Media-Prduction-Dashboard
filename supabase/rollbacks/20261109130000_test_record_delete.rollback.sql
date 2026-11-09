-- Rollback of 20261109130000_test_record_delete.sql. Refuses while the flags or the deletion archive hold rows (the archive is the only copy of deleted test data).
begin;
do $$ begin
  if to_regclass('clinic_finance.test_flags') is not null and (exists(select 1 from clinic_finance.test_flags) or exists(select 1 from clinic_finance.test_deletions)) then
    raise exception 'جداول الحذف التجريبي فيها بيانات (علامات أو أرشيف)؛ لا تُحذف تلقائيًا';
  end if;
end $$;
drop function if exists public.clinic_finance_test_overview();
drop function if exists public.clinic_finance_test_delete(text, text, text, text);
drop function if exists public.clinic_finance_test_unflag(text, text, text);
drop function if exists public.clinic_finance_test_flag(text, text, text, text);
drop function if exists public.clinic_finance_test_scan(text, text);
drop function if exists public.clinic_finance_test_find(text, text);
drop function if exists clinic_finance.test_counts(jsonb);
drop function if exists clinic_finance.test_block_text(jsonb);
drop function if exists clinic_finance.test_plan(text, text);
drop function if exists clinic_finance.test_is_flagged(text, text);
drop function if exists clinic_finance.test_take(uuid, text, text, text[]);
drop function if exists clinic_finance.test_n(text, text, text[]);
drop function if exists clinic_finance.test_owner();
drop table if exists clinic_finance.test_deletion_rows;
drop table if exists clinic_finance.test_deletions;
drop table if exists clinic_finance.test_flags;
drop function if exists clinic_finance.test_archive_guard();
commit;
