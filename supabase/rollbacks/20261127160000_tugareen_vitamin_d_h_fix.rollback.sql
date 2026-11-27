-- Rollback of 20261127160000_tugareen_vitamin_d_h_fix: restores the Vitamin H price, removes the added Vitamin D (25-OH)
-- item and puts the file row back exactly as it was, all from clinic_prices.audit. Refuses if the list left draft.
begin;
do $$
declare l clinic_prices.lists%rowtype; a record;
begin
  select * into l from clinic_prices.lists where name = 'قائمة أسعار نقابة التجاريين' and deleted_at is null for update;
  if l.status <> 'draft' then raise exception 'list is % — not draft; stop', l.status; end if;
  for a in select * from clinic_prices.audit where list_id = l.id and action = 'owner_price_fix' and details->>'migration' = '20261127160000' order by id desc loop
    if a.details->>'step' = 'vitamin_h_price' then
      update clinic_prices.items set fixed_price = (a.details->'item'->>'fixed_price')::numeric where id = (a.details->'item'->>'id')::uuid;
    elsif a.details->>'step' = 'vitamin_d_added' then
      delete from clinic_prices.items where list_id = l.id and service_id = (a.details->>'service_id')::uuid;
    elsif a.details->>'step' = 'row_relinked' then
      update clinic_prices.batches set rows = jsonb_set(rows, array[a.details->>'row'], a.details->'old_row'), revision = revision + 1
       where id = (a.details->>'batch_id')::uuid and status = 'draft';
    end if;
    insert into clinic_prices.audit(actor_id, action, list_id, details) values (a.actor_id, 'owner_price_fix_rollback', l.id, jsonb_build_object('of', a.id));
  end loop;
  update clinic_prices.lists set revision = revision + 1 where id = l.id;
end $$;
commit;
