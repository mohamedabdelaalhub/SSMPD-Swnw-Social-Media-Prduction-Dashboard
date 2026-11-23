-- Rollback of 20261123040000_inbox_shift_review_finance.sql: restores the saved public.clinic_review_inbox() body.
begin;
do $$ declare d text; begin
  select def into d from clinic_reception.inbox_shift_saved_defs where name = 'clinic_review_inbox';
  if d is null then raise exception 'لم يُطبّق الملف'; end if;
  execute d;
end $$;
drop table clinic_reception.inbox_shift_saved_defs;
commit;
