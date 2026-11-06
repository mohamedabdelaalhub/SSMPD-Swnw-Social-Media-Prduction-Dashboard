-- ADDITIVE ONLY (functions). Setup screens backend. 'manage' access; every change audited.
begin;

create or replace function public.clinic_reception_so_setup_load(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'manage');
begin
 return jsonb_build_object(
  'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'code',s.code,'department',s.department) order by s.name)
     from clinic_reception.services s where s.workspace_id=p_workspace and s.active),'[]'::jsonb),
  'doctors',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'doctor_key',d.doctor_key) order by d.name)
     from clinic_reception.providers d where d.workspace_id=p_workspace and d.doctor_key is not null and d.active),'[]'::jsonb),
  'service_specialties',coalesce((select jsonb_agg(jsonb_build_object('service_id',x.service_id,'specialty_id',x.specialty_id))
     from clinic_reception.service_specialties x join clinic_reception.services s on s.id=x.service_id where s.workspace_id=p_workspace),'[]'::jsonb),
  'performers',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'service_id',x.service_id,'doctor_key',x.doctor_key,'specialty_id',x.specialty_id))
     from clinic_reception.service_performers x join clinic_reception.services s on s.id=x.service_id where s.workspace_id=p_workspace),'[]'::jsonb),
  'referral_rates',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'doctor_key',r.doctor_key,'category',r.category,'percent',r.percent,'valid_from',r.valid_from,'valid_to',r.valid_to) order by r.doctor_key,r.category,r.valid_from desc)
     from clinic_reception.referral_rates r where r.workspace_id=p_workspace),'[]'::jsonb),
  'providers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'kind',e.kind,'phone',e.phone,'terms',e.terms,'active',e.active) order by e.name)
     from clinic_reception.external_providers e where e.workspace_id=p_workspace),'[]'::jsonb),
  'costs',coalesce((select jsonb_agg(jsonb_build_object('provider_id',c.provider_id,'service_id',c.service_id,'year',c.year,'cost',c.cost))
     from clinic_reception.provider_cost_list c join clinic_reception.external_providers e on e.id=c.provider_id where e.workspace_id=p_workspace),'[]'::jsonb));
end $$;

create or replace function public.clinic_reception_so_setup_save(p_workspace uuid,p_kind text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'manage');
 op text:=coalesce(p_payload->>'op','set'); sid uuid; pid uuid; rid uuid; pct numeric; spec text; dk text; vf date; terms jsonb; k text; yr int; cst numeric;
begin
 if op not in ('set','add','remove') then raise exception 'عملية غير صحيحة';end if;
 if p_kind='service_specialty' then
   sid:=(p_payload->>'service_id')::uuid; spec:=nullif(trim(p_payload->>'specialty_id'),'');
   if not exists(select 1 from clinic_reception.services where id=sid and workspace_id=p_workspace) then raise exception 'الخدمة غير موجودة';end if;
   if spec is null or length(spec)>80 then raise exception 'التخصص مطلوب';end if;
   if op='remove' then delete from clinic_reception.service_specialties where service_id=sid and specialty_id=spec;
   else insert into clinic_reception.service_specialties(service_id,specialty_id) values(sid,spec) on conflict do nothing;end if;
   rid:=sid;
 elsif p_kind='performer' then
   sid:=(p_payload->>'service_id')::uuid; dk:=nullif(trim(p_payload->>'doctor_key'),''); spec:=nullif(trim(p_payload->>'specialty_id'),'');
   if not exists(select 1 from clinic_reception.services where id=sid and workspace_id=p_workspace) then raise exception 'الخدمة غير موجودة';end if;
   if (dk is null)=(spec is null) then raise exception 'اختر طبيبًا أو تخصصًا (واحد فقط)';end if;
   if dk is not null and not exists(select 1 from clinic_reception.providers where workspace_id=p_workspace and doctor_key=dk) then raise exception 'الطبيب غير موجود';end if;
   if op='remove' then delete from clinic_reception.service_performers where service_id=sid and doctor_key is not distinct from dk and specialty_id is not distinct from spec;
   elsif not exists(select 1 from clinic_reception.service_performers where service_id=sid and doctor_key is not distinct from dk and specialty_id is not distinct from spec) then
     insert into clinic_reception.service_performers(service_id,doctor_key,specialty_id) values(sid,dk,spec);end if;
   rid:=sid;
 elsif p_kind='referral_rate' then
   if op='remove' then
     delete from clinic_reception.referral_rates where id=(p_payload->>'id')::uuid and workspace_id=p_workspace;
     if not found then raise exception 'النسبة غير موجودة';end if;
     rid:=(p_payload->>'id')::uuid;
   else
     dk:=nullif(trim(p_payload->>'doctor_key'),''); k:=p_payload->>'category'; pct:=(p_payload->>'percent')::numeric;
     vf:=coalesce(nullif(p_payload->>'valid_from','')::date,current_date);
     if not exists(select 1 from clinic_reception.providers where workspace_id=p_workspace and doctor_key=dk) then raise exception 'الطبيب غير موجود';end if;
     if k not in ('consult','followup','consultation','radiology','lab','procedure') then raise exception 'تصنيف غير صحيح';end if;
     if pct is null or pct<0 or pct>100 then raise exception 'النسبة بين 0 و100';end if;
     update clinic_reception.referral_rates set valid_to=vf-1 where workspace_id=p_workspace and doctor_key=dk and category=k and valid_to is null and valid_from<vf;
     insert into clinic_reception.referral_rates(workspace_id,doctor_key,category,percent,valid_from) values(p_workspace,dk,k,pct,vf)
       on conflict(workspace_id,doctor_key,category,valid_from) do update set percent=excluded.percent,valid_to=null returning id into rid;
   end if;
 elsif p_kind='provider' then
   k:=p_payload->>'kind'; terms:=coalesce(p_payload->'terms','{}'::jsonb);
   if k not in ('lab','radiology') then raise exception 'نوع المزوّد غير صحيح';end if;
   if nullif(trim(p_payload->>'name'),'') is null then raise exception 'اسم المزوّد مطلوب';end if;
   if jsonb_typeof(terms)<>'object' then raise exception 'الشروط غير صحيحة';end if;
   for spec in select jsonb_object_keys(terms) loop
     if spec not in ('providerSharePercent','centerSharePercent') then raise exception 'شرط غير معروف';end if;
     pct:=(terms->>spec)::numeric; if pct<0 or pct>100 then raise exception 'النسبة بين 0 و100';end if;
   end loop;
   if p_payload->>'id' is null then
     insert into clinic_reception.external_providers(workspace_id,name,kind,phone,terms,active)
       values(p_workspace,trim(p_payload->>'name'),k,nullif(trim(p_payload->>'phone'),''),terms,coalesce((p_payload->>'active')::boolean,true)) returning id into rid;
   else
     update clinic_reception.external_providers set name=trim(p_payload->>'name'),kind=k,phone=nullif(trim(p_payload->>'phone'),''),terms=terms,
       active=coalesce((p_payload->>'active')::boolean,active) where id=(p_payload->>'id')::uuid and workspace_id=p_workspace returning id into rid;
     if rid is null then raise exception 'المزوّد غير موجود';end if;
   end if;
 elsif p_kind='cost' then
   pid:=(p_payload->>'provider_id')::uuid; sid:=(p_payload->>'service_id')::uuid; yr:=coalesce((p_payload->>'year')::int,extract(year from current_date)::int);
   if not exists(select 1 from clinic_reception.external_providers where id=pid and workspace_id=p_workspace and kind='lab') then raise exception 'المعمل غير موجود';end if;
   if not exists(select 1 from clinic_reception.services where id=sid and workspace_id=p_workspace) then raise exception 'الخدمة غير موجودة';end if;
   if op='remove' then delete from clinic_reception.provider_cost_list where provider_id=pid and service_id=sid and year=yr;
   else
     cst:=(p_payload->>'cost')::numeric; if cst is null or cst<0 then raise exception 'التكلفة غير صحيحة';end if;
     insert into clinic_reception.provider_cost_list(provider_id,service_id,year,cost) values(pid,sid,yr,cst)
       on conflict(provider_id,service_id,year) do update set cost=excluded.cost;
   end if;
   rid:=pid;
 else raise exception 'نوع الإعداد غير معروف';end if;
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail)
   values(p_workspace,me,'so_setup_'||p_kind||'_'||op,rid,p_payload);
 return jsonb_build_object('kind',p_kind,'op',op,'id',rid);
end $$;

revoke all on function public.clinic_reception_so_setup_load(uuid),public.clinic_reception_so_setup_save(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.clinic_reception_so_setup_load(uuid),public.clinic_reception_so_setup_save(uuid,text,jsonb) to authenticated;
commit;
