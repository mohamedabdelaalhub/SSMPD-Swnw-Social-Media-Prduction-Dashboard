-- Rollback of 20261125230000_service_profit_report.sql (read-only report: nothing else to undo).
begin;
drop function public.report_service_profit(date, date, uuid);
delete from public.report_access where report_code = 'service_profit';
delete from public.report_registry where code = 'service_profit';
commit;
