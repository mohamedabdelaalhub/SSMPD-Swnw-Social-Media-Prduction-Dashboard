-- Rollback of 20261127200000_catalog_duplicates_cleanup: undoes every step recorded in clinic_prices.audit, newest first.
begin;
do $$
declare a record; it clinic_prices.items; al clinic_prices.aliases;
begin
  for a in select * from clinic_prices.audit where action = 'catalog_cleanup' and details->>'migration' = '20261127200000'
      and not exists (select 1 from clinic_prices.audit z where z.action = 'catalog_cleanup_rollback' and (z.details->>'of')::bigint = clinic_prices.audit.id)
      order by id desc loop
    case a.details->>'step'
      when 'item_moved' then update clinic_prices.items set service_id = (a.details->'item'->>'service_id')::uuid where id = (a.details->'item'->>'id')::uuid;
      when 'item_removed' then it := jsonb_populate_record(null::clinic_prices.items, a.details->'item'); insert into clinic_prices.items select it.*;
      when 'alias_moved' then update clinic_prices.aliases set service_id = (a.details->'alias'->>'service_id')::uuid where id = (a.details->'alias'->>'id')::uuid;
      when 'alias_removed' then al := jsonb_populate_record(null::clinic_prices.aliases, a.details->'alias'); insert into clinic_prices.aliases select al.*;
      when 'reception_moved' then update clinic_reception.services set pricing_service_id = (a.details->'reception_service'->>'pricing_service_id')::uuid where id = (a.details->'reception_service'->>'id')::uuid;
      when 'reception_off' then update clinic_reception.services set active = (a.details->'reception_service'->>'active')::boolean where id = (a.details->'reception_service'->>'id')::uuid;
      when 'service_cancelled' then update public.pricing_services set active = (a.details->'service'->>'active')::boolean, booking_enabled = (a.details->'service'->>'booking_enabled')::boolean where id = (a.details->'service'->>'id')::uuid;
      when 'service_renamed' then update public.pricing_services set name = a.details->>'old_name' where id = (a.details->>'service_id')::uuid;
      else null;
    end case;
    if a.details->>'step' in ('item_moved', 'item_removed') then update clinic_prices.lists set revision = revision + 1 where id = a.list_id; end if;
    insert into clinic_prices.audit(actor_id, action, list_id, details) values (a.actor_id, 'catalog_cleanup_rollback', a.list_id, jsonb_build_object('of', a.id));
  end loop;
end $$;
commit;
