-- Rollback of 20261127080000_fix_wrong_lab_aliases: restores every item and alias exactly as recorded in
-- clinic_prices.audit (details.item / details.alias), then logs the rollback. Idempotent.
begin;
do $$
declare r record; it clinic_prices.items; al clinic_prices.aliases;
begin
  for r in select * from clinic_prices.audit where action = 'fix_wrong_link' and details->>'migration' = '20261127080000'
      and not exists (select 1 from clinic_prices.audit z where z.action = 'fix_wrong_link_rollback' and (z.details->>'of')::bigint = clinic_prices.audit.id)
      order by id desc loop
    if r.details ? 'item' then
      it := jsonb_populate_record(null::clinic_prices.items, r.details->'item');
      if exists (select 1 from clinic_prices.items where id = it.id) then update clinic_prices.items set service_id = it.service_id where id = it.id;
      else insert into clinic_prices.items select it.*; end if;
    elsif r.details ? 'alias' then
      al := jsonb_populate_record(null::clinic_prices.aliases, r.details->'alias');
      if exists (select 1 from clinic_prices.aliases where id = al.id) then update clinic_prices.aliases set service_id = al.service_id where id = al.id;
      else insert into clinic_prices.aliases select al.*; end if;
    end if;
    insert into clinic_prices.audit(actor_id, action, list_id, details) values (r.actor_id, 'fix_wrong_link_rollback', r.list_id, jsonb_build_object('of', r.id));
  end loop;
end $$;
commit;
