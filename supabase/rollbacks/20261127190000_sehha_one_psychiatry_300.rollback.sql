-- Rollback of 20261127190000_sehha_one_psychiatry_300: restores the old price from clinic_prices.audit.
begin;
do $$
declare a record;
begin
  for a in select * from clinic_prices.audit where action = 'owner_price_fix' and details->>'migration' = '20261127190000' order by id desc loop
    update clinic_prices.items set fixed_price = (a.details->'item'->>'fixed_price')::numeric where id = (a.details->'item'->>'id')::uuid;
    update clinic_prices.lists set revision = revision + 1 where id = a.list_id;
    insert into clinic_prices.audit(actor_id, action, list_id, details) values (a.actor_id, 'owner_price_fix_rollback', a.list_id, jsonb_build_object('of', a.id));
  end loop;
end $$;
commit;
