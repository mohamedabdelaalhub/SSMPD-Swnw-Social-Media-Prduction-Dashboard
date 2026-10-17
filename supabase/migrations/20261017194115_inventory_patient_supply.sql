-- Additional patient supplies use the existing reception invoice, stock and event ledgers.
-- This table is immutable line evidence, not a second patient/invoice/stock system.
create table clinic_reception.patient_supplies (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references clinic_reception.workspaces(id),
 patient_id uuid not null references clinic_reception.patients(id),
 visit_id uuid not null references clinic_reception.visits(id),
 invoice_id uuid not null references clinic_reception.invoices(id),
 order_id uuid references clinic_reception.orders(id),
 item_id uuid not null references public.inventory_items(id),
 location_id uuid not null references public.inventory_locations(id),
 quantity numeric(14,3) not null check(quantity>0),
 sale_price numeric(14,2) not null check(sale_price>0),
 amount numeric(14,2) not null check(amount>0),cost numeric(14,2) not null default 0,
 note text not null check(length(trim(note)) between 3 and 500),
 repeat_confirmed boolean not null,created_by uuid not null references public.admins(id),
 created_at timestamptz not null default now()
);
create index reception_patient_supply_visit on clinic_reception.patient_supplies(workspace_id,visit_id,item_id);
create index reception_patient_supply_invoice on clinic_reception.patient_supplies(invoice_id);
alter table clinic_reception.patient_supplies enable row level security;
revoke all on clinic_reception.patient_supplies from public,anon,authenticated;

create function clinic_reception.patient_supply_access(p_workspace uuid,p_location uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public as $$declare me uuid;begin
 if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then raise exception 'اختر مساحة الاستقبال المتصلة';end if;
 me:=clinic_reception.access(p_workspace,'collect');
 perform clinic_finance.require_access('create');
 if not (public.inventory_location_can(p_location,'receive') or public.inventory_location_can(p_location,'manage')) then raise exception 'لا توجد صلاحية صرف من هذا المخزن' using errcode='42501';end if;
 return me;
end $$;
revoke all on function clinic_reception.patient_supply_access(uuid,uuid) from public,anon,authenticated;

create function public.inventory_patient_supply_context(p_location uuid,p_item uuid default null,p_term text default '',p_patient uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare w uuid;me uuid;it public.inventory_items%rowtype;v jsonb;term text:=translate(trim(coalesce(p_term,'')),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789');begin
 select id into w from clinic_reception.workspaces where mode='live';
 me:=clinic_reception.patient_supply_access(w,p_location);
 if length(term)>120 then raise exception 'اختصر عبارة البحث';end if;
 if p_item is not null then select * into it from public.inventory_items where id=p_item and active;if not found then raise exception 'الصنف غير متاح';end if;end if;
 if p_patient is not null and not exists(select 1 from clinic_reception.patients where workspace_id=w and patient_id=p_patient) then raise exception 'اختر ملف المريض المسجل في الزيارة';end if;
 with patients as (
  select rp.id,rp.patient_id,p.patient_code file_no,p.full_name name,p.phone
  from clinic_reception.patients rp join public.patients p on p.id=rp.patient_id
  where rp.workspace_id=w and exists(select 1 from clinic_reception.visits vis where vis.workspace_id=w and vis.patient_id=rp.id and vis.status='open')
   and (p_patient is not null and p.id=p_patient or p_patient is null and length(term)>=2 and
    (strpos(lower(p.full_name),lower(term))>0 or strpos(lower(p.patient_code),lower(term))>0 or
     length(regexp_replace(term,'[^0-9]','','g'))>=2 and strpos(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),regexp_replace(term,'[^0-9]','','g'))>0))
  order by p.full_name,rp.id limit 20),
 visits as (select vis.* from clinic_reception.visits vis join patients p on p.id=vis.patient_id where p_patient is not null and vis.workspace_id=w and vis.status='open' order by vis.opened_at desc,vis.id limit 50)
 select jsonb_build_object('workspace_id',w,'patients',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from patients p),
 'item',case when it.id is not null then jsonb_build_object('id',it.id,'name',it.name,'unit',it.base_unit,'sale_price',it.current_sale_price) end,
 'visits',(select coalesce(jsonb_agg(jsonb_build_object('id',vis.id,'visit_no',vis.visit_no,'opened_at',vis.opened_at)),'[]') from visits vis),
 'invoices',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'visit_id',i.visit_id,'invoice_no',i.invoice_no,'description',i.description,'amount',i.amount,'due',clinic_reception.due(i.id)) order by i.invoice_no),'[]') from clinic_reception.invoices i join visits vis on vis.id=i.visit_id where i.kind='service'),
 'planned',(select coalesce(jsonb_agg(jsonb_build_object('visit_id',o.visit_id,'service_name',o.snapshot->>'name','quantity',(bom->>'quantity')::numeric*o.quantity,'included',coalesce((bom->>'included')::boolean,true))),'[]') from clinic_reception.orders o join visits vis on vis.id=o.visit_id cross join lateral jsonb_array_elements(coalesce(o.snapshot->'bom','[]')) bom join clinic_reception.items rx on rx.id=(bom->>'item_id')::uuid where o.status='ordered' and rx.inventory_item_id=p_item),
 'previous',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from (
   select ps.visit_id,ps.quantity,ps.created_at,'sale'::text kind,'RX-'||i.invoice_no invoice_ref,a.name actor_name
   from clinic_reception.patient_supplies ps join visits vis on vis.id=ps.visit_id join clinic_reception.invoices i on i.id=ps.invoice_id join public.admins a on a.id=ps.created_by where ps.item_id=p_item
   union all
   select o.visit_id,-m.quantity,m.created_at,m.kind,'RX-'||i.invoice_no,a.name
   from clinic_reception.movements m join clinic_reception.orders o on o.id=m.source_id join visits vis on vis.id=o.visit_id join clinic_reception.items rx on rx.id=m.item_id left join clinic_reception.invoices i on i.order_id=o.id join public.admins a on a.id=m.actor_id where rx.inventory_item_id=p_item and m.kind in ('included','sale')
  order by created_at desc limit 100)x)) into v;
 return v;
end $$;
revoke all on function public.inventory_patient_supply_context(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.inventory_patient_supply_context(uuid,uuid,text,uuid) to authenticated;

create function public.inventory_dispense_patient(p_payload jsonb,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w uuid;me uuid;prev clinic_reception.commands%rowtype;vis clinic_reception.visits%rowtype;
 patient clinic_reception.patients%rowtype;inv clinic_reception.invoices%rowtype;it public.inventory_items%rowtype;
 rx uuid;loc uuid;q numeric;price numeric;total numeric;v_cost numeric;v uuid;outcome jsonb;dims jsonb;ord uuid;repeat_ok boolean;why text;begin
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>6000 then raise exception 'طلب غير صالح';end if;
 w:=nullif(p_payload->>'workspace_id','')::uuid;
 me:=clinic_reception.patient_supply_access(w,nullif(p_payload->>'location_id','')::uuid);
 perform 1 from clinic_reception.workspaces where id=w for update;
 select * into prev from clinic_reception.commands where workspace_id=w and actor_id=me and token=p_token;
 if found then if prev.action<>'patient_supply' or prev.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;return prev.response;end if;
 perform clinic_finance.lock_day();
 select * into vis from clinic_reception.visits where id=nullif(p_payload->>'visit_id','')::uuid and workspace_id=w and status='open' for update;
 if not found then raise exception 'اختر زيارة مفتوحة للمريض؛ الزيارة المغلقة لا تستقبل صرفًا جديدًا';end if;
 select * into patient from clinic_reception.patients where id=vis.patient_id and workspace_id=w and patient_id=nullif(p_payload->>'patient_id','')::uuid;
 if not found then raise exception 'الزيارة لا تخص ملف المريض المختار';end if;
 q:=clinic_reception.number(p_payload->>'quantity',3);price:=clinic_reception.number(p_payload->>'sale_price');why:=trim(coalesce(p_payload->>'note',''));repeat_ok:=coalesce((p_payload->>'repeat_confirmed')::boolean,false);
 if length(why) not between 3 and 500 or coalesce((p_payload->>'patient_confirmed')::boolean,false) is not true then raise exception 'وضح سبب الصرف وأكد موافقة المريض على القيمة';end if;
 perform clinic_reception.sync_native_links(w);
 -- Same lock order as the service execution stock synchronizer.
 perform clinic_reception.sync_stock(w);
 select * into it from public.inventory_items where id=nullif(p_payload->>'item_id','')::uuid and active for update;
 if not found or it.current_sale_price<>price then raise exception 'سعر بيع الصنف تغير أو غير متاح؛ راجع السعر قبل التأكيد';end if;
 total:=round(q*price,2);if total<=0 then raise exception 'قيمة الصرف أقل من أصغر وحدة نقدية';end if;
 select id into rx from clinic_reception.items where workspace_id=w and inventory_item_id=it.id;
 select id into loc from clinic_reception.locations where workspace_id=w and inventory_location_id=(p_payload->>'location_id')::uuid;
 if rx is null or loc is null then raise exception 'تعذر قراءة ربط الصنف أو المخزن المعتمد';end if;
 if exists(select 1 from clinic_reception.orders o cross join lateral jsonb_array_elements(coalesce(o.snapshot->'bom','[]')) bom where o.workspace_id=w and o.visit_id=vis.id and o.status='ordered' and bom->>'item_id'=rx::text) then raise exception 'المستلزم موجود ضمن خدمة لم تنفذ؛ سجله من تنفيذ الخدمة حتى لا يصرف مرتين';end if;
 if not repeat_ok and (exists(select 1 from clinic_reception.patient_supplies where workspace_id=w and visit_id=vis.id and item_id=it.id) or exists(select 1 from clinic_reception.movements m join clinic_reception.orders o on o.id=m.source_id where o.workspace_id=w and o.visit_id=vis.id and m.item_id=rx and m.kind in ('included','sale'))) then raise exception 'سبق صرف الصنف في الزيارة؛ راجع السجل وأكد أنها كمية إضافية جديدة';end if;
 if nullif(p_payload->>'invoice_id','') is not null then
  select * into inv from clinic_reception.invoices where id=(p_payload->>'invoice_id')::uuid and workspace_id=w and patient_id=patient.id and visit_id=vis.id and kind='service' for update;
  if not found then raise exception 'الفاتورة لا تخص نفس المريض والزيارة';end if;
 else
  -- A single, ordinary reception invoice for supplies before the first service invoice exists.
  if exists(select 1 from clinic_reception.invoices where workspace_id=w and visit_id=vis.id and kind='service') then raise exception 'اختر فاتورة الزيارة الموجودة بدل إنشاء بيان جديد';end if;
  insert into clinic_reception.invoices(workspace_id,patient_id,visit_id,kind,amount,description) values(w,patient.id,vis.id,'service',0,'مستلزمات إضافية للزيارة') returning * into inv;
 end if;
 ord:=inv.order_id;
 if ord is null then select id into ord from clinic_reception.orders where workspace_id=w and visit_id=vis.id and status in ('ordered','completed') order by created_at,id limit 1;end if;
 dims:=jsonb_build_object('patient_id',patient.id,'visit_id',vis.id,'invoice_id',inv.id,'order_id',ord,'item_id',rx,'location_id',loc);
 insert into clinic_reception.patient_supplies(workspace_id,patient_id,visit_id,invoice_id,order_id,item_id,location_id,quantity,sale_price,amount,note,repeat_confirmed,created_by)
 values(w,patient.id,vis.id,inv.id,ord,it.id,(p_payload->>'location_id')::uuid,q,price,total,why,repeat_ok,me) returning id into v;
 v_cost:=clinic_reception.consume(w,rx,loc,q,'sale',v);
 update clinic_reception.patient_supplies set cost=v_cost where id=v;
 -- Consume already posts the actual FEFO cost and mirrors stock once. Supply dimensions replace its order placeholder.
 update clinic_reception.journal set dimensions=dims||jsonb_build_object('patient_supply_id',v) where workspace_id=w and source='stock_cost' and source_id in(select id from clinic_reception.movements where workspace_id=w and source_id=v);
 update public.inventory_movements set patient_invoice_ref='RX-'||inv.invoice_no,note='مستلزم إضافي — ملف '||patient.file_no||' / زيارة '||vis.visit_no||' — '||why where id in(select inventory_movement_id from clinic_reception.movements where workspace_id=w and source_id=v);
 perform clinic_reception.post(w,'extra_material',v,'صرف مستلزم إضافي لمريض — '||it.name,'1122','4116',total,dims||jsonb_build_object('patient_supply_id',v));
 update clinic_reception.invoices set amount=amount+total where id=inv.id;
 outcome:=jsonb_build_object('id',v,'invoice_id',inv.id,'invoice_no',inv.invoice_no,'visit_no',vis.visit_no,'amount',total,'due',clinic_reception.due(inv.id));
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail) values(w,me,'patient_supply',v,p_payload||outcome);
 insert into clinic_reception.commands values(w,me,p_token,'patient_supply',p_payload,outcome);
 return outcome;
end $$;
revoke all on function public.inventory_dispense_patient(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.inventory_dispense_patient(jsonb,uuid) to authenticated;

-- Internal consumption still exists, with a server-enforced reason and no pretend invoice link.
create or replace function public.inventory_consume_at(p_location uuid,p_item uuid,p_quantity numeric,p_kind text,p_note text default '',p_invoice text default '',p_payment text default '',p_lot uuid default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if p_kind='issue' then
  if length(trim(coalesce(p_note,''))) not between 3 and 500 then raise exception 'وضح سبب الاستهلاك الداخلي من 3 إلى 500 حرف';end if;
  if nullif(trim(p_invoice),'') is not null then raise exception 'صرف المريض يتم من زر صرف مستلزم إضافي لمريض وربطه بالزيارة والفاتورة';end if;
 end if;
 perform clinic_finance.lock_day();return clinic_finance.stock_consume_base(p_location,p_item,p_quantity,p_kind,p_note,p_invoice,p_payment,p_lot);
end $$;

-- Pre-issued additional units cannot be silently selected again during service execution.
do $$declare def text;patched text;begin
 def:=pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,'if extra_qty>0 then value:=clinic_reception.consume',
 $s$if extra_qty>0 and exists(select 1 from clinic_reception.patient_supplies ps where ps.workspace_id=p_workspace and ps.visit_id=visit.id and ps.item_id=item.inventory_item_id) then raise exception 'سبق صرف هذا المستلزم الإضافي للزيارة؛ احذفه من إضافات التنفيذ. أي كمية جديدة تصرف من صرف المريض مع مراجعة السابق';end if;
   if extra_qty>0 then value:=clinic_reception.consume$s$);
 if patched=def then raise exception 'Missing additional material consumption guard';end if;execute patched;
end $$;
-- An invoice containing supplies only has no service value or physician fee to reverse.
create or replace function clinic_reception.service_value(p_invoice uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(o.net_revenue-coalesce((select sum(-m.quantity*m.sale_price) from clinic_reception.movements m where m.workspace_id=i.workspace_id and m.source_id=o.id and m.kind='sale'),0),0)
 from clinic_reception.invoices i left join clinic_reception.orders o on o.id=i.order_id where i.id=p_invoice
$$;

-- Extend existing statement details; no second invoice or payment projection.
alter function public.clinic_reception_snapshot(uuid,date,date) rename to snapshot_before_patient_supplies;
alter function public.snapshot_before_patient_supplies(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_patient_supplies(uuid,date,date) from public,anon,authenticated;
create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare v jsonb;begin
 v:=clinic_reception.snapshot_before_patient_supplies(p_workspace,p_from,p_to);
 return jsonb_set(v,'{invoice_materials}',coalesce(v->'invoice_materials','[]')||
 (select coalesce(jsonb_agg(jsonb_build_object('invoice_id',ps.invoice_id,'name',i.name,'unit',i.base_unit,'kind','sale','quantity',ps.quantity,'sale_price',ps.sale_price,'amount',ps.amount,'note',ps.note,'created_at',ps.created_at,'actor_name',a.name)),'[]') from clinic_reception.patient_supplies ps join public.inventory_items i on i.id=ps.item_id join public.admins a on a.id=ps.created_by where ps.workspace_id=p_workspace));
end $$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;

alter function public.clinic_reception_shared_records(text,uuid,date,date,integer) rename to shared_before_patient_supplies;
alter function public.shared_before_patient_supplies(text,uuid,date,date,integer) set schema clinic_reception;
revoke all on function clinic_reception.shared_before_patient_supplies(text,uuid,date,date,integer) from public,anon,authenticated;
create function public.clinic_reception_shared_records(p_context text,p_id uuid default null,p_from date default null,p_to date default null,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb;begin
 v:=clinic_reception.shared_before_patient_supplies(p_context,p_id,p_from,p_to,p_offset);
 return jsonb_set(v,'{invoices}',(select coalesce(jsonb_agg(i||jsonb_build_object('additional_supplies',(select coalesce(jsonb_agg(jsonb_build_object('name',it.name,'quantity',ps.quantity,'unit',it.base_unit,'sale_price',ps.sale_price,'amount',ps.amount,'note',ps.note,'created_at',ps.created_at,'actor_name',a.name) order by ps.created_at),'[]') from clinic_reception.patient_supplies ps join public.inventory_items it on it.id=ps.item_id join public.admins a on a.id=ps.created_by where ps.invoice_id=(i->>'id')::uuid))),'[]') from jsonb_array_elements(v->'invoices') i));
end $$;
revoke all on function public.clinic_reception_shared_records(text,uuid,date,date,integer) from public,anon,authenticated;
grant execute on function public.clinic_reception_shared_records(text,uuid,date,date,integer) to authenticated;

-- Supplemental supply sales are separate from performed service counts/physician remuneration.
alter function public.clinic_reception_report(uuid,date,date) rename to report_before_patient_supplies;
alter function public.report_before_patient_supplies(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.report_before_patient_supplies(uuid,date,date) from public,anon,authenticated;
create function public.clinic_reception_report(p_workspace uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb;begin
 v:=clinic_reception.report_before_patient_supplies(p_workspace,p_from,p_to);
 return v||jsonb_build_object('patient_supplies',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select it.name,sum(ps.quantity) quantity,sum(ps.amount) revenue,sum(ps.cost) cost from clinic_reception.patient_supplies ps join public.inventory_items it on it.id=ps.item_id where ps.workspace_id=p_workspace and (ps.created_at at time zone 'Africa/Cairo')::date between p_from and p_to group by it.id)x));
end $$;
revoke all on function public.clinic_reception_report(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_report(uuid,date,date) to authenticated;
