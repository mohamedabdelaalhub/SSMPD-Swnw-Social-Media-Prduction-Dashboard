-- Rollback of 20261123190000_offer_no_stacking.sql (safe to run twice): back to the 20261123160000 resolve().
begin;
create or replace function clinic_prices.resolve(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare o record;
begin
 if p_contract is null then
  select l.id,l.name,l.version,l.valid_from,l.valid_to,i.fixed_price into o
   from clinic_prices.lists l join clinic_prices.items i on i.list_id=l.id and i.service_id=p_service
   where l.list_kind='offer' and l.status='active' and l.deleted_at is null and p_date between l.valid_from and l.valid_to
     and i.fixed_price is not null and i.fixed_price>0
   order by l.valid_from desc,l.id limit 1;
  if found then
   return jsonb_build_object('price',round(o.fixed_price,2),'source','offer','reason','عرض: '||o.name||' — لحد '||to_char(o.valid_to,'YYYY-MM-DD'),
     'list_id',o.id,'version',o.version,'offer_from',o.valid_from,'offer_until',o.valid_to);
  end if;
 end if;
 return clinic_prices.resolve_before_offer(p_service,p_base,p_date,p_contract);
end $$;
revoke all on function clinic_prices.resolve(uuid,numeric,date,uuid) from public,anon,authenticated;
commit;
