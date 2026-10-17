-- Extend the existing pricing forms; operational versions are immutable evidence, never a second editable catalog.
alter table public.pricing_services add column booking_enabled boolean not null default false,add column booking_code text,add column booking_department text,add column booking_minutes integer check(booking_minutes between 5 and 480),add column booking_requires_device boolean not null default false;
create unique index pricing_services_booking_code on public.pricing_services(booking_code) where booking_code is not null;
alter table public.pricing_supplies add column inventory_item_id uuid references public.inventory_items(id),add column inventory_quantity_per_unit numeric(14,4) check(inventory_quantity_per_unit>0);
alter table public.pricing_packages add column booking_enabled boolean not null default false,add column booking_visits integer check(booking_visits between 1 and 365),add column booking_validity_days integer check(booking_validity_days between 1 and 3650),add column booking_terms text;
alter table public.contracting_entity_contracts add column booking_service_ids uuid[] not null default '{}',add column booking_billing_kind text not null default 'discount' check(booking_billing_kind in ('discount','insurer','referral')),add column booking_coverage numeric(5,2) not null default 0 check(booking_coverage between 0 and 100);
alter table clinic_reception.services add column source_fingerprint text;
alter table clinic_reception.package_templates add column pricing_package_id uuid references public.pricing_packages(id),add column source_fingerprint text;
alter table clinic_reception.entity_contracts add column source_fingerprint text,add column source_terms jsonb not null default '{}';
create index reception_service_pricing_version on clinic_reception.services(workspace_id,pricing_service_id,version desc);
create index reception_package_pricing_version on clinic_reception.package_templates(workspace_id,pricing_package_id,version desc);
create function clinic_reception.sync_native_links(p_workspace uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then return;end if;
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 update clinic_reception.patients r set file_no=p.patient_code,name=p.full_name,phone=coalesce(p.phone,''),gender=p.gender from public.patients p where r.workspace_id=p_workspace and r.patient_id=p.id;
 update clinic_reception.items r set name=i.name,unit=i.base_unit,markup=i.markup_percent,track_expiry=i.track_lots from public.inventory_items i where r.workspace_id=p_workspace and r.inventory_item_id=i.id;
 -- Shared native identities. No name matching, no opening quantities, no financial posting.
 insert into clinic_reception.items(workspace_id,code,name,unit,markup,inventory_item_id,track_expiry)
 select p_workspace,'INV-'||i.id,i.name,i.base_unit,i.markup_percent,i.id,i.track_lots from public.inventory_items i where i.active and not exists(select 1 from clinic_reception.items mapped where mapped.workspace_id=p_workspace and mapped.inventory_item_id=i.id)
 on conflict(workspace_id,code) do update set name=excluded.name,unit=excluded.unit,markup=excluded.markup,track_expiry=excluded.track_expiry;
 insert into clinic_reception.locations(workspace_id,name,inventory_location_id) select p_workspace,l.name,l.id from public.inventory_locations l where l.active and not exists(select 1 from clinic_reception.locations r where r.workspace_id=p_workspace and r.inventory_location_id=l.id);
 insert into clinic_reception.suppliers(workspace_id,name,inventory_supplier_id) select p_workspace,s.name,s.id from public.inventory_suppliers s where s.active and not exists(select 1 from clinic_reception.suppliers r where r.workspace_id=p_workspace and r.inventory_supplier_id=s.id);
 insert into clinic_reception.registers(workspace_id,name,direction,finance_register_id) select p_workspace,r.name,r.operation_mode,r.id from clinic_finance.registers r where not exists(select 1 from clinic_reception.registers mapped where mapped.workspace_id=p_workspace and mapped.finance_register_id=r.id);
 update clinic_reception.registers mapped set name=r.name,direction=r.operation_mode from clinic_finance.registers r where mapped.workspace_id=p_workspace and mapped.finance_register_id=r.id;
 update clinic_reception.shifts mapped set status=f.status,closed_at=f.closed_at,counted=f.counted,reviewed_by=f.reviewed_by,review_note=f.review_note,
 expected=clinic_finance.shift_cash(f.id),
 difference=f.counted-clinic_finance.shift_cash(f.id)
 from clinic_finance.shifts f where mapped.workspace_id=p_workspace and mapped.finance_shift_id=f.id;
 insert into clinic_reception.shifts(id,workspace_id,register_id,cashier_id,status,opened_at,closed_at,counted,finance_shift_id)
 select f.id,p_workspace,r.id,f.cashier_id,f.status,f.opened_at,f.closed_at,f.counted,f.id from clinic_finance.shifts f join clinic_reception.registers r on r.finance_register_id=f.register_id and r.workspace_id=p_workspace
 where not exists(select 1 from clinic_reception.shifts mapped where mapped.workspace_id=p_workspace and mapped.finance_shift_id=f.id)
 on conflict(id) do nothing;
end $$;
create function clinic_reception.sync_catalog(p_workspace uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x record;l jsonb;ss public.pricing_supplies%rowtype;it public.inventory_items%rowtype;sid uuid;version_no integer;finger text;cfg jsonb;price numeric;bom jsonb;lines jsonb;service clinic_reception.services%rowtype;quantity numeric;max_visit integer;
begin
 perform clinic_reception.sync_native_links(p_workspace);
 if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then return;end if;
 -- Disabled/deleted native services cannot be sold again; existing order snapshots stay unchanged.
 update clinic_reception.services r set active=false where r.workspace_id=p_workspace and (r.pricing_service_id is null or not exists(select 1 from public.pricing_services s where s.id=r.pricing_service_id and s.active and s.booking_enabled));
 for x in select * from public.pricing_services where active and booking_enabled order by id loop
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
 end loop;
 -- Structured service selection is configured in the existing entity contract. Never parse free-text services.
 update clinic_reception.entity_contracts r set status='rejected' where r.workspace_id=p_workspace and r.external_contract_id is not null and not exists(select 1 from public.contracting_entity_contracts c where c.id=r.external_contract_id and c.status='active' and clinic_reception.today() between c.start_date and coalesce(c.end_date,'9999-12-31'));
 for x in select c.*,e.name entity_name from public.contracting_entity_contracts c join public.contracting_entities e on e.id=c.entity_id where c.status='active' and cardinality(c.booking_service_ids)>0 and clinic_reception.today() between c.start_date and coalesce(c.end_date,'9999-12-31') loop
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
 end loop;
 update clinic_reception.package_templates r set active=false where r.workspace_id=p_workspace and (r.pricing_package_id is null or not exists(select 1 from public.pricing_packages p where p.id=r.pricing_package_id and p.active and p.booking_enabled));
 for x in select * from public.pricing_packages where active and booking_enabled order by id loop
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
 end loop;
end $$;
-- Use the active approved finance contract at execution; never ask reception to recreate or approve it.
create function clinic_reception.sync_doctor_contract(p_workspace uuid,p_order uuid,p_provider uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o clinic_reception.orders%rowtype;p clinic_reception.providers%rowtype;c clinic_finance.doctor_contracts%rowtype;n integer;begin
 select * into o from clinic_reception.orders where workspace_id=p_workspace and id=p_order;
 select * into p from clinic_reception.providers where workspace_id=p_workspace and id=coalesce(p_provider,o.provider_id);
 select count(*) into n from clinic_finance.doctor_contracts where doctor_key=p.doctor_key and service_scope=o.snapshot->>'code' and status='active' and clinic_reception.today() between valid_from and valid_to;
 if n<>1 then raise exception 'حدد عقدًا واحدًا معتمدًا للطبيب والخدمة % داخل الحسابات',o.snapshot->>'code';end if;
 select * into c from clinic_finance.doctor_contracts where doctor_key=p.doctor_key and service_scope=o.snapshot->>'code' and status='active' and clinic_reception.today() between valid_from and valid_to;
 if c.basis<>'performed' or c.base_scope<>'service' or c.deduction not in ('none','cost') then raise exception 'عقد الخدمة بالحسابات يجب أن يستحق عند التنفيذ على الخدمة مع خصم تكلفة المشمول أو بدون خصم';end if;
 if exists(select 1 from clinic_reception.doctor_agreements where workspace_id=p_workspace and provider_id=p.id and service_code=o.snapshot->>'code' and finance_contract_id=c.id and status='active' and rate=c.rate and deduct_material_cost=(c.deduction='cost')) then return;end if;
 update clinic_reception.doctor_agreements set status='rejected' where workspace_id=p_workspace and provider_id=p.id and service_code=o.snapshot->>'code' and status='active';
 insert into clinic_reception.doctor_agreements(workspace_id,provider_id,service_code,rate,deduct_material_cost,valid_from,valid_to,reference,status,created_by,reviewed_by,finance_contract_id)
 values(p_workspace,p.id,o.snapshot->>'code',c.rate,c.deduction='cost',c.valid_from,c.valid_to,c.reference,'active',c.created_by,c.reviewed_by,c.id);
end $$;
alter function public.clinic_reception_command(uuid,text,jsonb,uuid) rename to clinic_reception_command_shared_events;
alter function public.clinic_reception_command_shared_events(uuid,text,jsonb,uuid) set schema clinic_reception;
revoke all on function clinic_reception.clinic_reception_command_shared_events(uuid,text,jsonb,uuid) from public,anon,authenticated;
create function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;live boolean;old clinic_reception.commands%rowtype;result jsonb;begin
 me:=clinic_reception.access(p_workspace,'view');perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 select * into old from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
 if found then if old.action<>p_action or old.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;return old.response;end if;
 select mode='live' into live from clinic_reception.workspaces where id=p_workspace;
 if live then
  if p_action in ('service','template','item','supplier','location','register','agreement','agreement_review','catalog_import','purchase','purchase_review','receive_purchase','transfer_request','transfer_review','transfer_dispatch','transfer_receive','count','count_review','entity','entity_contract','entity_contract_review','shift_open','shift_close','shift_review') then raise exception 'استخدم النموذج الموجود في الحسابات أو المخازن؛ لا يوجد تعريف أو إذن مستقل في الاستقبال';end if;
  if p_action='request' and p_payload->>'kind' in ('doctor_payout','supplier_payout','expense','fund','waste','transfer_loss') then raise exception 'استخدم طلب الصرف أو الإذن الموجود في الحسابات والمخازن';end if;
  perform clinic_reception.sync_native_links(p_workspace);
  if p_action in ('book','order_add','package_sell','quote') then perform clinic_reception.sync_catalog(p_workspace);end if;
  if p_action in ('book','order_add') and not exists(select 1 from clinic_reception.services where workspace_id=p_workspace and id=(p_payload->>'service_id')::uuid and active and pricing_service_id is not null) then raise exception 'الخدمة تغيرت أو غير مفعلة في التسعير؛ حدّث قائمة الخدمات';end if;
  if p_action='quote' and not exists(select 1 from clinic_reception.entity_contracts c join clinic_reception.orders o on o.id=(p_payload->>'order_id')::uuid and o.workspace_id=p_workspace join clinic_reception.visits v on v.id=o.visit_id join clinic_reception.patients p on p.id=v.patient_id join public.contract_patient_links link on link.contract_id=c.external_contract_id and link.patient_id=p.patient_id where c.id=(p_payload->>'contract_id')::uuid and c.workspace_id=p_workspace and clinic_reception.today()>=link.linked_from and (link.linked_until is null or clinic_reception.today()<=link.linked_until)) then raise exception 'اربط المريض بعقد الجهة من نفس نموذج الأرشيف أو التعاقدات قبل اعتماد سعره';end if;
  if p_action='execute' then perform clinic_reception.sync_doctor_contract(p_workspace,(p_payload->>'id')::uuid,nullif(p_payload->>'provider_id','')::uuid);end if;
 end if;
 result:=clinic_reception.clinic_reception_command_shared_events(p_workspace,p_action,p_payload,p_token);
 if live and p_action='visit_close' then update public.leads l set current_status='service_done' from clinic_reception.attributions att join clinic_reception.visits v on v.appointment_id=att.appointment_id where v.id=(p_payload->>'id')::uuid and v.workspace_id=p_workspace and v.status='completed' and att.lead_id=l.id and l.current_status in ('booked','booked_on_system') and exists(select 1 from clinic_reception.orders o where o.visit_id=v.id and o.status='completed');end if;
 if live and p_action='arrive' then
  update public.patient_visits pv set doctor_name=provider.name,specialty=service.department
  from clinic_reception.visits v join clinic_reception.appointments a on a.id=v.appointment_id join clinic_reception.providers provider on provider.id=a.provider_id join clinic_reception.services service on service.id=a.service_id
  where v.id=(result->>'id')::uuid and v.workspace_id=p_workspace and pv.id=v.archive_visit_id;
 end if;
 return result;
end $$;
revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid) to authenticated;
alter function public.clinic_reception_snapshot(uuid,date,date) rename to clinic_reception_snapshot_before_catalog;
alter function public.clinic_reception_snapshot_before_catalog(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.clinic_reception_snapshot_before_catalog(uuid,date,date) from public,anon,authenticated;
create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$begin
 perform clinic_reception.access(p_workspace,'view');perform clinic_reception.sync_catalog(p_workspace);return clinic_reception.clinic_reception_snapshot_before_catalog(p_workspace,p_from,p_to);
end $$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;

alter function clinic_reception.access(uuid,text) rename to workspace_access;
create function clinic_reception.access(p_workspace uuid,p_action text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();allowed boolean:=false;begin
 if me is not null and exists(select 1 from public.admins where id=me and active) and exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') and (select live_enabled from clinic_reception.settings where id) then
  allowed:=case when p_action='view' then clinic_finance.allowed('view') or public.has_role('reception') or public.has_role('customer_service') when p_action='collect' then clinic_finance.allowed('create') when p_action in ('review','finance_review') then clinic_finance.allowed('review') when p_action='reports' then clinic_finance.allowed('view') when p_action='book' then public.has_role('reception') or public.has_role('customer_service') else false end;
  if allowed then return me;end if;
 end if;
 return clinic_reception.workspace_access(p_workspace,p_action);
end $$;
revoke all on function clinic_reception.access(uuid,text),clinic_reception.workspace_access(uuid,text) from public,anon,authenticated;
create or replace function public.clinic_reception_workspaces() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();begin
 if me is null or not exists(select 1 from public.admins where id=me and active) then raise exception 'سجل الدخول' using errcode='42501';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'mode',w.mode,'is_owner',w.owner_id=me) order by w.mode),'[]') from clinic_reception.workspaces w where
 ((w.owner_id=me or exists(select 1 from clinic_reception.members where workspace_id=w.id and admin_id=me and cardinality(capabilities)>0)) and (w.mode='trial' or (select live_enabled from clinic_reception.settings where id)))
 or w.mode='live' and (select live_enabled from clinic_reception.settings where id) and (clinic_finance.allowed('view') or public.has_role('reception') or public.has_role('customer_service')));
end $$;
revoke all on function public.clinic_reception_workspaces() from public,anon,authenticated;
grant execute on function public.clinic_reception_workspaces() to authenticated;
-- Existing contracting dashboard totals now read executed services from the same invoice IDs.
-- No lead invoice upload/copy and no second income journal are created.
alter function public.contract_entity_financial_rows(uuid) rename to contract_entity_financial_rows_before_reception;
alter function public.contract_entity_financial_rows_before_reception(uuid) set schema clinic_reception;
revoke all on function clinic_reception.contract_entity_financial_rows_before_reception(uuid) from public,anon,authenticated;
create function public.contract_entity_financial_rows(p_entity_id uuid default null)
returns table(entity_id uuid,contract_id uuid,patient_id uuid,patient_name text,patient_code text,invoices_count bigint,documented_revenue numeric,cashback_due numeric,net_after_cashback numeric)
language sql stable security definer set search_path=pg_catalog,public as $$
 with executed as(
 select c.entity_id,c.id contract_id,p.id patient_id,p.full_name patient_name,p.patient_code,i.id invoice_id,
 greatest(0,i.amount-i.credit_amount-coalesce((select sum(cl.contractual) from clinic_reception.claims cl where cl.invoice_id=i.id),0)) net,
 coalesce((q.snapshot->'source_terms'->>'cashback_percent')::numeric,0) cashback
 from clinic_reception.invoices i join clinic_reception.workspaces w on w.id=i.workspace_id and w.mode='live'
 join clinic_reception.order_quotes q on q.order_id=i.order_id join clinic_reception.entity_contracts ec on ec.id=q.contract_id
 join public.contracting_entity_contracts c on c.id=ec.external_contract_id join clinic_reception.patients rp on rp.id=i.patient_id join public.patients p on p.id=rp.patient_id
 where public.can_manage_contracting_entities() and (select live_enabled from clinic_reception.settings where id) and (p_entity_id is null or c.entity_id=p_entity_id)),
 all_rows as(select * from clinic_reception.contract_entity_financial_rows_before_reception(p_entity_id)
 union all select e.entity_id,e.contract_id,e.patient_id,e.patient_name,e.patient_code,count(*)::bigint,sum(net),sum(round(net*cashback/100,2)),sum(net-round(net*cashback/100,2)) from executed e group by e.entity_id,e.contract_id,e.patient_id,e.patient_name,e.patient_code)
 select r.entity_id,r.contract_id,r.patient_id,r.patient_name,r.patient_code,sum(r.invoices_count)::bigint,sum(r.documented_revenue),sum(r.cashback_due),sum(r.net_after_cashback) from all_rows r group by r.entity_id,r.contract_id,r.patient_id,r.patient_name,r.patient_code;
$$;
revoke all on function public.contract_entity_financial_rows(uuid) from public,anon,authenticated;
grant execute on function public.contract_entity_financial_rows(uuid) to authenticated;
-- The same bank/Instapay reference cannot be reused through the legacy finance collection form.
alter function public.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid) rename to clinic_finance_collect_before_reception;
alter function public.clinic_finance_collect_before_reception(uuid,uuid,text,numeric,text,uuid) set schema clinic_reception;
revoke all on function clinic_reception.clinic_finance_collect_before_reception(uuid,uuid,text,numeric,text,uuid) from public,anon,authenticated;
create function public.clinic_finance_collect(p_invoice uuid,p_shift uuid,p_method text,p_amount numeric,p_reference text,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$begin
 perform clinic_finance.require_access('create');perform clinic_finance.lock_day();
 if p_method in ('bank','instapay','pos','wallet') and exists(select 1 from clinic_reception.payments p join clinic_reception.workspaces w on w.id=p.workspace_id and w.mode='live' where p.reference=trim(p_reference) and (p.method=p_method or p.method in ('bank','instapay') and p_method in ('bank','instapay'))) then raise exception 'مرجع التحصيل مستخدم بالفعل في الخدمة المسجلة';end if;
 return clinic_reception.clinic_finance_collect_before_reception(p_invoice,p_shift,p_method,p_amount,p_reference,p_token);
end $$;
revoke all on function public.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid) to authenticated;
