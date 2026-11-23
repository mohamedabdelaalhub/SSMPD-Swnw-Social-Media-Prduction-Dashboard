-- Deactivate the 2 duplicate catalogue copies that block the center master 'prepare' (owner decision required).
-- KEEP 0000167 / 0000168: they hold the center alias (svc_fc502f714a18cd67 / svc_75cfcefc9bc6153a) that master 'review' checks.
-- DEACTIVATE 0000003 «قياس سكر عشوائي داخل المركز (شامل المستلزمات)» and 0000004 «فك كانيولا (شامل المستلزمات)»:
-- same name/category/price 50, 0 appointments/orders/follow-ups/entitlements/template lines, 0 aliases, 0 contracts (08, 23-11).
-- Same write the pricing screen does (db.js → pricing_services.update, RLS as the owner). Nothing is deleted; the reception
-- copy is switched off by clinic_reception.sync_catalog on the next reception load (inactive pricing ⇒ inactive service).
-- Idempotent. Undo = set active=true on the same 2 ids.
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
set local role authenticated;
update public.pricing_services set active=false
 where id in ('2d9954c7-a9bc-5ae3-9363-59be8aba4ea3','6fc82d83-3733-5235-ba42-247a405680a2') and active
   and booking_code in ('0000003','0000004');
reset role;
do $$begin
 if exists(select 1 from public.pricing_services where id in ('2d9954c7-a9bc-5ae3-9363-59be8aba4ea3','6fc82d83-3733-5235-ba42-247a405680a2') and active)
 then raise exception 'dedup did not apply (RLS refused?)';end if;
 if exists(select 1 from public.pricing_services where id in ('2f4eee27-9285-490b-af68-084d515559e2','6a6e5e4c-22dc-4787-a59d-1952b83f212c') and not active)
 then raise exception 'kept copies 0000167/0000168 must stay active';end if;
end $$;
