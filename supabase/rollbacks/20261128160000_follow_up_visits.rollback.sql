-- Rollback 20261128160000_follow_up_visits: restore service_operation, drop the follow-up objects (appointments columns included).
begin;
do $$ begin execute (select def from clinic_reception.follow_up_saved_defs where name = 'service_operation'); end $$;
drop function if exists public.clinic_reception_follow_up(uuid, text, jsonb);
drop trigger if exists trg_follow_up_appt on clinic_reception.appointments;
drop trigger if exists trg_follow_up_order_before on clinic_reception.orders;
drop trigger if exists trg_follow_up_order_ins on clinic_reception.orders;
drop trigger if exists trg_follow_up_order_upd on clinic_reception.orders;
drop function if exists clinic_reception.follow_up_appt_after(), clinic_reception.follow_up_order_after(), clinic_reception.follow_up_order_before(),
  clinic_reception.follow_up_service(uuid, uuid), clinic_reception.follow_up_can_manage(), clinic_reception.follow_up_left(uuid, uuid);
alter table clinic_reception.appointments drop column if exists follow_up_id, drop column if exists follow_of_visit_id, drop column if exists follow_up_coverage;
drop function if exists clinic_reception.follow_up_valid_until(clinic_reception.visit_follow_ups);
drop table if exists clinic_reception.follow_up_extensions, clinic_reception.follow_up_uses, clinic_reception.visit_follow_ups, clinic_reception.follow_up_rules, clinic_reception.follow_up_saved_defs;
alter table clinic_reception.settings drop column if exists follow_up_fee;
commit;
