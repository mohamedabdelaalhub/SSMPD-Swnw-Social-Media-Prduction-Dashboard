-- Rollback of 20261122190000_center_hours_10.sql: restore the saved fallback_slot_ok body.
begin;
do $$ declare d text; begin
  select def into d from clinic_reception.center_hours_saved_defs where sig = 'clinic_reception.fallback_slot_ok(uuid,timestamptz,timestamptz)';
  if d is null then raise exception 'no saved definition'; end if;
  execute d;
end $$;
drop table clinic_reception.center_hours_saved_defs;
commit;
