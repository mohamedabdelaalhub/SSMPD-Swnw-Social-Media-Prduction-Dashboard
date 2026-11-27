-- Rollback of 20261122320000_nursing_attendance_kpi.sql: restores staff_kpis, removes the KPI, cron job, tables and functions.
begin;
do $$ declare d text; begin
  select def into d from clinic_reception.nursing_kpi_saved_defs where name = 'staff_kpis';
  if d is null then raise exception 'لم يُطبّق الملف'; end if;
  execute d;
  if to_regclass('cron.job') is not null then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''nursing-kpi-30m''';
  end if;
end $$;
delete from public.kpi_targets where kpi = 'nursing_attendance_penalty';
delete from public.kpi_defs where kpi = 'nursing_attendance_penalty';
drop function clinic_reception.nursing_kpi_run();
drop function clinic_reception.nursing_kpi_compute(date);
drop table clinic_reception.nursing_day_kpi;
drop table clinic_reception.nursing_kpi_weights;
drop table clinic_reception.nursing_kpi_saved_defs;
commit;
