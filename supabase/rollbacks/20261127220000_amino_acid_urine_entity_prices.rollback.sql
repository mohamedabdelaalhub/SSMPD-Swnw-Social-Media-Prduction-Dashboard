-- Rollback of 20261127220000_amino_acid_urine_entity_prices: removes the items and aliases it added (from clinic_prices.audit).
begin;
do $$
declare a record;
begin
  for a in select * from clinic_prices.audit where action = 'owner_price_fix' and details->>'migration' = '20261127220000' order by id desc loop
    if a.details->>'step' = 'item_added' then
      delete from clinic_prices.items where list_id = a.list_id and service_id = (a.details->>'service_id')::uuid and fixed_price = 1890;
      update clinic_prices.lists set revision = revision + 1 where id = a.list_id;
    elsif a.details->>'step' = 'alias_restored' then
      delete from clinic_prices.aliases where id = (a.details->>'alias_id')::uuid;
    end if;
    insert into clinic_prices.audit(actor_id, action, list_id, details) values (a.actor_id, 'owner_price_fix_rollback', a.list_id, jsonb_build_object('of', a.id));
  end loop;
end $$;
commit;
