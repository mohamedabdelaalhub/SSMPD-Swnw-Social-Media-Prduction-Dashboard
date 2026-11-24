-- DRY RUN of 22 — one transaction, ends in ROLLBACK. Shows every offer line: base → offer price as resolve() returns
-- it today and on 2026-12-01 (must be back to base). Run from tests/price-matching with -v ON_ERROR_STOP=1.
begin;
\i 22-white-friday-offer-steps.sql
select 'offer' part,(select jsonb_build_object('name',name,'status',status,'from',valid_from,'to',valid_to,'items',(select count(*) from clinic_prices.items where list_id=l.id)) from clinic_prices.lists l where name='عرض وايت فرايداي — ليزر كانديلا جنتل برو' and deleted_at is null);
select p.booking_code,left(p.name,60) service,p.base_price base,
       (clinic_prices.resolve(p.id,p.base_price,current_date)->>'price')::numeric today,
       clinic_prices.resolve(p.id,p.base_price,current_date)->>'source' today_source,
       (clinic_prices.resolve(p.id,p.base_price,'2026-12-01')->>'price')::numeric dec_1
from public.pricing_services p join clinic_prices.items i on i.service_id=p.id
join clinic_prices.lists l on l.id=i.list_id and l.name='عرض وايت فرايداي — ليزر كانديلا جنتل برو' and l.deleted_at is null
order by p.booking_code;
rollback;
