-- One discount only (owner 2026-11-24): «العروض ملهاش اي خصومات تانية — يعني المريض يسري عليه خصم واحد اما العروض او
-- النقابات واحد منهم فقط». An offer price must never become the base of a contract/union price.
--
-- Contract pricing calls clinic_prices.resolve(service, base, date, contract). Lists with fixed prices ignore the base,
-- but lists that derive from the center price (fallback 'base'/'discount', mode discount/mixed) use it — and the base the
-- callers pass is the reception cash price, which during an offer IS the offer price (clinic_reception.sync_catalog,
-- clinic_reception entity claims). So, for a contract call only: when an active offer covers the date for this service and
-- the base passed equals that offer price, the base is replaced by the NON-offer center price
-- (clinic_prices.resolve_before_offer with no contract). Cash prices (no contract) and everything else are unchanged.
-- The desk discounts (نقابة / نادي / فيزيتا / كارت العيلة / خصم خاص) on offer-priced orders are refused in the reception
-- discount flow (reception chat).
-- Requires 20261123160000_offer_price_lists. Rollback: supabase/rollbacks/20261123190000_offer_no_stacking.rollback.sql
begin;
do $$begin
 if to_regprocedure('clinic_prices.resolve_before_offer(uuid,numeric,date,uuid)') is null then
  raise exception 'apply 20261123160000_offer_price_lists first';end if;
end $$;

create or replace function clinic_prices.resolve(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare o record;base numeric:=p_base;r jsonb;
begin
 select l.id,l.name,l.version,l.valid_from,l.valid_to,i.fixed_price into o
  from clinic_prices.lists l join clinic_prices.items i on i.list_id=l.id and i.service_id=p_service
  where l.list_kind='offer' and l.status='active' and l.deleted_at is null and p_date between l.valid_from and l.valid_to
    and i.fixed_price is not null and i.fixed_price>0
  order by l.valid_from desc,l.id limit 1;
 if p_contract is null then
  if o.id is not null then
   return jsonb_build_object('price',round(o.fixed_price,2),'source','offer','reason','عرض: '||o.name||' — لحد '||to_char(o.valid_to,'YYYY-MM-DD'),
     'list_id',o.id,'version',o.version,'offer_from',o.valid_from,'offer_until',o.valid_to);
  end if;
  return clinic_prices.resolve_before_offer(p_service,p_base,p_date,null);
 end if;
 -- contract: never build on top of the offer price
 if o.id is not null and round(p_base,2)=round(o.fixed_price,2) then
  base:=(clinic_prices.resolve_before_offer(p_service,p_base,p_date,null)->>'price')::numeric;
 end if;
 r:=clinic_prices.resolve_before_offer(p_service,base,p_date,p_contract);
 if base is distinct from p_base then r:=r||jsonb_build_object('base_without_offer',base,'offer_ignored',o.id);end if;
 return r;
end $$;
revoke all on function clinic_prices.resolve(uuid,numeric,date,uuid) from public,anon,authenticated;
commit;
