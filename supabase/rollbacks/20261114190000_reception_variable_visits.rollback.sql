-- Rollback for 20261114190000_reception_variable_visits.sql.
-- Restores clinic_reception.service_operation exactly as it was after the PR #456 migrations (definition captured from production
-- on 2026-11-14 before this change), then drops the objects this migration added.
-- Packages already sold with visit_terms keep their rows and entitlements (they are ordinary packages); only the sale option goes away.
begin;
CREATE OR REPLACE FUNCTION clinic_reception.service_operation(p_workspace uuid, p_action text, p_payload jsonb, p_me uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v uuid;tp clinic_reception.package_templates%rowtype;pkg clinic_reception.packages%rowtype;en clinic_reception.entitlements%rowtype;o clinic_reception.orders%rowtype;visit clinic_reception.visits%rowtype;agreement clinic_reception.doctor_agreements%rowtype;item clinic_reception.items%rowtype;s clinic_reception.services%rowtype;line record;material jsonb;materials jsonb;sum_price numeric;allocated numeric:=0;value numeric;remaining integer;n integer:=0;gross numeric;net numeric;discount numeric;v_cost numeric:=0;included_cost numeric:=0;extra numeric:=0;actual_qty numeric;included_qty numeric;extra_qty numeric;fee numeric:=0;covered numeric;invoice uuid;device clinic_reception.devices%rowtype;dims jsonb;dr clinic_reception.discount_requests%rowtype;percent numeric;review boolean;members text[];
begin
 if p_action='member' then
  if not exists(select 1 from public.admins where id=(p_payload->>'admin_id')::uuid and active) then raise exception 'الحساب غير متاح';end if;
  select array_agg(x) into members from jsonb_array_elements_text(coalesce(p_payload->'capabilities','[]')) x;
  if members is not null and not members<@array['view','book','execute','collect','review','manage','reports','warehouse','finance_review']::text[] then raise exception 'منح غير صالحة';end if;
  insert into clinic_reception.members values(p_workspace,(p_payload->>'admin_id')::uuid,coalesce(members,'{}')) on conflict(workspace_id,admin_id) do update set capabilities=excluded.capabilities;
  v:=(p_payload->>'admin_id')::uuid;
 elsif p_action='package_sell' then
  select * into tp from clinic_reception.package_templates where workspace_id=p_workspace and id=(p_payload->>'template_id')::uuid and active;
  if not found or not exists(select 1 from clinic_reception.patients where workspace_id=p_workspace and id=(p_payload->>'patient_id')::uuid) then raise exception 'راجع المريض والباكج';end if;

  if p_payload ? 'orthodontic_terms' then
   if jsonb_typeof(p_payload->'orthodontic_terms') is distinct from 'object'
      or coalesce(p_payload#>>'{orthodontic_terms,schedule}','') not in ('fixed','visit')
      or coalesce(p_payload#>>'{orthodontic_terms,visits}','') !~ '^[1-9][0-9]{0,2}$'
      or coalesce(p_payload#>>'{orthodontic_terms,days}','') !~ '^[1-9][0-9]{0,3}$' then
    raise exception 'راجع السعر والزيارات والمدة وطريقة الاستحقاق';
   end if;
   tp.price := clinic_reception.number(p_payload#>>'{orthodontic_terms,price}');
   tp.visits := (p_payload#>>'{orthodontic_terms,visits}')::integer;
   tp.validity_days := (p_payload#>>'{orthodontic_terms,days}')::integer;
   if tp.visits>365 or tp.validity_days>3650 or tp.price<1
      or (select count(*) from clinic_reception.template_lines where template_id=tp.id)<>1
      or not exists(select 1 from clinic_reception.template_lines where template_id=tp.id and visit_no=1)
      or to_jsonb(tp)->>'orthodontic' is distinct from 'true' then
    raise exception 'اختر قالب تقويم معتمد بمكوّن زيارة واحد وراجع مدة العقد';
   end if;
   if jsonb_typeof(p_payload->'installments') is distinct from 'array'
      or jsonb_array_length(p_payload->'installments')<>tp.visits+1
      or (p_payload->'installments'->0->>'amount')::numeric is distinct from round(tp.price/4,2) then
    raise exception 'راجع جدول التقويم والمقدم';
   end if;
  end if;
  insert into clinic_reception.packages(workspace_id,patient_id,template_id,name,contract_price,visits,expires_on,terms,created_by) values(p_workspace,(p_payload->>'patient_id')::uuid,tp.id,tp.name,tp.price,tp.visits,clinic_reception.today()+tp.validity_days,tp.terms,p_me) returning id into v;

  if p_payload ? 'orthodontic_terms' then
   update clinic_reception.packages set payment_schedule=p_payload#>>'{orthodontic_terms,schedule}' where id=v;
   insert into clinic_reception.entitlements(package_id,visit_no,service_id,quantity,allocated_value,snapshot)
   select v,seq,l.service_id,l.quantity,
          trunc(tp.price*seq/tp.visits,2)-trunc(tp.price*(seq-1)/tp.visits,2),l.service_snapshot
   from clinic_reception.template_lines l cross join generate_series(1,tp.visits) seq
   where l.template_id=tp.id;
  else
   select sum(quantity*standalone_price),count(*) into sum_price,remaining from clinic_reception.template_lines where template_id=tp.id;

  for line in select * from clinic_reception.template_lines where template_id=tp.id order by visit_no,id loop
   n:=n+1;value:=case when n=remaining then tp.price-allocated else round(tp.price*line.quantity*line.standalone_price/sum_price,2) end;allocated:=allocated+value;
   insert into clinic_reception.entitlements(package_id,visit_no,service_id,quantity,allocated_value,snapshot) values(v,line.visit_no,line.service_id,line.quantity,value,line.service_snapshot);
  end loop;
  end if;
  -- An optional schedule is a reminder/contract term, not automatically an unconditional receivable.
  if p_payload?'installments' then
   if jsonb_typeof(p_payload->'installments') is distinct from 'array' then raise exception 'راجع جدول الأقساط';end if;
   value:=0;for material in select * from jsonb_array_elements(p_payload->'installments') loop
    percent:=clinic_reception.number(material->>'amount');value:=value+percent;
    insert into clinic_reception.installments(package_id,due_on,amount,unconditional,created_by,plan_visit_no) values(v,(material->>'due_on')::date,percent,false,p_me,case when p_payload ? 'orthodontic_terms' then n end); n:=n+1;
   end loop;if value<>tp.price then raise exception 'إجمالي الأقساط يجب أن يساوي سعر الباكج';end if;
  end if;
 elsif p_action='installment_bill' then
  select p.* into pkg from clinic_reception.packages p join clinic_reception.installments x on x.package_id=p.id where p.workspace_id=p_workspace and x.id=(p_payload->>'id')::uuid for update of p;
  if not found or pkg.status<>'active' then raise exception 'الباكج غير متاح';end if;
  select * into line from clinic_reception.installments where id=(p_payload->>'id')::uuid for update;
  if line.invoice_id is not null or line.created_by=p_me or coalesce((p_payload->>'unconditional')::boolean,false) is not true or length(trim(coalesce(p_payload->>'evidence','')))<3 then raise exception 'يلزم اعتماد شخص آخر لحق التحصيل غير المشروط ومستنده';end if;
  if pkg.funded+line.amount>pkg.contract_price then raise exception 'القسط يتجاوز باقي قيمة الباكج غير المثبتة';end if;
  insert into clinic_reception.invoices(workspace_id,patient_id,package_id,kind,amount,description) values(p_workspace,pkg.patient_id,pkg.id,'installment',line.amount,'قسط باكج معتمد') returning id into v;
  perform clinic_reception.post(p_workspace,'package_installment',v,'استحقاق قسط باكج','1122','2151',line.amount,jsonb_build_object('patient_id',pkg.patient_id,'package_id',pkg.id,'invoice_id',v));
  update clinic_reception.installments set invoice_id=v,unconditional=true,reviewed_by=p_me where id=line.id;update clinic_reception.packages set funded=funded+line.amount where id=pkg.id;
 elsif p_action='order_add' then
  select * into visit from clinic_reception.visits where workspace_id=p_workspace and id=(p_payload->>'visit_id')::uuid and status='open';
  if not found then raise exception 'الزيارة غير متاحة';end if;
  select * into s from clinic_reception.services where id=(p_payload->>'service_id')::uuid and workspace_id=p_workspace and active;
  if not found or not exists(select 1 from clinic_reception.providers where id=(p_payload->>'provider_id')::uuid and workspace_id=p_workspace and active and (department=s.department or clinic_reception.has_provider_service_scope(id,s.code,clinic_reception.today()))) then raise exception 'راجع الخدمة وطبيبها';end if;
  insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,quantity,price,snapshot,created_by) values(p_workspace,visit.id,s.id,(p_payload->>'provider_id')::uuid,clinic_reception.number(coalesce(p_payload->>'quantity','1'),3),s.price,to_jsonb(s),p_me) returning id into v;
 elsif p_action='order_cancel' then
  if length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'أدخل سبب الإلغاء';end if;
  update clinic_reception.orders set status='cancelled' where workspace_id=p_workspace and id=(p_payload->>'id')::uuid and status='ordered' returning id into v;
  if v is null then raise exception 'لا يمكن إلغاء خدمة منفذة';end if;
 elsif p_action='discount' then
  select * into o from clinic_reception.orders where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and status='ordered' for update;
  percent:=clinic_reception.number(p_payload->>'percent',2,true);
  if not found or o.entitlement_id is not null or percent>100 or length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'راجع الخصم وسببه؛ الباكج يحفظ سعره المتعاقد عليه';end if;
  if exists(select 1 from clinic_reception.discount_requests where order_id=o.id and status='pending') then raise exception 'يوجد خصم بانتظار المراجعة';end if;
  insert into clinic_reception.discount_requests(workspace_id,order_id,percent,reason,created_by,status) values(p_workspace,o.id,percent,p_payload->>'reason',p_me,case when percent<=5 then 'approved' else 'pending' end) returning id into v;
  if percent<=5 then update clinic_reception.orders set discount=percent where id=o.id;end if;
 elsif p_action='discount_review' then
  select * into dr from clinic_reception.discount_requests where workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;review:=(p_payload->>'approve')::boolean;
  if not found or dr.created_by=p_me or dr.status<>'pending' or review is null then raise exception 'الخصم يحتاج مراجعة شخص آخر';end if;
  if dr.percent>15 then perform clinic_reception.access(p_workspace,'finance_review');end if;
  if not exists(select 1 from clinic_reception.orders where id=dr.order_id and status='ordered') then raise exception 'الخدمة لم تعد قابلة للخصم';end if;
  update clinic_reception.discount_requests set status=case when review then 'approved' else 'rejected' end,reviewed_by=p_me where id=dr.id;
  if review then update clinic_reception.orders set discount=dr.percent where id=dr.order_id;end if;v:=dr.id;
 elsif p_action='execute' then
  select * into o from clinic_reception.orders where workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;
  if not found or o.status<>'ordered' then raise exception 'الخدمة منفذة أو غير متاحة';end if;
  select * into visit from clinic_reception.visits where id=o.visit_id and status='open';if not found then raise exception 'الزيارة مغلقة';end if;
  if exists(select 1 from clinic_reception.discount_requests where order_id=o.id and status='pending') then raise exception 'راجع الخصم المعلق قبل التنفيذ';end if;
  if nullif(p_payload->>'provider_id','') is not null then o.provider_id:=(p_payload->>'provider_id')::uuid;end if;
  if not exists(select 1 from clinic_reception.providers where id=o.provider_id and workspace_id=p_workspace and active and (department=o.snapshot->>'department' or clinic_reception.has_provider_service_scope(id,o.snapshot->>'code',clinic_reception.today()) or (o.snapshot->>'code' in ('0001371','0001372') and o.snapshot->>'code'=any(clinic_reception.consultation_scopes(doctor_key,clinic_reception.today()))))) then raise exception 'حدد الطبيب المنفذ من تخصص الخدمة';end if;
  select * into agreement from clinic_reception.doctor_agreements where workspace_id=p_workspace and provider_id=o.provider_id and service_code=o.snapshot->>'code' and status='active' and clinic_reception.today() between valid_from and valid_to;
  if not found then raise exception 'يلزم عقد أتعاب معتمد للخدمة المنفذة ولو بنسبة صفر';end if;
  if coalesce((o.snapshot->>'requires_device')::boolean,false) or nullif(p_payload->>'device_id','') is not null then
   select * into device from clinic_reception.devices where id=(p_payload->>'device_id')::uuid and workspace_id=p_workspace;if not found then raise exception 'حدد الجهاز المستخدم';end if;
   if device.meter_kind<>'none' and (p_payload->>'meter_before' is null or p_payload->>'meter_after' is null) then raise exception 'أدخل قراءات الجهاز';end if;
   insert into clinic_reception.device_uses(workspace_id,device_id,order_id,minutes,meter_before,meter_after) values(p_workspace,device.id,o.id,clinic_reception.number(p_payload->>'minutes',0),case when device.meter_kind<>'none' then clinic_reception.number(p_payload->>'meter_before',3,true) end,case when device.meter_kind<>'none' then clinic_reception.number(p_payload->>'meter_after',3,true) end);
  end if;

  if exists(select 1 from clinic_reception.laser_pulse_services where service_code=o.snapshot->>'code') then
   if device.id is null or device.meter_kind<>'shots' then
    raise exception 'اختر جهاز ليزر بعداد نبضات';
   end if;
   actual_qty:=clinic_reception.number(p_payload->>'meter_after',0,true)
               -clinic_reception.number(p_payload->>'meter_before',0,true);
   if actual_qty<=0 then raise exception 'قراءة نهاية الجلسة لازم تزيد عن البداية'; end if;
   if o.entitlement_id is not null and actual_qty>o.quantity then
    raise exception 'النبضات الفعلية تتجاوز الرصيد المخصص للزيارة';
   end if;
   o.quantity:=actual_qty;
   update clinic_reception.orders set quantity=actual_qty where id=o.id;
  end if;
  materials:=p_payload->'materials';if materials is null then select coalesce(jsonb_agg(x||jsonb_build_object('quantity',(x->>'quantity')::numeric*o.quantity)),'[]') into materials from jsonb_array_elements(coalesce(o.snapshot->'bom','[]')) x;end if;if jsonb_typeof(materials) is distinct from 'array' or jsonb_array_length(materials)>50 then raise exception 'راجع المستلزمات';end if;
  if exists(select 1 from jsonb_array_elements(materials) x group by x->>'item_id' having count(*)>1) then raise exception 'المستلزم مكرر';end if;
  -- A required included BOM item cannot silently disappear from actual usage.
  for material in select * from jsonb_array_elements(coalesce(o.snapshot->'bom','[]')) loop
   if not exists(select 1 from jsonb_array_elements(materials) m where m->>'item_id'=material->>'item_id') and length(trim(coalesce(p_payload->>'material_note','')))<3 then raise exception 'وضح صرف مكونات الخدمة أو سجل تعديلها قبل التنفيذ';end if;
  end loop;
  for material in select * from jsonb_array_elements(materials) loop
   select * into item from clinic_reception.items where workspace_id=p_workspace and id=(material->>'item_id')::uuid;if not found then raise exception 'المستلزم غير متاح';end if;
   actual_qty:=clinic_reception.number(material->>'quantity',3,true);
   select coalesce(sum((x->>'quantity')::numeric*o.quantity),0) into included_qty from jsonb_array_elements(coalesce(o.snapshot->'bom','[]')) x where x->>'item_id'=item.id::text and coalesce((x->>'included')::boolean,true);
   included_qty:=least(actual_qty,included_qty);extra_qty:=actual_qty-included_qty;
   if actual_qty=0 and length(trim(coalesce(p_payload->>'material_note','')))<3 then raise exception 'وضح سبب عدم استخدام المكون';end if;
   if extra_qty>0 and (coalesce((p_payload->>'additional_confirmed')::boolean,false) is not true or item.sale_price<=0) then raise exception 'أكد موافقة المريض على الإضافات وسعر بيعها';end if;
   if included_qty>0 then value:=clinic_reception.consume(p_workspace,item.id,(p_payload->>'location_id')::uuid,included_qty,'included',o.id);v_cost:=v_cost+value;included_cost:=included_cost+value;end if;
   if extra_qty>0 and exists(select 1 from clinic_reception.patient_supplies ps where ps.workspace_id=p_workspace and ps.visit_id=visit.id and ps.item_id=item.inventory_item_id) then raise exception 'سبق صرف هذا المستلزم الإضافي للزيارة؛ احذفه من إضافات التنفيذ. أي كمية جديدة تصرف من صرف المريض مع مراجعة السابق';end if;
   if extra_qty>0 then value:=clinic_reception.consume(p_workspace,item.id,(p_payload->>'location_id')::uuid,extra_qty,'sale',o.id);v_cost:=v_cost+value;extra:=extra+round(extra_qty*item.sale_price,2);end if;
  end loop;
  gross:=round(o.price*o.quantity,2);discount:=round(gross*o.discount/100,2);net:=gross-discount;
  if o.entitlement_id is not null then
   select * into en from clinic_reception.entitlements where id=o.entitlement_id for update;select * into pkg from clinic_reception.packages where id=en.package_id and workspace_id=p_workspace for update;
   if pkg.status<>'active' or pkg.expires_on<clinic_reception.today() or en.used+o.quantity>en.quantity then raise exception 'رصيد الباكج غير متاح';end if;
   net:=case when en.used+o.quantity=en.quantity then en.allocated_value-en.recognized else round(en.allocated_value*o.quantity/en.quantity,2) end;gross:=net;discount:=0;
  end if;
  if net+extra<0 then raise exception 'قيمة الخدمة غير صالحة';end if;
  insert into clinic_reception.invoices(workspace_id,patient_id,visit_id,order_id,package_id,kind,amount,description) values(p_workspace,visit.patient_id,visit.id,o.id,pkg.id,'service',net+extra,o.snapshot->>'name') returning id into invoice;
  dims:=jsonb_build_object('patient_id',visit.patient_id,'visit_id',visit.id,'order_id',o.id,'provider_id',o.provider_id,'department',o.snapshot->>'department','invoice_id',invoice,'package_id',pkg.id);
  perform clinic_reception.post(p_workspace,'service',o.id,'تنفيذ خدمة','1122','4110',gross,dims);
  if discount>0 then perform clinic_reception.post(p_workspace,'discount',o.id,'خصم معتمد','4190','1122',discount,dims);end if;
  if extra>0 then perform clinic_reception.post(p_workspace,'extra_material',o.id,'مستلزمات إضافية بسعر البيع','1122','4116',extra,dims);end if;
  if pkg.id is not null then
   covered:=least(pkg.funded-pkg.recognized,net);
   if covered>0 then
    perform clinic_reception.post(p_workspace,'package_use',o.id,'استخدام رصيد الباكج','2151','1122',covered,dims);
    insert into clinic_reception.allocations(workspace_id,invoice_id,source,amount) values(p_workspace,invoice,'package',covered);
   end if;
   update clinic_reception.packages set funded=funded+net-covered,recognized=recognized+net where id=pkg.id;
   update clinic_reception.entitlements set used=used+o.quantity,recognized=recognized+net where id=en.id;
  end if;
  fee:=round(greatest(0,net-case when agreement.deduct_material_cost then included_cost else 0 end)*agreement.rate/100,2);
  if fee>0 then perform clinic_reception.post(p_workspace,'doctor_fee',o.id,'استحقاق طبيب لخدمة منفذة','5111','2120',fee,dims);end if;
  update clinic_reception.orders set status='completed',completed_at=now(),executed_by=p_me,provider_id=o.provider_id,agreement_id=agreement.id,cost=v_cost,doctor_fee=fee,net_revenue=net+extra where id=o.id;
  -- Visit closure is an explicit event; additional services may still be added.
  v:=invoice;
 else raise exception 'إجراء خدمات غير معروف';end if;
 return jsonb_build_object('id',v);
end $function$

;
drop trigger if exists trg_pricing_package_variable_sync on public.pricing_packages;
drop trigger if exists trg_package_template_variable_flag on clinic_reception.package_templates;
drop function if exists public.pricing_package_variable_sync();
drop function if exists clinic_reception.package_template_variable_flag();
alter table clinic_reception.package_templates drop column if exists variable_visits;
alter table public.pricing_packages drop constraint if exists pricing_packages_variable_visits_chk;
alter table public.pricing_packages drop column if exists booking_variable_visits;
commit;
