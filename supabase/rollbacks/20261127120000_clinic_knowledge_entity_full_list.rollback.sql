-- Rollback of 20261127120000: restores clinic_knowledge_feed() exactly as in 20261127030000 (30-line cap, no consultations).
begin;

create or replace function public.clinic_knowledge_feed() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  today date := (now() at time zone 'Africa/Cairo')::date;
  c record; it record; o record; lines jsonb; total int; shown int; cash numeric; p numeric;
  ents jsonb := '[]'::jsonb; offs jsonb := '[]'::jsonb; usable boolean;
begin
  for c in
    select k.id, k.discount_percent, k.services, k.booking_billing_kind, k.booking_coverage, k.price_list_id, e.name entity_name,
           (k.price_list_id is not null and k.price_list_link_status = 'active'
            and exists (select 1 from clinic_prices.lists l where l.id = k.price_list_id and l.status = 'active' and l.deleted_at is null
                        and (l.list_kind = 'reference' or today between l.valid_from and l.valid_to))) has_list
    from public.contracting_entity_contracts k join public.contracting_entities e on e.id = k.entity_id
    where k.status = 'active' and (k.start_date is null or k.start_date <= today) and (k.end_date is null or k.end_date >= today)
    order by e.name, k.id
  loop
    lines := '[]'::jsonb; total := 0; shown := 0;
    if c.has_list then
      select count(*) into total from clinic_prices.items i join public.pricing_services s on s.id = i.service_id and s.active
       where i.list_id = c.price_list_id;
      for it in
        select s.id, s.name, s.base_price from clinic_prices.items i join public.pricing_services s on s.id = i.service_id and s.active
        left join clinic_prices.sections sec on sec.id = i.section_id
        where i.list_id = c.price_list_id order by sec.name nulls last, s.name, s.id
      loop
        exit when shown >= 30;
        begin
          cash := (clinic_prices.resolve(it.id, it.base_price, today, null)->>'price')::numeric;
          p := (clinic_prices.resolve(it.id, cash, today, c.id)->>'price')::numeric;
          if p is not null and p > 0 then
            lines := lines || jsonb_build_object('name', it.name, 'price', round(p, 2)); shown := shown + 1;
          end if;
        exception when others then null;  -- not priceable for this contract: skip, never guess
        end;
      end loop;
    end if;
    ents := ents || jsonb_build_object('entity', c.entity_name, 'discount_percent', c.discount_percent, 'services', c.services,
      'billing', c.booking_billing_kind, 'coverage', c.booking_coverage, 'has_list', c.has_list and shown > 0,
      'lines', lines, 'more', greatest(total - shown, 0));
  end loop;

  for o in
    select l.id, l.name, l.valid_to from clinic_prices.lists l
    where l.list_kind = 'offer' and l.status = 'active' and l.deleted_at is null and today between l.valid_from and l.valid_to
    order by l.valid_to, l.name
  loop
    select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'price', x.price) order by x.ord), '[]'::jsonb), coalesce(max(x.total), 0)
      into lines, total
    from (select s.name, round(i.fixed_price, 2) price, row_number() over (order by sec.name nulls last, s.name, s.id) ord, count(*) over () total
          from clinic_prices.items i join public.pricing_services s on s.id = i.service_id and s.active
          left join clinic_prices.sections sec on sec.id = i.section_id
          where i.list_id = o.id and i.fixed_price > 0) x
    where x.ord <= 30;
    offs := offs || jsonb_build_object('name', o.name, 'valid_to', o.valid_to, 'lines', lines, 'more', greatest(total - jsonb_array_length(lines), 0));
  end loop;

  return jsonb_build_object('as_of', today, 'entities', ents, 'offers', offs);
end $$;
revoke all on function public.clinic_knowledge_feed() from public, anon, authenticated;
grant execute on function public.clinic_knowledge_feed() to service_role;
commit;
