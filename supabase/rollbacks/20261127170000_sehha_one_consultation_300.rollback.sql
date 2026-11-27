-- Rollback of 20261127170000_sehha_one_consultation_300: restores the specialist price and removes the added consultant item,
-- from clinic_prices.audit.
begin;
do $$
declare a record; lid uuid;
begin
  for a in select * from clinic_prices.audit where action = 'owner_price_fix' and details->>'migration' = '20261127170000' order by id desc loop
    lid := a.list_id;
    if a.details->>'step' = 'specialist_price' then
      update clinic_prices.items set fixed_price = (a.details->'item'->>'fixed_price')::numeric where id = (a.details->'item'->>'id')::uuid;
    elsif a.details->>'step' = 'consultant_added' then
      delete from clinic_prices.items where list_id = a.list_id and service_id = (a.details->>'service_id')::uuid;
    end if;
    insert into clinic_prices.audit(actor_id, action, list_id, details) values (a.actor_id, 'owner_price_fix_rollback', a.list_id, jsonb_build_object('of', a.id));
  end loop;
  if lid is not null then update clinic_prices.lists set revision = revision + 1 where id = lid; end if;
end $$;
commit;
