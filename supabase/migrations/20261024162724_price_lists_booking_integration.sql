begin;
alter table clinic_reception.services add column pricing_evidence jsonb not null default '{}';
CREATE OR REPLACE FUNCTION clinic_reception.sync_catalog(p_workspace uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare x record;l jsonb;ss public.pricing_supplies%rowtype;it public.inventory_items%rowtype;sid uuid;version_no integer;finger text;cfg jsonb;price numeric;bom jsonb;lines jsonb;service clinic_reception.services%rowtype;quantity numeric;max_visit integer;price_evidence jsonb;
begin
 -- Same lock order as booking commands, before touching shared native mappings.
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 perform clinic_reception.sync_native_links(p_workspace);
 if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then return;end if;
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
  price_evidence:=clinic_prices.resolve(x.id,price,clinic_reception.today());price:=(price_evidence->>'price')::numeric;
  cfg:=jsonb_build_object('pricing',price_evidence,'code',x.booking_code,'name',x.name,'department',x.booking_department,'minutes',x.booking_minutes,'requires_device',x.booking_requires_device,'price',price,'bom',bom);finger:=md5(cfg::text);
  if exists(select 1 from clinic_reception.services where workspace_id=p_workspace and pricing_service_id=x.id and source_fingerprint=finger and active) then continue;end if;
  update clinic_reception.services set active=false where workspace_id=p_workspace and (pricing_service_id=x.id or code=x.booking_code);
  select coalesce(max(version),0)+1 into version_no from clinic_reception.services where workspace_id=p_workspace and code=x.booking_code;
  insert into clinic_reception.services(workspace_id,code,name,version,department,minutes,requires_device,price,bom,pricing_service_id,source_fingerprint,pricing_evidence) values(p_workspace,x.booking_code,x.name,version_no,x.booking_department,x.booking_minutes,x.booking_requires_device,price,bom,x.id,finger,price_evidence);
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
   cfg:=clinic_prices.resolve(service.pricing_service_id,service.price,clinic_reception.today(),x.id);
   finger:=md5(jsonb_build_array(cfg,x.id,service.id,service.price,x.discount_percent,x.booking_billing_kind,x.booking_coverage,x.start_date,x.end_date,x.terms_notes,x.cashback_percent)::text);
   if exists(select 1 from clinic_reception.entity_contracts where workspace_id=p_workspace and external_contract_id=x.id and service_code=service.code and source_fingerprint=finger and status='active') then continue;end if;
   update clinic_reception.entity_contracts set status='rejected' where workspace_id=p_workspace and external_contract_id=x.id and service_code=service.code;
   insert into clinic_reception.entity_contracts(workspace_id,entity_id,service_code,price,coverage,valid_from,valid_to,reference,terms,status,created_by,external_contract_id,source_fingerprint,source_terms)
   values(p_workspace,sid,service.code,(cfg->>'price')::numeric,case when x.booking_billing_kind='insurer' then x.booking_coverage else 0 end,x.start_date,coalesce(x.end_date,'9999-12-31'),coalesce(x.contract_number,x.id::text),coalesce(x.terms_notes,''),'active',x.created_by,x.id,finger,jsonb_build_object('cashback_percent',coalesce(x.cashback_percent,0),'pricing',cfg));
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
end $function$
;
revoke all on function clinic_reception.sync_catalog(uuid) from public,anon,authenticated;
create function clinic_prices.guard_order_discount() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare allowed boolean;begin
 if new.discount>0 and (tg_op='INSERT' or new.discount is distinct from old.discount) then
  allowed:=coalesce((new.snapshot#>>'{pricing_evidence,list_terms,allow_extra_discount}')::boolean,true);
  if exists(select 1 from clinic_reception.order_quotes q where q.order_id=new.id and coalesce((q.snapshot#>>'{source_terms,pricing,list_terms,allow_extra_discount}')::boolean,true)=false) then allowed:=false;end if;
  if not allowed then raise exception 'اللائحة لا تسمح بخصم إضافي؛ راجع العقد أو أنشئ إصدارًا معتمدًا';end if;
 end if;return new;
end $$;
create trigger price_list_discount_guard before insert or update on clinic_reception.orders for each row execute function clinic_prices.guard_order_discount();
revoke all on function clinic_prices.guard_order_discount() from public,anon,authenticated;
commit;
