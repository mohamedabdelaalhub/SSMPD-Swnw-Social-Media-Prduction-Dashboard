-- ADDITIVE ONLY (functions). Review file; applied after local rehearsal + backup note.
-- All functions: security definer, access checked through clinic_reception.access(), no direct table grants.
begin;

create or replace function public.clinic_reception_so_catalog(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'view');
begin
 return jsonb_build_object(
  'service_specialties',coalesce((select jsonb_agg(jsonb_build_object('service_id',s.service_id,'specialty_id',s.specialty_id))
     from clinic_reception.service_specialties s join clinic_reception.services v on v.id=s.service_id where v.workspace_id=p_workspace),'[]'::jsonb),
  'performers',coalesce((select jsonb_agg(jsonb_build_object('service_id',p.service_id,'doctor_key',p.doctor_key,'specialty_id',p.specialty_id))
     from clinic_reception.service_performers p join clinic_reception.services v on v.id=p.service_id where v.workspace_id=p_workspace),'[]'::jsonb),
  'referral_rates',coalesce((select jsonb_agg(jsonb_build_object('doctor_key',r.doctor_key,'category',r.category,'percent',r.percent))
     from clinic_reception.referral_rates r where r.workspace_id=p_workspace and r.valid_from<=current_date and (r.valid_to is null or r.valid_to>=current_date)),'[]'::jsonb),
  'providers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'kind',e.kind,'phone',e.phone))
     from clinic_reception.external_providers e where e.workspace_id=p_workspace and e.active),'[]'::jsonb));
end $$;

create or replace function public.clinic_reception_so_attach(p_workspace uuid,p_order uuid,p_ext jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
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
end $$;

create or replace function public.clinic_reception_so_set_status(p_workspace uuid,p_order uuid,p_to text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'execute');
begin
 if p_to='report_uploaded' then raise exception 'استخدم رفع التقرير';end if;
 update clinic_reception.order_ext x set status=p_to
  where x.order_id=p_order and exists(select 1 from clinic_reception.orders o where o.id=x.order_id and o.workspace_id=p_workspace);
 if not found then raise exception 'الطلب غير موجود';end if;
 return jsonb_build_object('order_id',p_order,'status',p_to);
end $$;

create or replace function public.clinic_reception_so_attach_report(p_workspace uuid,p_order uuid,p_file_ref text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'execute');
begin
 if p_file_ref is null or length(p_file_ref)>300 or p_file_ref like '/%' or p_file_ref like '%..%' or p_file_ref ~ '[\x00-\x1f]' then
   raise exception 'مرجع الملف غير صحيح';end if;
 update clinic_reception.order_ext x set report_file_ref=p_file_ref,status='report_uploaded'
  where x.order_id=p_order and x.status='done'
    and exists(select 1 from clinic_reception.orders o where o.id=x.order_id and o.workspace_id=p_workspace);
 if not found then raise exception 'التقرير يُرفع بعد اكتمال التنفيذ فقط';end if;
 return jsonb_build_object('order_id',p_order,'status','report_uploaded');
end $$;

-- Minimum data only: patient name + phone, service name, status. No prices, no commissions.
create or replace function public.clinic_reception_so_provider_board(p_workspace uuid,p_provider uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'view');
begin
 return coalesce((select jsonb_agg(jsonb_build_object('order_id',x.order_id,'provider',e.name,'status',x.status,'status_at',x.status_at,
     'service',o.snapshot->>'name','patient_name',p.name,'phone',p.phone) order by x.status_at desc)
   from clinic_reception.order_ext x
   join clinic_reception.orders o on o.id=x.order_id and o.workspace_id=p_workspace
   join clinic_reception.external_providers e on e.id=x.external_provider_id
   join clinic_reception.visits v on v.id=o.visit_id
   join clinic_reception.patients p on p.id=v.patient_id
   where x.mode='external' and (p_provider is null or x.external_provider_id=p_provider)),'[]'::jsonb);
end $$;

revoke all on function public.clinic_reception_so_catalog(uuid),public.clinic_reception_so_attach(uuid,uuid,jsonb),
 public.clinic_reception_so_set_status(uuid,uuid,text),public.clinic_reception_so_attach_report(uuid,uuid,text),
 public.clinic_reception_so_provider_board(uuid,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_so_catalog(uuid),public.clinic_reception_so_attach(uuid,uuid,jsonb),
 public.clinic_reception_so_set_status(uuid,uuid,text),public.clinic_reception_so_attach_report(uuid,uuid,text),
 public.clinic_reception_so_provider_board(uuid,uuid) to authenticated;
commit;
