-- Repoint ONE stale center alias (svc_153ad79ae723925b, from center list v1 on 2026-10-28) from the INACTIVE twin
-- a61dcedb… (no code, 0 reception copies) to the ACTIVE «جلسة ليزر إزالة الشعر للجسم كامل (بالبطن والظهر) كانديلا»
-- 0001333 (cf0a3c69…). This alias alone blocks the center master review (decide_list alias check).
-- No RPC edits aliases, so this is a guarded single-row update plus a clinic_prices.audit line (actor = owner).
-- Covered by the owner's «انشر» on the center list (main chat 4, 23-11). Idempotent: does nothing once repointed.
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
do $$
declare a clinic_prices.aliases%rowtype;old_s public.pricing_services%rowtype;new_s public.pricing_services%rowtype;n int;
begin
 if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'wrong actor: expected the owner admin';end if;
 select * into new_s from public.pricing_services where booking_code='0001333' and active;
 if not found or new_s.id::text not like 'cf0a3c69%' then raise exception 'target 0001333 not found/active or id changed';end if;
 select count(*) into n from clinic_prices.aliases where scope_key='center' and external_code='svc_153ad79ae723925b';
 if n<>1 then raise exception 'expected exactly 1 center alias for svc_153ad79ae723925b, found %',n;end if;
 select * into a from clinic_prices.aliases where scope_key='center' and external_code='svc_153ad79ae723925b' for update;
 if a.service_id=new_s.id then raise notice 'alias already points to 0001333; nothing to do';return;end if;
 select * into old_s from public.pricing_services where id=a.service_id;
 if old_s.id::text not like 'a61dcedb%' or old_s.active or old_s.name<>new_s.name then raise exception 'alias target is not the expected inactive twin (%), stop',a.service_id;end if;
 if exists(select 1 from clinic_reception.services where pricing_service_id=old_s.id) then raise exception 'inactive twin has reception copies, stop';end if;
 update clinic_prices.aliases set service_id=new_s.id where id=a.id and service_id=old_s.id;
 insert into clinic_prices.audit(actor_id,action,list_id,details) values(public.my_admin_id(),'alias_repoint','12289346-917a-40e6-bd74-9b9696f844f4',
   jsonb_build_object('alias_id',a.id,'scope',a.scope_key,'external_code',a.external_code,'external_name',a.external_name,'unit',a.unit,
     'from_service',old_s.id,'to_service',new_s.id,'reason','الخدمة القديمة متوقفة ومكررة؛ الربط للخدمة الفعالة 0001333 لاعتماد مرجع المركز'));
end $$;
