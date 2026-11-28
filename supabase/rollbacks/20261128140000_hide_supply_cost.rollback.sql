-- Rollback 20261128140000_hide_supply_cost: restore the original functions under their public names.
begin;
drop function if exists public.clinic_reception_visit_usage(uuid, text, jsonb);
alter function clinic_reception.visit_usage_full(uuid, text, jsonb) rename to clinic_reception_visit_usage;
alter function clinic_reception.clinic_reception_visit_usage(uuid, text, jsonb) set schema public;
grant execute on function public.clinic_reception_visit_usage(uuid, text, jsonb) to authenticated;
do $$ declare f text; begin
  foreach f in array array['report_supplies_consumption', 'report_medicines_consumption', 'report_nursing_variance'] loop
    continue when to_regprocedure('clinic_reception.' || f || '_full(date,date,uuid)') is null;
    execute format('drop function if exists public.%I(date, date, uuid)', f);
    execute format('alter function clinic_reception.%I(date, date, uuid) rename to %I', f || '_full', f);
    execute format('alter function clinic_reception.%I(date, date, uuid) set schema public', f);
    execute format('grant execute on function public.%I(date, date, uuid) to authenticated', f);
  end loop;
  if to_regprocedure('clinic_reception.inventory_snapshot_full(uuid)') is not null then
    drop function if exists public.inventory_workspace_snapshot(uuid);
    alter function clinic_reception.inventory_snapshot_full(uuid) rename to inventory_workspace_snapshot;
    alter function clinic_reception.inventory_workspace_snapshot(uuid) set schema public;
    grant execute on function public.inventory_workspace_snapshot(uuid) to authenticated;
  end if;
  if to_regprocedure('public.nursing_before_cost(uuid,text,jsonb)') is not null then
    drop function if exists public.clinic_reception_nursing(uuid, text, jsonb);
    alter function public.nursing_before_cost(uuid, text, jsonb) rename to clinic_reception_nursing;
    grant execute on function public.clinic_reception_nursing(uuid, text, jsonb) to authenticated;
  end if;
end $$;
drop function if exists clinic_reception.strip_cost(jsonb, text[]);
drop function if exists clinic_reception.can_see_cost();
commit;
