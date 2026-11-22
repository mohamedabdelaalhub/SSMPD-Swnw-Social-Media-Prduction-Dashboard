-- Rollback of 20261122200000_main_treasury_count.sql. Counts already made stay as ordinary closed main shifts (history, reviews, cash cases).
-- The old rule (one unreviewed shift per register / cashier) comes back, so every main shift except at most one must be reviewed first.
begin;
do $$ begin
  if (select count(*) from clinic_finance.shifts where is_main and status <> 'reviewed') > 1 then
    raise exception 'راجع ورديات الخزينة الرئيسية المستنية الأول (مسموح بوردية واحدة غير مراجعة قبل الرجوع)'; end if;
end $$;
drop function public.clinic_finance_main_count_status();
drop function public.clinic_finance_main_count(jsonb, text, uuid);
do $$ begin execute (select def from clinic_finance.main_count_saved_defs where name = 'shift_single_active_message'); end $$;
revoke all on function clinic_finance.shift_single_active_message() from public, anon, authenticated;
drop index clinic_finance.fin_cashier_main_open;
create unique index fin_cashier_main_active on clinic_finance.shifts(cashier_id) where status <> 'reviewed' and is_main;
drop index clinic_finance.fin_register_main_open;
drop index clinic_finance.fin_register_active;
create unique index fin_register_active on clinic_finance.shifts(register_id) where status <> 'reviewed';
drop table clinic_finance.main_count_saved_defs;
commit;
