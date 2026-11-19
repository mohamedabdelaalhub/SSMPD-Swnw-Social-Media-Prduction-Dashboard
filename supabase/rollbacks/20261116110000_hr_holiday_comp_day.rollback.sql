-- Rollback of 20261116110000_hr_holiday_comp_day.sql. Balance credits already granted stay (normal approved leave_credit rows);
-- holiday_comp request rows must be removed or kept by hand before the kind check is restored.
begin;
drop trigger if exists requests_holiday_comp_grant on clinic_people.requests;
drop trigger if exists requests_holiday_comp_rules on clinic_people.requests;
drop function if exists clinic_people.holiday_comp_grant();
drop function if exists clinic_people.holiday_comp_rules();
drop index if exists clinic_people.requests_holiday_comp_once;
do $$ begin
  if exists (select 1 from clinic_people.requests where kind = 'holiday_comp') then
    raise exception 'فيه طلبات يوم بديل مسجلة؛ قرر مصيرها قبل الرجوع';
  end if;
end $$;
alter table clinic_people.requests drop constraint if exists requests_kind_check;
alter table clinic_people.requests add constraint requests_kind_check
  check (kind in ('leave','permission','training','advance','overtime','leave_credit'));
alter table clinic_people.requests drop column if exists source_request_id;
commit;
