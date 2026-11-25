-- New service at a FIXED 200 EGP — owner decision 2026-11-25 (typed in main chat 5): «جلسة ليزر تحديد الذقن (إزالة شعر
-- الذقن والشارب) كانديلا». Reception (Mazen) needed it for Dr Shady Hossam Abdelfattah's patient.
--  * Copies the booking setup of 0001239 (face Candela): category, unit, department, minutes, requires_device and
--    every other column, except name/code/price. supplies_used=[] and profit_margin=0, so sync gives exactly 200.
--  * Not added to any price list. The active center list has fallback 'base', so cash = base_price = 200. It is in
--    no offer list (White Friday or other), so it never gets an offer price.
--  * New booking code = next free 7-digit code. canonical_code comes from the trigger (SVC-…).
--  * Reason is written to clinic_prices.audit on the center list: «قرار المالك 2026-11-25 — 200 ثابت».
-- Acts AS THE OWNER (RLS "accounting write services"). Idempotent: does nothing if the name already exists.
-- Run inside BEGIN … COMMIT, then the reception catalogue sync for the live workspace (last block).
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
create temp table chin_new on commit drop as
select s.id src_id, s.booking_department src_dept, s.booking_minutes src_minutes, s.booking_requires_device src_device,
       s.supplies_used src_supplies,
       lpad(((select max(booking_code::bigint) from public.pricing_services where booking_code ~ '^[0-9]{7}$')+1)::text,7,'0') new_code,
       'جلسة ليزر تحديد الذقن (إزالة شعر الذقن والشارب) كانديلا'::text new_name,
       exists(select 1 from public.pricing_services x where x.name='جلسة ليزر تحديد الذقن (إزالة شعر الذقن والشارب) كانديلا') already
from public.pricing_services s where s.booking_code='0001239' and s.active;
do $$declare c chin_new%rowtype;begin
 if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'wrong actor';end if;
 if (select count(*) from chin_new)<>1 then raise exception '0001239 (face Candela) not found/active';end if;
 select * into c from chin_new;
 if c.already then raise notice 'service already exists — nothing to do';return;end if;
 if c.src_dept is distinct from 'الجلدية والتجميل' then raise exception '0001239 department is %, owner said الجلدية والتجميل — stop and ask',c.src_dept;end if;
 if not c.src_device then raise exception '0001239 does not require a device — stop and ask';end if;
end $$;
grant select on chin_new to authenticated;
set local role authenticated;
insert into public.pricing_services
select (jsonb_populate_record(null::public.pricing_services,
         to_jsonb(s) || jsonb_build_object('id',gen_random_uuid(),'name',c.new_name,'booking_code',c.new_code,'canonical_code',null,
           'base_price',200,'supplies_used','[]'::jsonb,'profit_margin_percent',0,'active',true,'booking_enabled',true,
           'created_by','bd5a528f-af8d-4ada-afe9-ce64e68b1d92','created_at',now(),'updated_at',now()))).*
from chin_new c join public.pricing_services s on s.id=c.src_id
where not c.already;
reset role;
insert into clinic_prices.audit(actor_id,action,list_id,details)
select 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92', 'owner_fixed_price_service', l.id,
       jsonb_build_object('service_id',p.id,'code',p.booking_code,'name',p.name,'price',200,'copied_from','0001239',
                          'reason','قرار المالك 2026-11-25 — 200 ثابت')
from chin_new c join public.pricing_services p on p.booking_code=c.new_code and p.name=c.new_name
join lateral (select id from clinic_prices.lists where list_kind='center' and contract_id is null and status='active' and deleted_at is null
              order by valid_from desc,id limit 1) l on true
where not c.already;
do $$declare ws uuid;begin
 select id into ws from clinic_reception.workspaces where mode='live' order by id limit 1;
 perform clinic_reception.sync_catalog(ws);
end $$;
