-- Bad native setup disables only its source service/package; unrelated reception remains available.
create table clinic_reception.catalog_issues(workspace_id uuid not null references clinic_reception.workspaces(id),kind text not null check(kind in ('services','packages','contracts')),source_id uuid not null,name text not null,detail text not null,primary key(workspace_id,kind,source_id));
alter table clinic_reception.catalog_issues enable row level security;
revoke all on clinic_reception.catalog_issues from public,anon,authenticated;
create or replace function clinic_reception.sync_catalog(p_workspace uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x record;l jsonb;ss public.pricing_supplies%rowtype;it public.inventory_items%rowtype;sid uuid;version_no integer;finger text;cfg jsonb;price numeric;bom jsonb;lines jsonb;service clinic_reception.services%rowtype;quantity numeric;max_visit integer;
begin
 perform clinic_reception.sync_native_links(p_workspace);
 if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then return;end if;
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 delete from clinic_reception.catalog_issues where workspace_id=p_workspace;
 -- Disabled/deleted native services cannot be sold again; existing order snapshots stay unchanged.
 update clinic_reception.services r set active=false where r.workspace_id=p_workspace and (r.pricing_service_id is null or not exists(select 1 from public.pricing_services s where s.id=r.pricing_service_id and s.active and s.booking_enabled));
 for x in select * from public.pricing_services where active and booking_enabled order by id loop
 begin
  if length(trim(coalesce(x.booking_code,'')))<2 or length(trim(coalesce(x.booking_department,'')))<2 or x.booking_minutes is null then raise exception 'أكمل إعداد الحجز للخدمة % داخل التسعير',x.name;end if;
  price:=x.base_price;bom:='[]';
  for l in select * from jsonb_array_elements(coalesce(x.supplies_used,'[]')) loop
   select * into ss from public.pricing_supplies where id=(l->>'supply_id')::uuid and active;
   if not found or ss.inventory_item_id is null or ss.inventory_quantity_per_unit is null or ss.units_per_package<=0 then raise exception 'اربط مستلزم % بالصنف ووحدة المخزن من نموذج التسعير',coalesce(ss.name,l->>'supply_id');end if;
   select * into it from public.inventory_items where id=ss.inventory_item_id and active;if not found then raise exception 'صنف المستلزم غير متاح';end if;
   quantity:=clinic_reception.number(l->>'quantity',3);price:=price+quantity*ss.package_price/ss.units_per_package;
   select id into sid from clinic_reception.items where workspace_id=p_workspace and inventory_item_id=it.id;
   bom:=bom||jsonb_build_array(jsonb_build_object('item_id',sid,'quantity',quantity*ss.inventory_quantity_per_unit,'included',true));
  end loop;
  price:=round(price*(1+x.profit_margin_percent/100),2);
  cfg:=jsonb_build_object('code',x.booking_code,'name',x.name,'department',x.booking_department,'minutes',x.booking_minutes,'requires_device',x.booking_requires_device,'price',price,'bom',bom);finger:=md5(cfg::text);
  if exists(select 1 from clinic_reception.services where workspace_id=p_workspace and pricing_service_id=x.id and source_fingerprint=finger and active) then continue;end if;
  update clinic_reception.services set active=false where workspace_id=p_workspace and (pricing_service_id=x.id or code=x.booking_code);
  select coalesce(max(version),0)+1 into version_no from clinic_reception.services where workspace_id=p_workspace and code=x.booking_code;
  insert into clinic_reception.services(workspace_id,code,name,version,department,minutes,requires_device,price,bom,pricing_service_id,source_fingerprint) values(p_workspace,x.booking_code,x.name,version_no,x.booking_department,x.booking_minutes,x.booking_requires_device,price,bom,x.id,finger);
 exception when raise_exception or invalid_text_representation or invalid_parameter_value or division_by_zero or numeric_value_out_of_range or check_violation or not_null_violation then
  update clinic_reception.services set active=false where workspace_id=p_workspace and pricing_service_id=x.id;
  insert into clinic_reception.catalog_issues(workspace_id,kind,source_id,name,detail) values(p_workspace,'services',x.id,x.name,sqlerrm);
 end;
 end loop;
 -- Structured service selection is configured in the existing entity contract. Never parse free-text services.
 update clinic_reception.entity_contracts r set status='rejected' where r.workspace_id=p_workspace and r.external_contract_id is not null and not exists(select 1 from public.contracting_entity_contracts c where c.id=r.external_contract_id and c.status='active' and clinic_reception.today() between c.start_date and coalesce(c.end_date,'9999-12-31'));
 for x in select c.*,e.name entity_name from public.contracting_entity_contracts c join public.contracting_entities e on e.id=c.entity_id where c.status='active' and cardinality(c.booking_service_ids)>0 and clinic_reception.today() between c.start_date and coalesce(c.end_date,'9999-12-31') loop
 begin
  select id into sid from clinic_reception.entities where workspace_id=p_workspace and contracting_entity_id=x.entity_id and kind=x.booking_billing_kind;
  if sid is null then insert into clinic_reception.entities(workspace_id,name,kind,contracting_entity_id) values(p_workspace,x.entity_name,x.booking_billing_kind,x.entity_id) returning id into sid;end if;
  for service in select * from clinic_reception.services where workspace_id=p_workspace and active and pricing_service_id=any(x.booking_service_ids) loop
   if service.price<=0 then raise exception 'راجع سعر الخدمة في عقد الجهة';end if;
   finger:=md5(jsonb_build_array(x.id,service.id,service.price,x.discount_percent,x.booking_billing_kind,x.booking_coverage,x.start_date,x.end_date,x.terms_notes,x.cashback_percent)::text);
   if exists(select 1 from clinic_reception.entity_contracts where workspace_id=p_workspace and external_contract_id=x.id and service_code=service.code and source_fingerprint=finger and status='active') then continue;end if;
   update clinic_reception.entity_contracts set status='rejected' where workspace_id=p_workspace and external_contract_id=x.id and service_code=service.code;
   insert into clinic_reception.entity_contracts(workspace_id,entity_id,service_code,price,coverage,valid_from,valid_to,reference,terms,status,created_by,external_contract_id,source_fingerprint,source_terms)
   values(p_workspace,sid,service.code,round(service.price*(1-coalesce(x.discount_percent,0)/100),2),case when x.booking_billing_kind='insurer' then x.booking_coverage else 0 end,x.start_date,coalesce(x.end_date,'9999-12-31'),coalesce(x.contract_number,x.id::text),coalesce(x.terms_notes,''),'active',x.created_by,x.id,finger,jsonb_build_object('cashback_percent',coalesce(x.cashback_percent,0)));
  end loop;
 exception when raise_exception or invalid_text_representation or invalid_parameter_value or division_by_zero or numeric_value_out_of_range or check_violation or not_null_violation then
  update clinic_reception.entity_contracts set status='rejected' where workspace_id=p_workspace and external_contract_id=x.id;
  insert into clinic_reception.catalog_issues(workspace_id,kind,source_id,name,detail) values(p_workspace,'contracts',x.id,x.entity_name,sqlerrm);
 end;
 end loop;
 update clinic_reception.package_templates r set active=false where r.workspace_id=p_workspace and (r.pricing_package_id is null or not exists(select 1 from public.pricing_packages p where p.id=r.pricing_package_id and p.active and p.booking_enabled));
 for x in select * from public.pricing_packages where active and booking_enabled order by id loop
 begin
  if x.booking_visits is null or x.booking_validity_days is null or length(trim(coalesce(x.booking_terms,'')))<3 then raise exception 'أكمل زيارات وصلاحية وشروط الباكج % في التسعير',x.name;end if;
  lines:='[]';price:=0;max_visit:=0;
  for l in select * from jsonb_array_elements(coalesce(x.services_included,'[]')) loop
   select * into service from clinic_reception.services where workspace_id=p_workspace and pricing_service_id=(l->>'service_id')::uuid and active;
   if not found or service.price<=0 then raise exception 'فعّل الخدمة بسعر مستقل موجب قبل الباكج %',x.name;end if;
   if nullif(l->>'visit_no','') is null or (l->>'visit_no')::integer not between 1 and x.booking_visits then raise exception 'حدد رقم الزيارة لكل خدمة داخل الباكج %',x.name;end if;
   quantity:=clinic_reception.number(l->>'quantity',3);price:=price+service.price*quantity;max_visit:=greatest(max_visit,(l->>'visit_no')::integer);
   lines:=lines||jsonb_build_array(jsonb_build_object('visit_no',(l->>'visit_no')::integer,'service_id',service.id,'quantity',quantity,'standalone_price',service.price,'snapshot',to_jsonb(service)));
  end loop;
  if price<=0 or max_visit<>x.booking_visits or (select count(distinct (l2->>'visit_no')::integer) from jsonb_array_elements(lines) l2)<>x.booking_visits then raise exception 'حدد خدمات كل زيارة في الباكج %',x.name;end if;
  price:=round(price*(1+x.profit_margin_percent/100),2);finger:=md5(jsonb_build_array(x.name,price,x.booking_visits,x.booking_validity_days,x.booking_terms,lines)::text);
  if exists(select 1 from clinic_reception.package_templates where workspace_id=p_workspace and pricing_package_id=x.id and source_fingerprint=finger and active) then continue;end if;
  update clinic_reception.package_templates set active=false where workspace_id=p_workspace and pricing_package_id=x.id;
  select coalesce(max(version),0)+1 into version_no from clinic_reception.package_templates where workspace_id=p_workspace and code='PKG-'||x.id;
  insert into clinic_reception.package_templates(workspace_id,code,name,version,price,visits,validity_days,terms,pricing_package_id,source_fingerprint) values(p_workspace,'PKG-'||x.id,x.name,version_no,price,x.booking_visits,x.booking_validity_days,x.booking_terms,x.id,finger) returning id into sid;
  insert into clinic_reception.template_lines(template_id,visit_no,service_id,quantity,standalone_price,service_snapshot) select sid,(j->>'visit_no')::integer,(j->>'service_id')::uuid,(j->>'quantity')::numeric,(j->>'standalone_price')::numeric,j->'snapshot' from jsonb_array_elements(lines)j;
 exception when raise_exception or invalid_text_representation or invalid_parameter_value or division_by_zero or numeric_value_out_of_range or check_violation or not_null_violation then
  update clinic_reception.package_templates set active=false where workspace_id=p_workspace and pricing_package_id=x.id;
  insert into clinic_reception.catalog_issues(workspace_id,kind,source_id,name,detail) values(p_workspace,'packages',x.id,x.name,sqlerrm);
 end;
 end loop;
end $$;

revoke all on function clinic_reception.sync_catalog(uuid) from public,anon,authenticated;
alter function public.clinic_reception_snapshot(uuid,date,date) rename to snapshot_before_catalog_readiness;
alter function public.snapshot_before_catalog_readiness(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_catalog_readiness(uuid,date,date) from public,anon,authenticated;
create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare v jsonb;begin
 perform clinic_reception.access(p_workspace,'view');v:=clinic_reception.snapshot_before_catalog_readiness(p_workspace,p_from,p_to);
 return v||jsonb_build_object('catalog_unavailable',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',name,'status','not_ready') order by kind,name),'[]') from clinic_reception.catalog_issues where workspace_id=p_workspace));
end $$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;
create function public.clinic_reception_catalog_issues() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare w jsonb;ids uuid[]:=array[]::uuid[];begin
 if not clinic_finance.allowed('view') then raise exception 'هذا الإعداد لمسؤول الحسابات والمخازن' using errcode='42501';end if;
 for w in select * from jsonb_array_elements(public.clinic_reception_workspaces()) loop
  if w->>'mode'<>'live' then continue;end if;
  perform clinic_reception.access((w->>'id')::uuid,'view');perform clinic_reception.sync_catalog((w->>'id')::uuid);ids:=array_append(ids,(w->>'id')::uuid);
 end loop;
 return(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'source_id',source_id,'name',name,'detail',detail) order by kind,name),'[]') from clinic_reception.catalog_issues where workspace_id=any(ids));
end $$;
revoke all on function public.clinic_reception_catalog_issues() from public,anon,authenticated;
grant execute on function public.clinic_reception_catalog_issues() to authenticated;
