-- Rollback 20261125210000 supplies at service PR2 (performer screen + vitals kit). Restores the nursing RPC and the shift guard
-- check, drops the new objects. Stock movements / journal entries written while it was live stay (they are real history; a vitals
-- consumption and its reversal are both kept).
begin;
drop function if exists public.clinic_reception_vitals_kit(uuid, text, jsonb);
drop function if exists public.clinic_reception_performer(uuid, text, jsonb);
drop function public.clinic_reception_nursing(uuid, text, jsonb);
alter function clinic_reception.nursing_before_vitals(uuid, text, jsonb) set schema public;
alter function public.nursing_before_vitals(uuid, text, jsonb) rename to clinic_reception_nursing;
revoke all on function public.clinic_reception_nursing(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_nursing(uuid, text, jsonb) to authenticated;
do $$ begin
  if to_regprocedure('clinic_reception.shift_guard_check_before_performer(uuid)') is not null then
    drop function clinic_reception.shift_guard_check(uuid);
    alter function clinic_reception.shift_guard_check_before_performer(uuid) rename to shift_guard_check;
    revoke all on function clinic_reception.shift_guard_check(uuid) from public, anon, authenticated;
  end if;
end $$;
drop function if exists clinic_reception.vitals_reconcile(uuid, uuid, jsonb, uuid);
drop function if exists clinic_reception.stock_at(uuid, uuid, uuid);
drop function if exists clinic_reception.dept_locations(uuid, text);
drop function if exists clinic_reception.vitals_kit_json(uuid);
drop function if exists clinic_reception.vital_states_of(jsonb);
drop function if exists clinic_reception.vital_fields(text);
drop function if exists clinic_reception.vital_keys();
drop function if exists clinic_reception.performer_locations(uuid, jsonb);
drop function if exists clinic_reception.performer_dept_ok(jsonb, text);
drop function if exists clinic_reception.performer_scope(uuid);
drop function if exists clinic_reception.performer_role_ok();
alter table clinic_reception.visit_triage drop column if exists vital_states;
drop table if exists clinic_reception.vitals_consumptions;
drop table if exists clinic_reception.vitals_kit;
commit;
