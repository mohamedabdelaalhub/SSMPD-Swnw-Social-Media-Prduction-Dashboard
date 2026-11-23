-- Rollback of 20261123020000_reception_shift_guard.sql: desk actions no longer need an open shift.
begin;
do $$ begin
  if to_regprocedure('clinic_reception.command_before_shift_guard(uuid,text,jsonb,uuid)') is null then raise exception 'لم يُطبّق الملف'; end if;
  if position('command_before_shift_guard' in pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف أمر الاستقبال — رجّعه الأول'; end if;
  if to_regprocedure('clinic_reception.journey_command_before_shift_guard(uuid,text,jsonb,uuid)') is not null
     and position('journey_command_before_shift_guard' in pg_get_functiondef('public.clinic_reception_journey_command(uuid,text,jsonb,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف أمر رحلة المريض — رجّعه الأول'; end if;
end $$;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_shift_guard(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_shift_guard(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
do $$ begin
  if to_regprocedure('clinic_reception.journey_command_before_shift_guard(uuid,text,jsonb,uuid)') is null then return; end if;
  drop function public.clinic_reception_journey_command(uuid, text, jsonb, uuid);
  alter function clinic_reception.journey_command_before_shift_guard(uuid, text, jsonb, uuid) set schema public;
  alter function public.journey_command_before_shift_guard(uuid, text, jsonb, uuid) rename to clinic_reception_journey_command;
  revoke all on function public.clinic_reception_journey_command(uuid, text, jsonb, uuid) from public, anon;
  grant execute on function public.clinic_reception_journey_command(uuid, text, jsonb, uuid) to authenticated;
end $$;
drop function public.clinic_reception_shift_watch();
drop function public.clinic_reception_shift_guard();
drop function clinic_reception.shift_guard_check(uuid);
drop function clinic_reception.shift_guard_state();
commit;
