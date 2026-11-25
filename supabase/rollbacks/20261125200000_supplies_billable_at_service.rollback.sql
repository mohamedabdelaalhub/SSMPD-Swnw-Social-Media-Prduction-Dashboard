-- Rollback 20261125200000 supplies at service (PR1). Restores the previous command / journey wrappers and drops the new objects.
-- Stock movements, invoices and audit rows written while it was live stay (they are real history).
begin;
drop function if exists public.clinic_reception_visit_supplies(uuid, text, jsonb);
drop function if exists clinic_reception.supply_warnings(uuid, uuid);
drop function if exists public.clinic_reception_visit_reopen(uuid, uuid, text, uuid);
drop function if exists public.clinic_reception_finish_check(uuid, jsonb);
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_supplies(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_supplies(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
do $$ begin
  if to_regprocedure('clinic_reception.journey_command_before_supplies(uuid,text,jsonb,uuid)') is not null then
    drop function public.clinic_reception_journey_command(uuid, text, jsonb, uuid);
    alter function clinic_reception.journey_command_before_supplies(uuid, text, jsonb, uuid) set schema public;
    alter function public.journey_command_before_supplies(uuid, text, jsonb, uuid) rename to clinic_reception_journey_command;
    revoke all on function public.clinic_reception_journey_command(uuid, text, jsonb, uuid) from public, anon;
    grant execute on function public.clinic_reception_journey_command(uuid, text, jsonb, uuid) to authenticated;
  end if;
  if to_regprocedure('clinic_reception.activity_kind(text)') is not null then
    create or replace function clinic_reception.activity_kind(p_action text) returns text language sql immutable set search_path = pg_catalog as $f$
      select case
        when p_action in ('book', 'overbook') then 'book'
        when p_action in ('reschedule', 'manual_time', 'auto_booking_set_time') then 'reschedule'
        when p_action in ('cancel', 'no_show') then 'cancel'
        when p_action in ('arrive') then 'visit'
        when p_action in ('order_add', 'journey_request_service') then 'service'
        when p_action in ('collect', 'collect_multi') then 'pay'
        when p_action in ('request', 'visit_void_requested', 'visit_void_completed', 'request_review') then 'void'
      end
    $f$;
  end if;
  if to_regprocedure('public.inventory_pricing_list()') is not null then
    if position('patient_billable' in pg_get_functiondef('public.inventory_pricing_list()'::regprocedure)) > 0 then
      execute replace(pg_get_functiondef('public.inventory_pricing_list()'::regprocedure), ' ''patient_billable'', i.patient_billable,', '');
    end if;
  end if;
  if to_regclass('public.inventory_items') is not null then
    drop trigger if exists inventory_items_billable_mirror on public.inventory_items;
    drop trigger if exists items_billable_from_inventory on clinic_reception.items;
    alter table public.inventory_items drop column if exists patient_billable;
  end if;
end $$;
drop function if exists clinic_reception.visit_missing_billable(uuid);
drop table if exists clinic_reception.visit_supply_adds;
drop function if exists clinic_reception.consume_location_ok(uuid, text, uuid);
drop function if exists clinic_reception.supply_section(text);
drop table if exists clinic_reception.consume_locations;
drop function if exists public.clinic_reception_service_billing(uuid, text, jsonb);
drop function if exists public.inventory_set_patient_billable(uuid, boolean);
drop function if exists clinic_reception.billing_editor();
drop function if exists clinic_reception.item_billable(uuid, uuid);
drop table if exists clinic_reception.service_billing;
drop function if exists public.inventory_items_billable_mirror();
drop function if exists clinic_reception.items_billable_from_inventory();
drop function if exists clinic_reception.admin_name(uuid);
alter table clinic_reception.items drop column if exists patient_billable;
commit;
