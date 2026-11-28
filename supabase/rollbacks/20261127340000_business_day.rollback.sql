-- Rollback of 20261127340000_business_day.sql: restores clinic_reception.today() (calendar Cairo day), drops the helpers, the RPC, the
-- change log and the cutoff column (the log of who changed the cutoff is lost — export it first if needed).
begin;
do $$ declare d text; begin
  if to_regclass('clinic_reception.business_day_saved_defs') is null then raise exception 'الملف مش متطبق'; end if;
  select def into d from clinic_reception.business_day_saved_defs where sig = 'clinic_reception.today()';
  if d is null then raise exception 'النسخة المحفوظة مش موجودة'; end if;
  execute d;
end $$;
drop function public.clinic_reception_business_day(text, jsonb);
drop function clinic_reception.business_day(timestamptz);
drop function clinic_reception.business_day_cutoff();
drop table clinic_reception.business_day_changes;
alter table clinic_reception.settings drop column business_day_cutoff;
drop table clinic_reception.business_day_saved_defs;
commit;
