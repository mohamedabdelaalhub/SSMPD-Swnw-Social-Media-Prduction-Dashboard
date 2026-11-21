-- Rollback of 20261109110000_referral_commission_external.sql: restores the PRODUCTION definition of so_attach captured 2026-11-07 (md5 9d6dfad2a03938e9cfb17185898c6bf4). Grants are unchanged by CREATE OR REPLACE.
begin;
CREATE OR REPLACE FUNCTION public.clinic_reception_so_attach(p_workspace uuid, p_order uuid, p_ext jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'book');
 o clinic_reception.orders%rowtype; kind text; mode text; bp text; cat text;
 ref text; perf text; prov clinic_reception.external_providers%rowtype; cur clinic_reception.order_ext%rowtype;
 net numeric; rate numeric:=0; commission numeric:=0; payable numeric:=0; receivable numeric:=0; cost numeric; share numeric; priced jsonb;
begin
 select * into o from clinic_reception.orders where id=p_order and workspace_id=p_workspace;
 if not found then raise exception 'الطلب غير موجود';end if;
 kind:=coalesce(p_ext->>'kind','service');mode:=coalesce(p_ext->>'mode','internal');bp:=coalesce(p_ext->>'billing_party','center');
 if kind not in ('service','radiology','lab','medicine','supply') then raise exception 'نوع الطلب غير صحيح';end if;
 if mode not in ('internal','external') then raise exception 'نوع التنفيذ غير صحيح';end if;
 if bp not in ('center','provider') then raise exception 'جهة المحاسبة غير صحيحة';end if;
 if mode='internal' and bp='provider' then raise exception 'محاسبة المزوّد تتطلب تنفيذًا خارجيًا';end if;
 if mode='external' and kind not in ('lab','radiology') then raise exception 'التنفيذ الخارجي للمعمل والأشعة فقط';end if;
 select * into cur from clinic_reception.order_ext where order_id=p_order;
 if found and cur.status<>'referred' then raise exception 'لا يمكن تعديل طلب بعد جدولته';end if;
 ref:=nullif(trim(p_ext->>'referring_doctor_key'),'');perf:=nullif(trim(p_ext->>'performing_doctor_key'),'');
 if exists(select 1 from clinic_reception.service_performers where service_id=o.service_id)
    and not exists(select 1 from clinic_reception.service_performers where service_id=o.service_id and doctor_key=perf) then
   raise exception 'الطبيب غير مصرح له بتنفيذ هذه الخدمة';end if;
 cat:=case kind when 'radiology' then 'radiology' when 'lab' then 'lab' else coalesce(nullif(p_ext->>'category',''),'consult') end;
 if cat not in ('consult','followup','consultation','radiology','lab','procedure') then raise exception 'تصنيف الخدمة غير صحيح';end if;
 if mode='external' then
   select * into prov from clinic_reception.external_providers where id=nullif(p_ext->>'provider_id','')::uuid and workspace_id=p_workspace and active;
   if not found or prov.kind<>kind then raise exception 'مزوّد الخدمة غير صحيح';end if;
 end if;
 net:=round(o.quantity*o.price*(1-o.discount/100.0),2);
 if kind in ('service','radiology','lab') and ref is not null then
   select percent into rate from clinic_reception.referral_rates where workspace_id=p_workspace and doctor_key=ref and category=cat
     and valid_from<=current_date and (valid_to is null or valid_to>=current_date) order by valid_from desc limit 1;
   commission:=round(net*coalesce(rate,0)/100,2);
 end if;
 if mode='external' and kind='lab' then
   if bp='provider' then raise exception 'محاسبة المعمل عبر المزوّد غير مدعومة';end if;
   select c.cost into cost from clinic_reception.provider_cost_list c where provider_id=prov.id and service_id=o.service_id
     and year=extract(year from current_date)::int;
   if cost is null then raise exception 'سعر تكلفة المعمل غير مسجل لهذا العام';end if;
   payable:=round(cost*o.quantity,2);
 elsif mode='external' and kind='radiology' then
   if bp='center' then
     if prov.terms->>'providerSharePercent' is null then raise exception 'نسبة المزوّد غير مسجلة';end if;
     share:=(prov.terms->>'providerSharePercent')::numeric;
     if share<0 or share>100 then raise exception 'نسبة المزوّد غير صحيحة';end if;
     payable:=round(net*share/100,2);
   else
     if prov.terms->>'centerSharePercent' is null then raise exception 'نسبة المركز غير مسجلة';end if;
     share:=(prov.terms->>'centerSharePercent')::numeric;
     if share<0 or share>100 then raise exception 'نسبة المركز غير صحيحة';end if;
     receivable:=round(net*share/100,2);
   end if;
 end if;
 priced:=jsonb_build_object('net',net,'category',cat,'referral_rate',coalesce(rate,0),'referral_commission',commission,
   'provider_payable',payable,'center_receivable',receivable);
 insert into clinic_reception.order_ext(order_id,kind,mode,billing_party,referring_doctor_key,performing_doctor_key,external_provider_id,priced)
 values(p_order,kind,mode,bp,ref,perf,prov.id,priced)
 on conflict(order_id) do update set kind=excluded.kind,mode=excluded.mode,billing_party=excluded.billing_party,
   referring_doctor_key=excluded.referring_doctor_key,performing_doctor_key=excluded.performing_doctor_key,
   external_provider_id=excluded.external_provider_id,priced=excluded.priced;
 return jsonb_build_object('order_id',p_order,'priced',priced);
end $function$;
commit;
