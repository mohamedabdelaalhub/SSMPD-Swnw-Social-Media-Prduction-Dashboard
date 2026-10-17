begin;
-- Trial operational subledger. Production remains locked until the cutover bridge is verified.
create table clinic_reception.items(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),code text not null,name text not null,unit text not null,markup numeric(8,4) not null check(markup>=0 and markup::text not in ('NaN','Infinity','-Infinity')),sale_price numeric(14,2) not null default 0,highest_cost numeric(14,4) not null default 0,track_expiry boolean not null default false,inventory_item_id uuid,unique(workspace_id,code));
create table clinic_reception.locations(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),name text not null,inventory_location_id uuid,unique(workspace_id,name));
create table clinic_reception.suppliers(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),name text not null,inventory_supplier_id uuid,unique(workspace_id,name));
create table clinic_reception.purchases(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),supplier_id uuid not null references clinic_reception.suppliers(id),reference text not null,created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),status text not null default 'pending' check(status in ('pending','approved','rejected')),note text not null,created_at timestamptz not null default now(),unique(workspace_id,supplier_id,reference));
create table clinic_reception.purchase_lines(id uuid primary key default gen_random_uuid(),purchase_id uuid not null references clinic_reception.purchases(id),item_id uuid not null references clinic_reception.items(id),quantity numeric(14,3) not null check(quantity>0),unit_cost numeric(14,4) not null check(unit_cost>=0),received numeric(14,3) not null default 0 check(received>=0 and received<=quantity),unique(purchase_id,item_id));
create table clinic_reception.lots(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),item_id uuid not null references clinic_reception.items(id),purchase_line_id uuid references clinic_reception.purchase_lines(id),number text not null default '',expiry_date date,unit_cost numeric(14,4) not null check(unit_cost>=0),inventory_lot_id uuid,received_at timestamptz not null default now());
create table clinic_reception.movements(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),item_id uuid not null references clinic_reception.items(id),location_id uuid not null references clinic_reception.locations(id),lot_id uuid not null references clinic_reception.lots(id),kind text not null check(kind in ('receipt','transfer_out','transfer_in','included','sale','waste','count')),quantity numeric(14,3) not null check(quantity<>0),unit_cost numeric(14,4) not null,sale_price numeric(14,2) not null default 0,source_id uuid,actor_id uuid not null references public.admins(id),created_at timestamptz not null default now());
create index on clinic_reception.movements(workspace_id,item_id,location_id,lot_id);
create table clinic_reception.journal(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),source text not null,source_id uuid not null,description text not null,dimensions jsonb not null default '{}',actor_id uuid not null references public.admins(id),created_at timestamptz not null default now(),finance_entry_id uuid,unique(workspace_id,source,source_id));
create table clinic_reception.journal_lines(entry_id uuid not null references clinic_reception.journal(id),account text not null,debit numeric(14,2) not null check(debit>=0),credit numeric(14,2) not null check(credit>=0),check(debit=0 or credit=0));
create index on clinic_reception.journal_lines(entry_id,account);
create table clinic_reception.registers(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),name text not null,direction text not null check(direction in ('receive','pay','both')),unique(workspace_id,name));
create table clinic_reception.shifts(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),register_id uuid not null references clinic_reception.registers(id),cashier_id uuid not null references public.admins(id),status text not null default 'open' check(status in ('open','submitted','reviewed')),opened_at timestamptz not null default now(),closed_at timestamptz,counted numeric(14,2),expected numeric(14,2),difference numeric(14,2),reviewed_by uuid references public.admins(id),review_note text);
create unique index on clinic_reception.shifts(register_id) where status<>'reviewed';
create unique index on clinic_reception.shifts(workspace_id,cashier_id) where status<>'reviewed';
create table clinic_reception.devices(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),code text not null,name text not null,meter_kind text not null check(meter_kind in ('shots','hours','none')),asset_key text,unique(workspace_id,code));
create table clinic_reception.device_uses(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),device_id uuid not null references clinic_reception.devices(id),order_id uuid not null unique references clinic_reception.orders(id),minutes integer not null check(minutes>0),meter_before numeric,meter_after numeric,check(meter_after>=meter_before),created_at timestamptz not null default now());
create table clinic_reception.doctor_agreements(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),provider_id uuid not null references clinic_reception.providers(id),service_code text not null,rate numeric(8,4) not null check(rate between 0 and 100),deduct_material_cost boolean not null default false,valid_from date not null,valid_to date not null,reference text not null,status text not null default 'pending' check(status in ('pending','active','rejected')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),finance_contract_id uuid,check(valid_to>=valid_from));
create table clinic_reception.package_templates(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),code text not null,name text not null,version integer not null,price numeric(14,2) not null check(price>0),visits integer not null check(visits between 1 and 365),validity_days integer not null check(validity_days between 1 and 3650),terms text not null,active boolean not null default true,unique(workspace_id,code,version));
create unique index on clinic_reception.package_templates(workspace_id,code) where active;
create table clinic_reception.template_lines(id uuid primary key default gen_random_uuid(),template_id uuid not null references clinic_reception.package_templates(id),visit_no integer not null check(visit_no>0),service_id uuid not null references clinic_reception.services(id),quantity numeric(14,3) not null check(quantity>0),standalone_price numeric(14,2) not null check(standalone_price>0),service_snapshot jsonb not null,unique(template_id,visit_no,service_id));
create table clinic_reception.packages(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),patient_id uuid not null references clinic_reception.patients(id),template_id uuid not null references clinic_reception.package_templates(id),name text not null,contract_price numeric(14,2) not null,visits integer not null,purchased_at timestamptz not null default now(),expires_on date not null,terms text not null,funded numeric(14,2) not null default 0,recognized numeric(14,2) not null default 0,status text not null default 'active' check(status in ('active','frozen','closed')),created_by uuid not null references public.admins(id),check(funded>=recognized and funded<=contract_price));
create table clinic_reception.entitlements(id uuid primary key default gen_random_uuid(),package_id uuid not null references clinic_reception.packages(id),visit_no integer not null,service_id uuid not null references clinic_reception.services(id),quantity numeric(14,3) not null,used numeric(14,3) not null default 0,allocated_value numeric(14,2) not null,recognized numeric(14,2) not null default 0,snapshot jsonb not null,check(used>=0 and used<=quantity),check(recognized>=0 and recognized<=allocated_value),unique(package_id,visit_no,service_id));
alter table clinic_reception.appointments add column package_id uuid references clinic_reception.packages(id),add column package_visit_no integer;
alter table clinic_reception.orders add column entitlement_id uuid references clinic_reception.entitlements(id),add column agreement_id uuid references clinic_reception.doctor_agreements(id),add column cost numeric(14,2) not null default 0,add column doctor_fee numeric(14,2) not null default 0,add column net_revenue numeric(14,2) not null default 0,add column executed_by uuid references public.admins(id);
create table clinic_reception.invoices(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),patient_id uuid not null references clinic_reception.patients(id),visit_id uuid references clinic_reception.visits(id),order_id uuid unique references clinic_reception.orders(id),package_id uuid references clinic_reception.packages(id),kind text not null check(kind in ('service','installment')),amount numeric(14,2) not null check(amount>0),payer_amount numeric(14,2) not null default 0,created_at timestamptz not null default now(),finance_invoice_id uuid,description text not null);
create table clinic_reception.payments(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),patient_id uuid not null references clinic_reception.patients(id),package_id uuid references clinic_reception.packages(id),method text not null check(method in ('cash','pos','bank','instapay','wallet')),shift_id uuid references clinic_reception.shifts(id),amount numeric(14,2) not null check(amount>0),credit_amount numeric(14,2) not null default 0,reference text not null,created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),finance_payment_id uuid);
create unique index on clinic_reception.payments(workspace_id,(case when method in ('bank','instapay') then 'bank' else method end),reference);
create table clinic_reception.allocations(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),invoice_id uuid not null references clinic_reception.invoices(id),payment_id uuid references clinic_reception.payments(id),source text not null check(source in ('payment','package','credit')),amount numeric(14,2) not null check(amount>0),created_at timestamptz not null default now());
create table clinic_reception.installments(id uuid primary key default gen_random_uuid(),package_id uuid not null references clinic_reception.packages(id),due_on date not null,amount numeric(14,2) not null check(amount>0),invoice_id uuid references clinic_reception.invoices(id),unconditional boolean not null default false,created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id));
create table clinic_reception.discount_requests(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),order_id uuid not null references clinic_reception.orders(id),percent numeric(5,2) not null check(percent between 0 and 100),reason text not null,created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),status text not null default 'pending' check(status in ('pending','approved','rejected')));
create or replace function clinic_reception.number(p_value text,p_scale integer default 2,p_allow_zero boolean default false) returns numeric language plpgsql immutable set search_path=pg_catalog as $$declare n numeric;begin n:=nullif(p_value,'')::numeric;if n is null or n::text in ('NaN','Infinity','-Infinity') or n<0 or not p_allow_zero and n=0 or n<>round(n,p_scale) then raise exception 'راجع القيمة والوحدة والدقة';end if;return n;end $$;
create or replace function clinic_reception.post(p_workspace uuid,p_source text,p_id uuid,p_description text,p_debit text,p_credit text,p_amount numeric,p_dimensions jsonb default '{}') returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v uuid;
begin
 if p_amount=0 then return null;end if;
 perform clinic_reception.number(p_amount::text);
 if exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then raise exception 'الربط المالي الفعلي لم يعتمد بعد';end if;
 insert into clinic_reception.journal(workspace_id,source,source_id,description,dimensions,actor_id) values(p_workspace,p_source,p_id,p_description,p_dimensions,public.my_admin_id()) returning id into v;
 insert into clinic_reception.journal_lines values(v,p_debit,p_amount,0),(v,p_credit,0,p_amount);return v;
end $$;
create or replace function clinic_reception.balance(p_workspace uuid,p_account text,p_dimension text default null,p_value text default null) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select coalesce(sum(l.debit-l.credit),0) from clinic_reception.journal_lines l join clinic_reception.journal j on j.id=l.entry_id where j.workspace_id=p_workspace and l.account=p_account and (p_dimension is null or j.dimensions->>p_dimension=p_value)$$;
create or replace function clinic_reception.due(p_invoice uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select i.amount-i.payer_amount-coalesce((select sum(amount) from clinic_reception.allocations where invoice_id=i.id),0) from clinic_reception.invoices i where i.id=p_invoice$$;
create or replace function clinic_reception.consume(p_workspace uuid,p_item uuid,p_location uuid,p_quantity numeric,p_kind text,p_source uuid) returns numeric language plpgsql security definer set search_path=pg_catalog,public as $$
declare l record;remaining numeric:=p_quantity;q numeric;total numeric:=0;v uuid;price numeric;dims jsonb;
begin
 perform clinic_reception.number(p_quantity::text,3);
 if not exists(select 1 from clinic_reception.items where id=p_item and workspace_id=p_workspace) or not exists(select 1 from clinic_reception.locations where id=p_location and workspace_id=p_workspace) then raise exception 'الصنف أو المخزن خارج المساحة';end if;
 select sale_price into price from clinic_reception.items where id=p_item;
 for l in select lot.id,lot.unit_cost,sum(m.quantity) quantity from clinic_reception.lots lot join clinic_reception.movements m on m.lot_id=lot.id where lot.workspace_id=p_workspace and lot.item_id=p_item and m.location_id=p_location and (p_kind='waste' or lot.expiry_date is null or lot.expiry_date>=current_date) group by lot.id having sum(m.quantity)>0 order by lot.expiry_date nulls last,lot.received_at,lot.id loop
  q:=least(remaining,l.quantity);insert into clinic_reception.movements(workspace_id,item_id,location_id,lot_id,kind,quantity,unit_cost,sale_price,source_id,actor_id) values(p_workspace,p_item,p_location,l.id,p_kind,-q,l.unit_cost,case when p_kind='sale' then price else 0 end,p_source,public.my_admin_id()) returning id into v;
  dims:=jsonb_build_object('order_id',p_source,'item_id',p_item,'location_id',p_location);
  if p_kind in ('included','sale','waste') then perform clinic_reception.post(p_workspace,'stock_cost',v,'تكلفة صرف مستلزمات',case p_kind when 'included' then '5123' when 'sale' then '5121' else '5217' end,'1131',round(q*l.unit_cost,2),dims);end if;
  total:=total+round(q*l.unit_cost,2);remaining:=remaining-q;exit when remaining=0;
 end loop;
 if remaining>0 then raise exception 'المخزون المتاح غير كاف أو منتهي الصلاحية';end if;return total;
end $$;
-- Keep original guarded booking and snapshot implementations private.
alter function public.clinic_reception_command(uuid,text,jsonb,uuid) set schema clinic_reception;
alter function clinic_reception.clinic_reception_command(uuid,text,jsonb,uuid) rename to workspace_command;
alter function public.clinic_reception_snapshot(uuid,date,date) set schema clinic_reception;
alter function clinic_reception.clinic_reception_snapshot(uuid,date,date) rename to workspace_snapshot;
create or replace function clinic_reception.catalog_operation(p_workspace uuid,p_action text,p_payload jsonb,p_me uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v uuid;line jsonb;item clinic_reception.items%rowtype;purchase clinic_reception.purchases%rowtype;pl clinic_reception.purchase_lines%rowtype;lot uuid;q numeric;c numeric;location uuid;version_no integer;total numeric;tp clinic_reception.package_templates%rowtype;s clinic_reception.services%rowtype;a clinic_reception.doctor_agreements%rowtype;approved boolean;current_cost numeric;dest uuid;m record;
begin
 if p_action in ('item','location','supplier','register','device','template') and length(trim(coalesce(p_payload->>'name','')))<2 then raise exception 'أدخل اسمًا واضحًا';end if;
 if p_action in ('item','device','template') and length(trim(coalesce(p_payload->>'code','')))<2 then raise exception 'أدخل كودًا واضحًا';end if;
 if p_action='item' then
  insert into clinic_reception.items(workspace_id,code,name,unit,markup,track_expiry) values(p_workspace,trim(p_payload->>'code'),trim(p_payload->>'name'),trim(p_payload->>'unit'),clinic_reception.number(p_payload->>'markup',4,true),coalesce((p_payload->>'track_expiry')::boolean,false)) returning id into v;
 elsif p_action='location' then insert into clinic_reception.locations(workspace_id,name) values(p_workspace,trim(p_payload->>'name')) returning id into v;
 elsif p_action='supplier' then insert into clinic_reception.suppliers(workspace_id,name) values(p_workspace,trim(p_payload->>'name')) returning id into v;
 elsif p_action='register' then insert into clinic_reception.registers(workspace_id,name,direction) values(p_workspace,trim(p_payload->>'name'),p_payload->>'direction') returning id into v;
 elsif p_action='device' then insert into clinic_reception.devices(workspace_id,code,name,meter_kind,asset_key) values(p_workspace,trim(p_payload->>'code'),trim(p_payload->>'name'),p_payload->>'meter_kind',nullif(p_payload->>'asset_key','')) returning id into v;
 elsif p_action='agreement' then
  if not exists(select 1 from clinic_reception.providers where workspace_id=p_workspace and id=(p_payload->>'provider_id')::uuid) or not exists(select 1 from clinic_reception.services where workspace_id=p_workspace and code=p_payload->>'service_code' and active) then raise exception 'راجع الطبيب والخدمة';end if;
  insert into clinic_reception.doctor_agreements(workspace_id,provider_id,service_code,rate,deduct_material_cost,valid_from,valid_to,reference,created_by) values(p_workspace,(p_payload->>'provider_id')::uuid,p_payload->>'service_code',clinic_reception.number(p_payload->>'rate',4,true),coalesce((p_payload->>'deduct_material_cost')::boolean,false),(p_payload->>'from')::date,(p_payload->>'to')::date,trim(p_payload->>'reference'),p_me) returning id into v;
 elsif p_action='agreement_review' then
  select * into a from clinic_reception.doctor_agreements where id=(p_payload->>'id')::uuid and workspace_id=p_workspace for update;approved:=(p_payload->>'approve')::boolean;
  if not found or a.created_by=p_me or a.status<>'pending' or approved is null then raise exception 'العقد يحتاج مراجعة شخص آخر';end if;
  if approved and exists(select 1 from clinic_reception.doctor_agreements where workspace_id=p_workspace and provider_id=a.provider_id and service_code=a.service_code and status='active' and valid_from<=a.valid_to and valid_to>=a.valid_from) then raise exception 'عقد متداخل لنفس الخدمة';end if;
  update clinic_reception.doctor_agreements set status=case when approved then 'active' else 'rejected' end,reviewed_by=p_me where id=a.id;v:=a.id;
 elsif p_action='purchase' then
  if not exists(select 1 from clinic_reception.suppliers where id=(p_payload->>'supplier_id')::uuid and workspace_id=p_workspace) or length(trim(coalesce(p_payload->>'reference','')))<2 or jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 50 then raise exception 'راجع المورد ورقم الفاتورة والبنود';end if;
  insert into clinic_reception.purchases(workspace_id,supplier_id,reference,note,created_by) values(p_workspace,(p_payload->>'supplier_id')::uuid,trim(p_payload->>'reference'),coalesce(p_payload->>'note',''),p_me) returning id into v;
  for line in select * from jsonb_array_elements(p_payload->'lines') loop
   if not exists(select 1 from clinic_reception.items where id=(line->>'item_id')::uuid and workspace_id=p_workspace) then raise exception 'الصنف خارج المساحة';end if;
   insert into clinic_reception.purchase_lines(purchase_id,item_id,quantity,unit_cost) values(v,(line->>'item_id')::uuid,clinic_reception.number(line->>'quantity',3),clinic_reception.number(line->>'unit_cost',4,true));
  end loop;
 elsif p_action='purchase_review' then
  select * into purchase from clinic_reception.purchases where workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;approved:=(p_payload->>'approve')::boolean;
  if not found or purchase.created_by=p_me or purchase.status<>'pending' or approved is null then raise exception 'الشراء يحتاج مراجعة شخص آخر';end if;
  update clinic_reception.purchases set status=case when approved then 'approved' else 'rejected' end,reviewed_by=p_me where id=purchase.id;v:=purchase.id;
 elsif p_action='receive_purchase' then
  select * into purchase from clinic_reception.purchases where workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;
  if not found or purchase.status<>'approved' then raise exception 'الشراء غير معتمد';end if;
  location:=(p_payload->>'location_id')::uuid;if not exists(select 1 from clinic_reception.locations where id=location and workspace_id=p_workspace) then raise exception 'راجع مخزن الاستلام';end if;
  if jsonb_array_length(coalesce(p_payload->'lines','[]'))=0 then raise exception 'أدخل الكميات المستلمة';end if;
  for line in select * from jsonb_array_elements(p_payload->'lines') loop
   select * into pl from clinic_reception.purchase_lines where purchase_id=purchase.id and id=(line->>'line_id')::uuid for update;
   if not found then raise exception 'البند خارج أمر الشراء';end if;
   q:=clinic_reception.number(line->>'quantity',3);if pl.received+q>pl.quantity then raise exception 'الاستلام يتجاوز الكمية المعتمدة';end if;
   select * into item from clinic_reception.items where id=pl.item_id;
   if nullif(line->>'expiry_date','')::date<current_date or item.track_expiry and (nullif(line->>'expiry_date','') is null or nullif(line->>'lot_number','') is null) then raise exception 'راجع التشغيلة والصلاحية';end if;
   insert into clinic_reception.lots(workspace_id,item_id,purchase_line_id,number,expiry_date,unit_cost) values(p_workspace,item.id,pl.id,coalesce(line->>'lot_number',''),nullif(line->>'expiry_date','')::date,pl.unit_cost) returning id into lot;
   insert into clinic_reception.movements(workspace_id,item_id,location_id,lot_id,kind,quantity,unit_cost,source_id,actor_id) values(p_workspace,item.id,location,lot,'receipt',q,pl.unit_cost,purchase.id,p_me) returning id into v;
   perform clinic_reception.post(p_workspace,'purchase',v,'استلام فاتورة مورد '||purchase.reference,'1131','2111',round(q*pl.unit_cost,2),jsonb_build_object('supplier_id',purchase.supplier_id,'item_id',item.id,'location_id',location));
   update clinic_reception.purchase_lines set received=received+q where id=pl.id;
   current_cost:=greatest(item.highest_cost,pl.unit_cost);
   update clinic_reception.items set highest_cost=current_cost,sale_price=round(current_cost*(1+markup/100),2) where id=item.id;
  end loop;
  v:=purchase.id;
 elsif p_action='template' then
  if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 300 or length(trim(coalesce(p_payload->>'terms','')))<3 then raise exception 'أدخل الخدمات وشروط الباكج';end if;
  select coalesce(max(version),0)+1 into version_no from clinic_reception.package_templates where workspace_id=p_workspace and code=p_payload->>'code';
  update clinic_reception.package_templates set active=false where workspace_id=p_workspace and code=p_payload->>'code' and active;
  insert into clinic_reception.package_templates(workspace_id,code,name,version,price,visits,validity_days,terms) values(p_workspace,p_payload->>'code',p_payload->>'name',version_no,clinic_reception.number(p_payload->>'price'),(p_payload->>'visits')::integer,(p_payload->>'validity_days')::integer,p_payload->>'terms') returning id into v;
  select * into tp from clinic_reception.package_templates where id=v;
  for line in select * from jsonb_array_elements(p_payload->'lines') loop
   select * into s from clinic_reception.services where id=(line->>'service_id')::uuid and workspace_id=p_workspace and active;
   if not found or s.price<=0 or (line->>'visit_no')::integer>tp.visits then raise exception 'راجع خدمة ورقم زيارة الباكج';end if;
   insert into clinic_reception.template_lines(template_id,visit_no,service_id,quantity,standalone_price,service_snapshot) values(v,(line->>'visit_no')::integer,s.id,clinic_reception.number(line->>'quantity',3),s.price,to_jsonb(s));
  end loop;
  if (select count(distinct visit_no) from clinic_reception.template_lines where template_id=v)<>tp.visits then raise exception 'حدد خدمات كل زيارة في الباكج';end if;
 elsif p_action='transfer' then
  raise exception 'استخدم طلب تحويل معتمد واستلام مستقل';
  location:=(p_payload->>'source_id')::uuid;dest:=(p_payload->>'destination_id')::uuid;
  if dest=location or not exists(select 1 from clinic_reception.locations where workspace_id=p_workspace and id=dest) then raise exception 'راجع مخزن الوجهة';end if;
  v:=gen_random_uuid();perform clinic_reception.consume(p_workspace,(p_payload->>'item_id')::uuid,location,clinic_reception.number(p_payload->>'quantity',3),'transfer_out',v);
  for m in select * from clinic_reception.movements where source_id=v and kind='transfer_out' loop insert into clinic_reception.movements(workspace_id,item_id,location_id,lot_id,kind,quantity,unit_cost,source_id,actor_id) values(p_workspace,m.item_id,dest,m.lot_id,'transfer_in',-m.quantity,m.unit_cost,v,p_me);end loop;
 else raise exception 'إجراء إعداد غير معروف';end if;
 return jsonb_build_object('id',v);
end $$;
create or replace function clinic_reception.service_operation(p_workspace uuid,p_action text,p_payload jsonb,p_me uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
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
  insert into clinic_reception.packages(workspace_id,patient_id,template_id,name,contract_price,visits,expires_on,terms,created_by) values(p_workspace,(p_payload->>'patient_id')::uuid,tp.id,tp.name,tp.price,tp.visits,current_date+tp.validity_days,tp.terms,p_me) returning id into v;
  select sum(quantity*standalone_price),count(*) into sum_price,remaining from clinic_reception.template_lines where template_id=tp.id;
  for line in select * from clinic_reception.template_lines where template_id=tp.id order by visit_no,id loop
   n:=n+1;value:=case when n=remaining then tp.price-allocated else round(tp.price*line.quantity*line.standalone_price/sum_price,2) end;allocated:=allocated+value;
   insert into clinic_reception.entitlements(package_id,visit_no,service_id,quantity,allocated_value,snapshot) values(v,line.visit_no,line.service_id,line.quantity,value,line.service_snapshot);
  end loop;
  -- An optional schedule is a reminder/contract term, not automatically an unconditional receivable.
  if p_payload?'installments' then
   if jsonb_typeof(p_payload->'installments') is distinct from 'array' then raise exception 'راجع جدول الأقساط';end if;
   value:=0;for material in select * from jsonb_array_elements(p_payload->'installments') loop
    percent:=clinic_reception.number(material->>'amount');value:=value+percent;
    insert into clinic_reception.installments(package_id,due_on,amount,unconditional,created_by) values(v,(material->>'due_on')::date,percent,false,p_me);
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
  if not found or not exists(select 1 from clinic_reception.providers where id=(p_payload->>'provider_id')::uuid and workspace_id=p_workspace and active and department=s.department) then raise exception 'راجع الخدمة وطبيبها';end if;
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
  if not exists(select 1 from clinic_reception.providers where id=o.provider_id and workspace_id=p_workspace and active and department=o.snapshot->>'department') then raise exception 'حدد الطبيب المنفذ من تخصص الخدمة';end if;
  select * into agreement from clinic_reception.doctor_agreements where workspace_id=p_workspace and provider_id=o.provider_id and service_code=o.snapshot->>'code' and status='active' and current_date between valid_from and valid_to;
  if not found then raise exception 'يلزم عقد أتعاب معتمد للخدمة المنفذة ولو بنسبة صفر';end if;
  if coalesce((o.snapshot->>'requires_device')::boolean,false) or nullif(p_payload->>'device_id','') is not null then
   select * into device from clinic_reception.devices where id=(p_payload->>'device_id')::uuid and workspace_id=p_workspace;if not found then raise exception 'حدد الجهاز المستخدم';end if;
   if device.meter_kind<>'none' and (p_payload->>'meter_before' is null or p_payload->>'meter_after' is null) then raise exception 'أدخل قراءات الجهاز';end if;
   insert into clinic_reception.device_uses(workspace_id,device_id,order_id,minutes,meter_before,meter_after) values(p_workspace,device.id,o.id,clinic_reception.number(p_payload->>'minutes',0),case when device.meter_kind<>'none' then clinic_reception.number(p_payload->>'meter_before',3,true) end,case when device.meter_kind<>'none' then clinic_reception.number(p_payload->>'meter_after',3,true) end);
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
   if extra_qty>0 then value:=clinic_reception.consume(p_workspace,item.id,(p_payload->>'location_id')::uuid,extra_qty,'sale',o.id);v_cost:=v_cost+value;extra:=extra+round(extra_qty*item.sale_price,2);end if;
  end loop;
  gross:=round(o.price*o.quantity,2);discount:=round(gross*o.discount/100,2);net:=gross-discount;
  if o.entitlement_id is not null then
   select * into en from clinic_reception.entitlements where id=o.entitlement_id for update;select * into pkg from clinic_reception.packages where id=en.package_id and workspace_id=p_workspace for update;
   if pkg.status<>'active' or pkg.expires_on<current_date or en.used+o.quantity>en.quantity then raise exception 'رصيد الباكج غير متاح';end if;
   net:=case when en.used+o.quantity=en.quantity then en.allocated_value-en.recognized else round(en.allocated_value*o.quantity/en.quantity,2) end;gross:=net;discount:=0;
  end if;
  if net+extra<=0 then raise exception 'قيمة الخدمة غير صالحة';end if;
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
  if not exists(select 1 from clinic_reception.orders where visit_id=visit.id and status='ordered') then update clinic_reception.visits set status='completed',closed_at=now() where id=visit.id;update clinic_reception.appointments set status='completed' where id=visit.appointment_id;end if;
  v:=invoice;
 else raise exception 'إجراء خدمات غير معروف';end if;
 return jsonb_build_object('id',v);
end $$;
create or replace function clinic_reception.payment_operation(p_workspace uuid,p_action text,p_payload jsonb,p_me uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v uuid;patient uuid;pkg clinic_reception.packages%rowtype;i clinic_reception.invoices%rowtype;shift clinic_reception.shifts%rowtype;reg clinic_reception.registers%rowtype;amount numeric;leftover numeric;applied numeric;credit numeric:=0;allocation_id uuid;account text;method text:=p_payload->>'method';dims jsonb;n numeric;
begin
 if p_action='shift_open' then
  select * into reg from clinic_reception.registers where workspace_id=p_workspace and id=(p_payload->>'register_id')::uuid;if not found then raise exception 'الخزينة غير متاحة';end if;
  insert into clinic_reception.shifts(workspace_id,register_id,cashier_id) values(p_workspace,reg.id,p_me) returning id into v;
 elsif p_action='collect' then
  patient:=(p_payload->>'patient_id')::uuid;amount:=clinic_reception.number(p_payload->>'amount');leftover:=amount;
  if not exists(select 1 from clinic_reception.patients where id=patient and workspace_id=p_workspace) or method is null or method not in ('cash','pos','bank','instapay','wallet') or length(trim(coalesce(p_payload->>'reference','')))<2 then raise exception 'راجع المريض وطريقة السداد ومرجع العملية';end if;
  if method in ('cash','pos') then
   select * into shift from clinic_reception.shifts where id=(p_payload->>'shift_id')::uuid and workspace_id=p_workspace and cashier_id=p_me and status='open' for update;
   if not found then raise exception 'اختر وردية مفتوحة تخصك';end if;
   select * into reg from clinic_reception.registers where id=shift.register_id;if reg.direction='pay' then raise exception 'الخزينة للصرف فقط';end if;
  end if;
  account:=case method when 'cash' then '1111' when 'pos' then '1114' when 'wallet' then '1115' else '1112' end;
  if nullif(p_payload->>'package_id','') is not null then
   select * into pkg from clinic_reception.packages where id=(p_payload->>'package_id')::uuid and patient_id=patient and workspace_id=p_workspace for update;
   if not found or pkg.status<>'active' then raise exception 'الباكج خارج ملف المريض أو غير متاح';end if;
  end if;
  if nullif(p_payload->>'invoice_id','') is not null then
   select * into i from clinic_reception.invoices where id=(p_payload->>'invoice_id')::uuid and patient_id=patient and workspace_id=p_workspace for update;if not found then raise exception 'الفاتورة خارج ملف المريض';end if;
   if pkg.id is not null and i.package_id is distinct from pkg.id then raise exception 'الفاتورة لا تخص الباكج المختار';end if;
   if i.package_id is not null and pkg.id is null then select * into pkg from clinic_reception.packages where id=i.package_id for update;end if;
  end if;
  insert into clinic_reception.payments(workspace_id,patient_id,package_id,method,shift_id,amount,reference,created_by) values(p_workspace,patient,pkg.id,method,shift.id,amount,trim(p_payload->>'reference'),p_me) returning id into v;
  dims:=jsonb_build_object('patient_id',patient,'package_id',pkg.id,'payment_id',v,'shift_id',shift.id);
  if i.id is not null then
   applied:=least(leftover,clinic_reception.due(i.id));if applied>0 then insert into clinic_reception.allocations(workspace_id,invoice_id,payment_id,source,amount) values(p_workspace,i.id,v,'payment',applied);perform clinic_reception.post(p_workspace,'invoice_payment',v,'تحصيل فاتورة',account,'1122',applied,dims||jsonb_build_object('invoice_id',i.id));leftover:=leftover-applied;end if;
  elsif pkg.id is not null then
   for i in select * from clinic_reception.invoices where package_id=pkg.id and workspace_id=p_workspace order by created_at,id for update loop
    applied:=least(leftover,clinic_reception.due(i.id));if applied>0 then insert into clinic_reception.allocations(workspace_id,invoice_id,payment_id,source,amount) values(p_workspace,i.id,v,'payment',applied) returning id into allocation_id;perform clinic_reception.post(p_workspace,'package_ar_payment',allocation_id,'تحصيل مستحق باكج',account,'1122',applied,dims||jsonb_build_object('invoice_id',i.id));leftover:=leftover-applied;end if;exit when leftover=0;
   end loop;
   if leftover>0 then applied:=least(leftover,pkg.contract_price-pkg.funded);if applied>0 then perform clinic_reception.post(p_workspace,'package_payment',v,'مبلغ مقدم للباكج',account,'2151',applied,dims);update clinic_reception.packages set funded=funded+applied where id=pkg.id;leftover:=leftover-applied;end if;end if;
  end if;
  if leftover>0 then perform clinic_reception.post(p_workspace,'patient_credit',v,'رصيد لصالح المريض',account,'2150',leftover,dims);update clinic_reception.payments set credit_amount=leftover where id=v;end if;
 elsif p_action='credit_apply' then
  select * into i from clinic_reception.invoices where id=(p_payload->>'invoice_id')::uuid and workspace_id=p_workspace for update;if not found then raise exception 'الفاتورة غير متاحة';end if;
  amount:=clinic_reception.number(p_payload->>'amount');credit:=-clinic_reception.balance(p_workspace,'2150','patient_id',i.patient_id::text);
  if amount>credit or amount>clinic_reception.due(i.id) then raise exception 'القيمة تتجاوز الرصيد أو المديونية';end if;
  insert into clinic_reception.allocations(workspace_id,invoice_id,source,amount) values(p_workspace,i.id,'credit',amount) returning id into v;
  perform clinic_reception.post(p_workspace,'credit_apply',v,'استخدام رصيد المريض','2150','1122',amount,jsonb_build_object('patient_id',i.patient_id,'invoice_id',i.id));
 elsif p_action='shift_close' then
  select * into shift from clinic_reception.shifts where workspace_id=p_workspace and id=(p_payload->>'id')::uuid and cashier_id=p_me and status='open' for update;if not found then raise exception 'الوردية غير متاحة للإغلاق';end if;
  amount:=clinic_reception.number(p_payload->>'counted',2,true);n:=clinic_reception.balance(p_workspace,'1111','shift_id',shift.id::text);
  update clinic_reception.shifts set status='submitted',closed_at=now(),counted=amount,expected=n,difference=amount-n where id=shift.id;v:=shift.id;
 elsif p_action='shift_review' then
  select * into shift from clinic_reception.shifts where workspace_id=p_workspace and id=(p_payload->>'id')::uuid and status='submitted' for update;
  if not found or shift.cashier_id=p_me or length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'الوردية تحتاج مراجعة شخص آخر ونتيجة المراجعة';end if;
  update clinic_reception.shifts set status='reviewed',reviewed_by=p_me,review_note=p_payload->>'note' where id=shift.id;v:=shift.id;
 else raise exception 'إجراء سداد غير معروف';end if;
 return jsonb_build_object('id',v);
end $$;
create or replace function public.clinic_reception_workspaces() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();begin
 if me is null or not exists(select 1 from public.admins where id=me and active) then raise exception 'سجل الدخول' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'mode',w.mode,'is_owner',w.owner_id=me)),'[]') from clinic_reception.workspaces w where (w.owner_id=me or exists(select 1 from clinic_reception.members where workspace_id=w.id and admin_id=me and cardinality(capabilities)>0)) and (w.mode='trial' or (select live_enabled from clinic_reception.settings where id)));
end $$;
create or replace function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;w clinic_reception.workspaces%rowtype;previous clinic_reception.commands%rowtype;outcome jsonb;pkg clinic_reception.packages%rowtype;en record;a clinic_reception.appointments%rowtype;v uuid;n integer;material jsonb;
begin
 me:=clinic_reception.access(p_workspace,case when p_action in ('provider','service','availability','item','location','supplier','register','device','agreement','purchase','template','member') then 'manage' when p_action in ('agreement_review','purchase_review','discount_review','shift_review','installment_bill') then 'review' when p_action in ('execute','order_cancel','order_add') then 'execute' when p_action in ('collect','credit_apply','shift_open','shift_close') then 'collect' when p_action in ('transfer','receive_purchase') then 'warehouse' else 'book' end);
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>60000 then raise exception 'طلب غير صالح';end if;
 select * into w from clinic_reception.workspaces where id=p_workspace for update;
 select * into previous from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
 if found then if previous.action<>p_action or previous.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;return previous.response;end if;
 if p_action in ('patient','provider','service','availability','book','reschedule','arrive','cancel','no_show') then
  if p_action='service' then
   if jsonb_typeof(coalesce(p_payload->'bom','[]')) is distinct from 'array' then raise exception 'راجع مكونات الخدمة';end if;
   if exists(select 1 from jsonb_array_elements(coalesce(p_payload->'bom','[]')) x group by x->>'item_id' having count(*)>1) then raise exception 'المكون مكرر';end if;
   for material in select * from jsonb_array_elements(coalesce(p_payload->'bom','[]')) loop
    if not exists(select 1 from clinic_reception.items where id=(material->>'item_id')::uuid and workspace_id=p_workspace) then raise exception 'مكون خارج المخزن';end if;
    perform clinic_reception.number(material->>'quantity',3);
   end loop;
  end if;
  if p_action='reschedule' and exists(select 1 from clinic_reception.appointments where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and package_id is not null) and nullif(p_payload->>'package_id','') is null then raise exception 'احتفظ بربط الباكج عند تغيير الموعد';end if;
  if p_action in ('book','reschedule') and nullif(p_payload->>'package_id','') is not null then
   select * into pkg from clinic_reception.packages where id=(p_payload->>'package_id')::uuid and workspace_id=p_workspace and patient_id=(p_payload->>'patient_id')::uuid for update;
   n:=(p_payload->>'package_visit_no')::integer;
   if not found or pkg.status<>'active' or pkg.expires_on<((p_payload->>'starts_at')::timestamptz at time zone 'Africa/Cairo')::date or n is null or not exists(select 1 from clinic_reception.entitlements where package_id=pkg.id and visit_no=n and used<quantity) then raise exception 'راجع رصيد الباكج ورقم زيارته وصلاحيته';end if;
   if not exists(select 1 from clinic_reception.entitlements e join clinic_reception.services ss on ss.id=(p_payload->>'service_id')::uuid where e.package_id=pkg.id and e.visit_no=n and e.used<e.quantity and e.snapshot->>'code'=ss.code) then raise exception 'الخدمة ليست ضمن زيارة الباكج';end if;
   if exists(select 1 from clinic_reception.appointments where workspace_id=p_workspace and package_id=pkg.id and package_visit_no=n and status in ('booked','arrived') and id is distinct from nullif(p_payload->>'id','')::uuid) then raise exception 'زيارة الباكج محجوزة بالفعل';end if;
  end if;
  outcome:=clinic_reception.workspace_command(p_workspace,p_action,p_payload,p_token);v:=(outcome->>'id')::uuid;
  if p_action in ('book','reschedule') and pkg.id is not null then update clinic_reception.appointments set package_id=pkg.id,package_visit_no=n where id=v;end if;
  if p_action='arrive' then
   select a0.* into a from clinic_reception.appointments a0 join clinic_reception.visits vv on vv.appointment_id=a0.id where vv.id=v;
   if a.package_id is not null and not exists(select 1 from clinic_reception.orders where visit_id=v and entitlement_id is not null) then
    delete from clinic_reception.orders where visit_id=v and status='ordered';
    for en in select * from clinic_reception.entitlements where package_id=a.package_id and visit_no=a.package_visit_no and used<quantity loop
     insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,quantity,price,snapshot,created_by,entitlement_id) values(p_workspace,v,en.service_id,a.provider_id,en.quantity-en.used,(en.allocated_value-en.recognized)/(en.quantity-en.used),en.snapshot,me,en.id);
    end loop;
   end if;
  end if;
  return outcome;
 elsif p_action in ('item','location','supplier','register','device','agreement','agreement_review','purchase','purchase_review','receive_purchase','template','transfer') then
  if p_action='receive_purchase' then perform clinic_reception.access(p_workspace,'warehouse');end if;
  outcome:=clinic_reception.catalog_operation(p_workspace,p_action,p_payload,me);
 elsif p_action in ('package_sell','installment_bill','order_add','order_cancel','execute','discount','discount_review','member') then outcome:=clinic_reception.service_operation(p_workspace,p_action,p_payload,me);
 elsif p_action in ('collect','credit_apply','shift_open','shift_close','shift_review') then outcome:=clinic_reception.payment_operation(p_workspace,p_action,p_payload,me);
 else raise exception 'إجراء غير معروف';end if;
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id) values(p_workspace,me,p_action,(outcome->>'id')::uuid);
 insert into clinic_reception.commands values(p_workspace,me,p_token,p_action,p_payload,outcome);return outcome;
end $$;
create or replace function public.clinic_reception_snapshot(p_workspace uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'view');v jsonb;manager boolean;
begin
 v:=clinic_reception.workspace_snapshot(p_workspace,p_from,p_to);manager:=(v->>'can_manage')::boolean;
 if not manager then v:=jsonb_set(v,'{orders}',(select coalesce(jsonb_agg(x-'cost'-'doctor_fee'-'agreement_id'),'[]') from jsonb_array_elements(v->'orders') x));end if;
 return v||jsonb_build_object(
 'workspaces',public.clinic_reception_workspaces(),
 'people',case when manager then (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',coalesce(to_jsonb(a)->>'name',a.role))),'[]') from public.admins a where active) else '[]'::jsonb end,
 'members',case when manager then (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.members x where workspace_id=p_workspace) else '[]'::jsonb end,
 'patients',(select coalesce(jsonb_agg(to_jsonb(x)-'patient_id'||jsonb_build_object('due',clinic_reception.balance(p_workspace,'1122','patient_id',x.id::text),'credit',-clinic_reception.balance(p_workspace,'2150','patient_id',x.id::text))),'[]') from clinic_reception.patients x where workspace_id=p_workspace),
 'appointments',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('service_name',s.name)),'[]') from clinic_reception.appointments a join clinic_reception.services s on s.id=a.service_id where a.workspace_id=p_workspace and (a.starts_at at time zone 'Africa/Cairo')::date between p_from and p_to),
 'items',(select coalesce(jsonb_agg(case when manager then to_jsonb(x) else to_jsonb(x)-'highest_cost' end),'[]') from clinic_reception.items x where workspace_id=p_workspace),
 'locations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.locations x where workspace_id=p_workspace),
 'stock',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select m.item_id,m.location_id,m.lot_id,l.number,l.expiry_date,sum(m.quantity) quantity,case when manager then l.unit_cost end unit_cost from clinic_reception.movements m join clinic_reception.lots l on l.id=m.lot_id where m.workspace_id=p_workspace group by m.item_id,m.location_id,m.lot_id,l.id having sum(m.quantity)<>0)x),
 'suppliers',case when manager then (select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('balance',-clinic_reception.balance(p_workspace,'2111','supplier_id',x.id::text))),'[]') from clinic_reception.suppliers x where workspace_id=p_workspace) else '[]'::jsonb end,
 'purchases',case when manager then (select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from clinic_reception.purchase_lines l where purchase_id=x.id))),'[]') from clinic_reception.purchases x where workspace_id=p_workspace) else '[]'::jsonb end,
 'templates',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from clinic_reception.template_lines l where template_id=x.id))),'[]') from clinic_reception.package_templates x where workspace_id=p_workspace and active),
 'packages',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('paid',(select coalesce(sum(amount-credit_amount),0) from clinic_reception.payments where package_id=x.id),'due',(select coalesce(sum(clinic_reception.due(i.id)),0) from clinic_reception.invoices i where package_id=x.id),'lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from clinic_reception.entitlements l where package_id=x.id),'installments',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from clinic_reception.installments l where package_id=x.id))),'[]') from clinic_reception.packages x where workspace_id=p_workspace),
 'invoices',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('due',clinic_reception.due(x.id))),'[]') from clinic_reception.invoices x where workspace_id=p_workspace),
 'payments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.payments x where workspace_id=p_workspace and (created_at at time zone 'Africa/Cairo')::date between p_from and p_to),
 'registers',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.registers x where workspace_id=p_workspace),
 'shifts',(select coalesce(jsonb_agg(case when x.status='open' and x.cashier_id=me then to_jsonb(x)-'expected'-'difference' else to_jsonb(x) end),'[]') from clinic_reception.shifts x where workspace_id=p_workspace and (manager or cashier_id=me)),
 'agreements',case when manager then (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.doctor_agreements x where workspace_id=p_workspace) else '[]'::jsonb end,
 'discounts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.discount_requests x where workspace_id=p_workspace and (manager or created_by=me)),
 'devices',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.devices x where workspace_id=p_workspace),
 'device_uses',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.device_uses x where workspace_id=p_workspace),
 'journal',case when manager then (select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from clinic_reception.journal_lines l where entry_id=x.id))),'[]') from clinic_reception.journal x where workspace_id=p_workspace and (created_at at time zone 'Africa/Cairo')::date between p_from and p_to) else '[]'::jsonb end);
end $$;
do $$declare r record;begin
 for r in select tablename from pg_tables where schemaname='clinic_reception' loop execute format('alter table clinic_reception.%I enable row level security',r.tablename);execute format('revoke all on clinic_reception.%I from public,anon,authenticated',r.tablename);end loop;
 for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_reception' loop execute format('revoke all on function %s from public,anon,authenticated',r.sig);end loop;
end $$;
revoke all on function public.clinic_reception_workspaces(),public.clinic_reception_command(uuid,text,jsonb,uuid),public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_workspaces(),public.clinic_reception_command(uuid,text,jsonb,uuid),public.clinic_reception_snapshot(uuid,date,date) to authenticated;
commit;
