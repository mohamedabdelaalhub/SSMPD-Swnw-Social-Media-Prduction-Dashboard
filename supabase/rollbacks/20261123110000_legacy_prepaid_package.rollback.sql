-- Rollback of 20261123110000_legacy_prepaid_package.sql. Refused once a legacy package was approved (its package, entry and sessions
-- stay real — reverse them through finance first).
begin;
do $$ begin
  if to_regprocedure('clinic_reception.command_before_legacy_package(uuid,text,jsonb,uuid)') is null then raise exception 'لم يُطبّق الملف'; end if;
  if position('command_before_legacy_package' in pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف أمر الاستقبال — رجّعه الأول'; end if;
  if exists (select 1 from clinic_reception.legacy_package_requests where status = 'approved') then
    raise exception 'فيه باكج قديم اتعتمد — مينفعش الرجوع'; end if;
end $$;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_legacy_package(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_legacy_package(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function public.clinic_reception_legacy_packages(uuid, uuid);
drop function clinic_reception.order_use_package(uuid, jsonb, uuid);
drop function public.clinic_reception_legacy_package_review(uuid, boolean, text);
drop function clinic_reception.legacy_package_request(uuid, jsonb, uuid);
drop function clinic_reception.legacy_lines(uuid, jsonb, numeric);
alter table clinic_reception.packages drop column legacy_paid_on;
drop table clinic_reception.legacy_package_requests;
delete from clinic_finance.accounts a where a.code = '3198' and not exists (select 1 from clinic_finance.lines l where l.account = '3198');
commit;
