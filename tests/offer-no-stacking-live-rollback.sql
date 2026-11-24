-- Live check for mig 20261123190000 (no stacking) — one transaction, ends in ROLLBACK. Run from the repo root AFTER
-- applying the mig inside the same transaction (or with it already live):
--   begin; \i supabase/migrations/…190000….sql (without its begin/commit) … or simply run it on live after apply.
-- Creates the White Friday offer (tests/price-matching/22) and then, for every ACTIVE contract with a linked price list and
-- every offer service, compares:  new resolve(service, OFFER price, today, contract)
--                         against resolve_before_offer(service, CENTER price, today, contract)   (what it was before offers)
-- They must be identical (same price, or both refused). Also: cash price today = offer price.
begin;
\i tests/price-matching/22-white-friday-offer-steps.sql
create temp table ns_cmp(contract uuid,service text,new_price numeric,old_price numeric,new_err text,old_err text) on commit drop;
do $$
declare c record;s record;np numeric;op numeric;ne text;oe text;offer numeric;center numeric;
begin
 for s in select p.id,p.booking_code,i.fixed_price offer from clinic_prices.items i join clinic_prices.lists l on l.id=i.list_id
          join public.pricing_services p on p.id=i.service_id where l.name='عرض وايت فرايداي — ليزر كانديلا جنتل برو' and l.deleted_at is null loop
  center:=(clinic_prices.resolve_before_offer(s.id,(select base_price from public.pricing_services where id=s.id),current_date,null)->>'price')::numeric;
  for c in select id from public.contracting_entity_contracts where status='active' and price_list_id is not null and price_list_link_status='active' loop
   np:=null;op:=null;ne:=null;oe:=null;
   begin np:=(clinic_prices.resolve(s.id,s.offer,current_date,c.id)->>'price')::numeric; exception when others then ne:=left(sqlerrm,80); end;
   begin op:=(clinic_prices.resolve_before_offer(s.id,center,current_date,c.id)->>'price')::numeric; exception when others then oe:=left(sqlerrm,80); end;
   insert into ns_cmp values(c.id,s.booking_code,np,op,ne,oe);
  end loop;
 end loop;
end $$;
select 'pairs' part, jsonb_build_object('total',count(*),'same',count(*) filter(where new_price is not distinct from old_price and (new_err is null)=(old_err is null)),
  'different',count(*) filter(where not(new_price is not distinct from old_price and (new_err is null)=(old_err is null))),
  'priced_by_contract',count(*) filter(where new_price is not null)) from ns_cmp
union all
select 'differences', jsonb_agg(to_jsonb(n)) from (select * from ns_cmp where not(new_price is not distinct from old_price and (new_err is null)=(old_err is null)) limit 20) n
union all
select 'cash today', jsonb_agg(jsonb_build_array(p.booking_code,p.base_price,clinic_prices.resolve(p.id,p.base_price,current_date)->>'price')) from public.pricing_services p where p.booking_code in ('0001239','0001333','0001228');
rollback;
