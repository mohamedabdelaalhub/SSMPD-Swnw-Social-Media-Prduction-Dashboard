-- Rollback of 20261123100000_reception_shift_guard.sql: desk actions no longer need an open shift.
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
-- back to one unreviewed collection shift per register / cashier (refused while two are waiting — review them first)
drop index if exists clinic_finance.fin_register_collection_open;
drop index if exists clinic_finance.fin_cashier_collection_open;
create unique index fin_register_active on clinic_finance.shifts(register_id) where status <> 'reviewed' and not is_main;
create unique index fin_cashier_collection_active on clinic_finance.shifts(cashier_id) where status <> 'reviewed' and not is_main;
do $$ declare r record; begin
  for r in select def from clinic_reception.shift_guard_saved_defs loop execute r.def; end loop;
  if not exists (select 1 from clinic_reception.shift_guard_saved_defs) then drop function if exists clinic_finance.shift_single_active_message(); end if;
end $$;
drop table clinic_reception.shift_guard_saved_defs;
commit;
