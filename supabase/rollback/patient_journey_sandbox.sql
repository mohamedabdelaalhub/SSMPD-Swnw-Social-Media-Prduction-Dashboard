-- Explicit operator rollback after this migration was applied. Preserves data.
begin;
revoke execute on function public.clinic_reception_sandbox_open(date),
 public.clinic_reception_sandbox_snapshot(uuid,date),
 public.clinic_reception_sandbox_command(uuid,text,jsonb,uuid) from authenticated;
do $restore$ begin
 execute replace(pg_get_functiondef('clinic_reception.access_before_journey_sandbox(uuid,text)'::regprocedure),
 'FUNCTION clinic_reception.access_before_journey_sandbox(', 'FUNCTION clinic_reception.access(');
end $restore$;
revoke all on function clinic_reception.access(uuid,text) from public,anon,authenticated;
commit;
