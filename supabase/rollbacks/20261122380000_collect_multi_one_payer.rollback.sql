-- Rollback of 20261122380000_collect_multi_one_payer.sql. Payments already collected stay; only the flags/review columns go.
begin;
do $$ declare r record; begin
  if to_regclass('clinic_reception.one_payer_saved_defs') is null then raise exception 'لم يُطبّق الملف'; end if;
  if position('command_before_cross_payment' in pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف أمر الاستقبال — رجّعه الأول'; end if;
  for r in select def from clinic_reception.one_payer_saved_defs loop execute r.def; end loop;
end $$;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_cross_payment(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_cross_payment(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
alter table clinic_reception.payments drop column cross_patient, drop column cross_review_status, drop column cross_review_note,
  drop column cross_reviewed_by, drop column cross_reviewed_at;
drop table clinic_reception.one_payer_saved_defs;
commit;
