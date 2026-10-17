begin;
-- No activation or historic financial replay. These adapters run only for an explicitly enabled live workspace.
alter table clinic_reception.appointments add column device_id uuid references clinic_reception.devices(id);
alter table clinic_reception.services add column pricing_service_id uuid references public.pricing_services(id);
alter table clinic_reception.registers add column finance_register_id uuid references clinic_finance.registers(id);
alter table clinic_reception.shifts add column finance_shift_id uuid references clinic_finance.shifts(id);
alter table clinic_reception.visits add column archive_visit_id uuid references public.patient_visits(id);
alter table clinic_reception.movements add column inventory_movement_id uuid references public.inventory_movements(id);
create unique index reception_single_live_workspace on clinic_reception.workspaces((mode)) where mode='live';
create unique index reception_live_item_map on clinic_reception.items(workspace_id,inventory_item_id) where inventory_item_id is not null;
create unique index reception_live_location_map on clinic_reception.locations(workspace_id,inventory_location_id) where inventory_location_id is not null;
create unique index reception_live_lot_map on clinic_reception.lots(workspace_id,inventory_lot_id) where inventory_lot_id is not null;
create unique index reception_live_supplier_map on clinic_reception.suppliers(workspace_id,inventory_supplier_id) where inventory_supplier_id is not null;
create table clinic_reception.cutovers(id uuid primary key default gen_random_uuid(),trial_workspace_id uuid not null references clinic_reception.workspaces(id),configuration jsonb not null,configuration_hash text not null,checks jsonb not null,note text not null,created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),status text not null default 'pending' check(status in ('pending','approved','rejected')),reviewed_by uuid references public.admins(id),review_note text);
create table clinic_reception.consents(workspace_id uuid not null references clinic_reception.workspaces(id),patient_id uuid not null references clinic_reception.patients(id),allowed boolean not null,reference text not null,recorded_by uuid not null references public.admins(id),recorded_at timestamptz not null default now(),primary key(workspace_id,patient_id));
insert into clinic_finance.accounts(code,name,kind) values('2150','أرصدة دائنة للمرضى','liability'),('2151','إيرادات باكجز غير مكتسبة','liability'),('4190','خصومات خدمات معتمدة','income'),('4192','إشعارات دائنة للخدمات','income') on conflict do nothing;
create or replace function clinic_reception.account(p_code text) returns text language sql immutable set search_path=pg_catalog as $$select case p_code when '1123' then '1121' when '1193' then '1292' when '4191' then '4153' else p_code end$$;
-- A reception stock movement already has one event journal. Existing stock triggers must not post it again.
do $$declare fn regprocedure;def text;patched text;begin
 foreach fn in array array['clinic_finance.post_inventory_usage()'::regprocedure,'clinic_finance.post_waste()'::regprocedure] loop
  def:=pg_get_functiondef(fn);patched:=regexp_replace(def,'begin', 'begin if new.reference_type=''reception'' then return new;end if;', 'i');
  if def=patched then raise exception 'Missing stock posting guard %',fn;end if;execute patched;
 end loop;
end $$;
-- Preserve the old-only balance components, then include the new live service ledger exactly once.
alter function clinic_finance.doctor_balance(text) rename to legacy_doctor_balance;
create or replace function clinic_finance.doctor_balance(p_key text) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select clinic_finance.legacy_doctor_balance(p_key)+coalesce((select sum(l.credit-l.debit) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id join clinic_reception.workspaces w on w.id=j.workspace_id join clinic_reception.providers p on p.id=nullif(j.dimensions->>'provider_id','')::uuid and p.workspace_id=w.id where w.mode='live' and p.doctor_key=p_key and l.account='2120'),0)$$;
alter function clinic_finance.supplier_balance(uuid) rename to legacy_supplier_balance;
create or replace function clinic_finance.supplier_balance(p_id uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select clinic_finance.legacy_supplier_balance(p_id)+coalesce((select sum(l.credit-l.debit) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id join clinic_reception.workspaces w on w.id=j.workspace_id join clinic_reception.suppliers s on s.id=nullif(j.dimensions->>'supplier_id','')::uuid and s.workspace_id=w.id where w.mode='live' and s.inventory_supplier_id=p_id and l.account='2111'),0)$$;
create or replace function clinic_reception.post(p_workspace uuid,p_source text,p_id uuid,p_description text,p_debit text,p_credit text,p_amount numeric,p_dimensions jsonb default '{}') returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v uuid;entry uuid;sh clinic_reception.shifts%rowtype;w clinic_reception.workspaces%rowtype;p clinic_reception.providers%rowtype;s clinic_reception.suppliers%rowtype;
begin
 select * into w from clinic_reception.workspaces where id=p_workspace;
 if nullif(p_dimensions->>'shift_id','') is not null then select * into sh from clinic_reception.shifts where id=(p_dimensions->>'shift_id')::uuid and workspace_id=p_workspace;if not found then raise exception 'الوردية خارج المساحة';end if;p_dimensions:=p_dimensions||jsonb_build_object('register_id',sh.register_id);end if;
 if w.mode='trial' then return clinic_reception.trial_post(p_workspace,p_source,p_id,p_description,p_debit,p_credit,p_amount,p_dimensions);end if;
 perform clinic_reception.access(p_workspace,'view');perform clinic_finance.lock_day();
 if p_amount=0 then return null;end if;perform clinic_reception.number(p_amount::text);
 if p_debit='1111' or p_credit='1111' then
  if sh.finance_shift_id is null or sh.status<>'open' then raise exception 'الوردية الفعلية غير مربوطة';end if;
  if p_credit='1111' and p_amount>clinic_finance.cash_limit(sh.finance_shift_id) then raise exception 'الكاش الفعلي لا يكفي؛ لا يسمح برصيد سالب';end if;
 end if;
 if p_debit='2120' then
  select * into p from clinic_reception.providers where id=nullif(p_dimensions->>'provider_id','')::uuid and workspace_id=p_workspace;
  if p.doctor_key is null or p_amount>clinic_finance.doctor_balance(p.doctor_key) then raise exception 'رصيد الطبيب الموحد لا يكفي';end if;
 elsif p_debit='2111' then
  select * into s from clinic_reception.suppliers where id=nullif(p_dimensions->>'supplier_id','')::uuid and workspace_id=p_workspace;
  if s.inventory_supplier_id is null or p_amount>clinic_finance.supplier_balance(s.inventory_supplier_id) then raise exception 'رصيد المورد الموحد لا يكفي';end if;
 end if;
 insert into clinic_reception.journal(workspace_id,source,source_id,description,dimensions,actor_id) values(p_workspace,p_source,p_id,p_description,p_dimensions,public.my_admin_id()) returning id into v;
 insert into clinic_reception.journal_lines values(v,p_debit,p_amount,0),(v,p_credit,0,p_amount);
 -- No call to invoice/payment entry points: they would recognize the same revenue again.
 insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('reception_'||p_source,v,p_description,sh.finance_shift_id,public.my_admin_id()) returning id into entry;
 insert into clinic_finance.lines(entry_id,account,debit,credit) values(entry,clinic_reception.account(p_debit),p_amount,0),(entry,clinic_reception.account(p_credit),0,p_amount);
 update clinic_reception.journal set finance_entry_id=entry where id=v;return v;
end $$;
create or replace function clinic_reception.mirror_stock() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare item clinic_reception.items%rowtype;location clinic_reception.locations%rowtype;lot clinic_reception.lots%rowtype;v uuid;available numeric;kind text;sup text;
begin
 if not exists(select 1 from clinic_reception.workspaces where id=new.workspace_id and mode='live') or new.source_id is null then return new;end if;
 perform clinic_finance.lock_day();select * into item from clinic_reception.items where id=new.item_id;select * into location from clinic_reception.locations where id=new.location_id;select * into lot from clinic_reception.lots where id=new.lot_id;
 if item.inventory_item_id is null or location.inventory_location_id is null then raise exception 'اربط الصنف والمخزن بالأصل المعتمد قبل الحركة';end if;
 perform 1 from public.inventory_items where id=item.inventory_item_id and active for update;if not found then raise exception 'الصنف الفعلي غير متاح';end if;
 if new.kind='receipt' and lot.inventory_lot_id is null then
  if new.unit_cost<>round(new.unit_cost,2) then raise exception 'دقة تكلفة المخزن الفعلي خانتان عشريتان؛ راجع سعر الوحدة';end if;
  select s.name into sup from clinic_reception.suppliers s join clinic_reception.purchases p on p.supplier_id=s.id where p.id=new.source_id;
  insert into public.inventory_lots(item_id,lot_number,expiry_date,received_quantity,unit_cost,supplier_name,created_by) values(item.inventory_item_id,lot.number,lot.expiry_date,new.quantity,new.unit_cost,coalesce(sup,''),new.actor_id) returning id into v;
  update clinic_reception.lots set inventory_lot_id=v where id=lot.id;lot.inventory_lot_id:=v;
 end if;
 if lot.inventory_lot_id is null then raise exception 'التشغيلة غير مربوطة بالمخزون الفعلي';end if;
 if new.quantity<0 then
  available:=public.inventory_location_balance(location.inventory_location_id,item.inventory_item_id,lot.inventory_lot_id,false);
  if available+new.quantity<0 then raise exception 'الرصيد الفعلي تغير؛ حدّث العملية دون صرف بالسالب';end if;
 end if;
 kind:=case new.kind when 'receipt' then 'receipt' when 'transfer_out' then 'transfer_out' when 'transfer_in' then 'transfer_in' when 'included' then 'issue' when 'sale' then 'sale' when 'waste' then 'waste' else 'count_adjustment' end;
 insert into public.inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,unit_sale_price,reference_type,reference_id,note,created_by) values(item.inventory_item_id,location.inventory_location_id,lot.inventory_lot_id,kind,new.quantity,new.unit_cost,new.sale_price,'reception',new.id,'استقبال وخدمات — '||new.kind,new.actor_id) returning id into v;
 update clinic_reception.movements set inventory_movement_id=v where id=new.id;return new;
end $$;
create trigger reception_stock_bridge after insert on clinic_reception.movements for each row execute function clinic_reception.mirror_stock();
create or replace function clinic_reception.sync_stock(p_workspace uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare x record;l uuid;current_qty numeric;highest numeric;
begin
 if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then return;end if;
 -- Match by immutable IDs only. Never infer a mapping from a name or phone.
 perform i.id from public.inventory_items i join clinic_reception.items rx on rx.inventory_item_id=i.id where rx.workspace_id=p_workspace order by i.id for update of i;
 for x in select rx.id item_id,loc.id location_id,l.id inventory_lot_id,l.lot_number,l.expiry_date,l.unit_cost,l.received_at,coalesce(sum(m.quantity_delta),0) quantity from clinic_reception.items rx join public.inventory_lots l on l.item_id=rx.inventory_item_id cross join clinic_reception.locations loc left join public.inventory_movements m on m.lot_id=l.id and m.location_id=loc.inventory_location_id where rx.workspace_id=p_workspace and loc.workspace_id=p_workspace and loc.inventory_location_id is not null group by rx.id,loc.id,l.id loop
  select id into l from clinic_reception.lots where workspace_id=p_workspace and inventory_lot_id=x.inventory_lot_id;
  if l is null then insert into clinic_reception.lots(id,workspace_id,item_id,number,expiry_date,unit_cost,inventory_lot_id,received_at) values(x.inventory_lot_id,p_workspace,x.item_id,x.lot_number,x.expiry_date,x.unit_cost,x.inventory_lot_id,x.received_at) returning id into l;end if;
  select coalesce(sum(quantity),0) into current_qty from clinic_reception.movements where workspace_id=p_workspace and lot_id=l and location_id=x.location_id;
  if current_qty<>x.quantity then insert into clinic_reception.movements(workspace_id,item_id,location_id,lot_id,kind,quantity,unit_cost,source_id,actor_id) values(p_workspace,x.item_id,x.location_id,l,'count',x.quantity-current_qty,x.unit_cost,null,public.my_admin_id());end if;
 end loop;
 -- Highest purchase cost is a pricing reference, not a retrospective cost revaluation.
 update clinic_reception.items rx set highest_cost=greatest(rx.highest_cost,coalesce((select max(unit_cost) from public.inventory_lots where item_id=rx.inventory_item_id),0)),sale_price=round(greatest(rx.highest_cost,coalesce((select max(unit_cost) from public.inventory_lots where item_id=rx.inventory_item_id),0))*(1+rx.markup/100),2) where rx.workspace_id=p_workspace and rx.inventory_item_id is not null;
end $$;
create or replace function clinic_reception.mirror_item_price() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if new.inventory_item_id is not null and exists(select 1 from clinic_reception.workspaces where id=new.workspace_id and mode='live') and new.sale_price is distinct from old.sale_price then update public.inventory_items set current_sale_price=new.sale_price,markup_percent=new.markup,updated_at=now() where id=new.inventory_item_id;end if;return new;
end $$;
create trigger reception_item_price_bridge after update on clinic_reception.items for each row execute function clinic_reception.mirror_item_price();
create or replace function clinic_reception.configuration(p_workspace uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$select jsonb_build_object('members',(select coalesce(jsonb_agg(to_jsonb(x) order by admin_id),'[]') from clinic_reception.members x where workspace_id=p_workspace),'locations',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.locations x where workspace_id=p_workspace),'suppliers',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.suppliers x where workspace_id=p_workspace),'registers',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.registers x where workspace_id=p_workspace),'devices',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.devices x where workspace_id=p_workspace),'providers',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.providers x where workspace_id=p_workspace),'services',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.services x where workspace_id=p_workspace),'items',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.items x where workspace_id=p_workspace),'templates',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.package_templates x where workspace_id=p_workspace),'template_lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from clinic_reception.template_lines l join clinic_reception.package_templates t on t.id=l.template_id where t.workspace_id=p_workspace),'agreements',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.doctor_agreements x where workspace_id=p_workspace),'entities',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.entities x where workspace_id=p_workspace),'entity_contracts',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from clinic_reception.entity_contracts x where workspace_id=p_workspace))$$;
alter function public.clinic_reception_command(uuid,text,jsonb,uuid) set schema clinic_reception;
alter function clinic_reception.clinic_reception_command(uuid,text,jsonb,uuid) rename to controls_command;
create or replace function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;w clinic_reception.workspaces%rowtype;v uuid;ext uuid;outcome jsonb;prev clinic_reception.commands%rowtype;patient clinic_reception.patients%rowtype;person public.patients%rowtype;lead public.leads%rowtype;a clinic_reception.appointments%rowtype;visit clinic_reception.visits%rowtype;sh clinic_reception.shifts%rowtype;reg clinic_reception.registers%rowtype;cv clinic_reception.cutovers%rowtype;cfg jsonb;kind text;map_id uuid;approved boolean;material jsonb;original jsonb;new_bom jsonb;value numeric;device uuid;starts timestamptz;ends timestamptz;service clinic_reception.services%rowtype;
begin
 select * into w from clinic_reception.workspaces where id=p_workspace;
 if p_action in ('catalog_import','patient_attach','master_link','lead_link','task_export','consent','cutover_record','cutover_review') then
  me:=clinic_reception.access(p_workspace,case when p_action in ('catalog_import','master_link','cutover_record') then 'manage' when p_action='cutover_review' then 'review' else 'book' end);
  if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>60000 then raise exception 'طلب غير صالح';end if;
  perform 1 from clinic_reception.workspaces where id=p_workspace for update;
  select * into prev from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
  if found then if prev.action<>p_action or prev.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;return prev.response;end if;
  if p_action='catalog_import' then
   if not clinic_finance.allowed('view') then raise exception 'راجع صلاحية التسعير';end if;
   select to_jsonb(s) into cfg from public.pricing_services s where id=(p_payload->>'pricing_service_id')::uuid and active;
   if not found or length(trim(coalesce(p_payload->>'code','')))<2 or length(trim(coalesce(p_payload->>'department','')))<2 then raise exception 'راجع تعريف الخدمة والقسم';end if;
   value:=clinic_reception.number(cfg->>'base_price',2,true);new_bom:='[]';
   for original in select * from jsonb_array_elements(coalesce(cfg->'supplies_used','[]')) loop
    select x into material from jsonb_array_elements(coalesce(p_payload->'mappings','[]')) x where x->>'supply_id'=original->>'supply_id';
    if not found or not exists(select 1 from clinic_reception.items where workspace_id=p_workspace and id=(material->>'item_id')::uuid) then raise exception 'اربط كل مكون مع كميته بوحدة المخزن الأساسية صراحة';end if;
    select value+clinic_reception.number(original->>'quantity',3)*clinic_reception.number(package_price::text,4,true)/clinic_reception.number(units_per_package::text,3) into value from public.pricing_supplies where id=(original->>'supply_id')::uuid and active;
    if not found then raise exception 'مكون التسعير غير متاح';end if;
    new_bom:=new_bom||jsonb_build_array(jsonb_build_object('item_id',material->>'item_id','quantity',clinic_reception.number(material->>'quantity',3),'included',true));
   end loop;
   value:=round(value*(1+clinic_reception.number(cfg->>'profit_margin_percent',4,true)/100),2);
   outcome:=clinic_reception.controls_command(p_workspace,'service',jsonb_build_object('code',p_payload->>'code','name',cfg->>'name','department',p_payload->>'department','price',value,'minutes',p_payload->>'minutes','bom',new_bom),gen_random_uuid());v:=(outcome->>'id')::uuid;
   update clinic_reception.services set pricing_service_id=(p_payload->>'pricing_service_id')::uuid where id=v;
  elsif p_action='patient_attach' then
   if w.mode<>'live' then raise exception 'لا تنقل بيانات مرضى حقيقية إلى مساحة التجربة';end if;
   if not(public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads() or public.has_role('nursing')) then raise exception 'لا توجد صلاحية لربط ملف المريض';end if;
   select * into person from public.patients where id=(p_payload->>'patient_id')::uuid and status='active';if not found then raise exception 'ملف المريض غير متاح';end if;
   insert into clinic_reception.patients(workspace_id,patient_id,file_no,name,phone,gender,created_by) values(p_workspace,person.id,person.patient_code,person.full_name,person.phone,person.gender,me) on conflict(workspace_id,patient_id) do update set file_no=excluded.file_no,name=excluded.name,phone=excluded.phone,gender=excluded.gender returning id into v;
  elsif p_action='master_link' then
   if w.mode<>'live' then raise exception 'ربط الأصول الفعلية يخص مساحة التشغيل المعتمدة فقط';end if;
   kind:=p_payload->>'kind';v:=(p_payload->>'id')::uuid;ext:=nullif(p_payload->>'external_id','')::uuid;
   if kind='provider' and exists(select 1 from clinic_reception.providers where id=v and workspace_id=p_workspace and doctor_key is not null and doctor_key is distinct from p_payload->>'doctor_key') or kind='item' and exists(select 1 from clinic_reception.items where id=v and workspace_id=p_workspace and inventory_item_id is not null and inventory_item_id is distinct from ext) or kind='location' and exists(select 1 from clinic_reception.locations where id=v and workspace_id=p_workspace and inventory_location_id is not null and inventory_location_id is distinct from ext) or kind='supplier' and exists(select 1 from clinic_reception.suppliers where id=v and workspace_id=p_workspace and inventory_supplier_id is not null and inventory_supplier_id is distinct from ext) or kind='register' and exists(select 1 from clinic_reception.registers where id=v and workspace_id=p_workspace and finance_register_id is not null and finance_register_id is distinct from ext) then raise exception 'الربط المعتمد محفوظ؛ لا تغير نسب الحركات السابقة إلى أصل آخر';end if;
   if kind='item' then
    if not exists(select 1 from public.inventory_items actual join clinic_reception.items rx on rx.id=v where rx.workspace_id=p_workspace and actual.id=ext and actual.active and actual.base_unit=rx.unit) then raise exception 'راجع الصنف والوحدة الأساسية؛ الربط بالمعرف لا بالاسم';end if;
    update clinic_reception.items set inventory_item_id=ext where id=v and workspace_id=p_workspace;
   elsif kind='location' then
    if not exists(select 1 from public.inventory_locations where id=ext and active) then raise exception 'المخزن الفعلي غير متاح';end if;update clinic_reception.locations set inventory_location_id=ext where id=v and workspace_id=p_workspace;
   elsif kind='supplier' then
    if not exists(select 1 from public.inventory_suppliers where id=ext and active) then raise exception 'المورد الفعلي غير متاح';end if;update clinic_reception.suppliers set inventory_supplier_id=ext where id=v and workspace_id=p_workspace;
   elsif kind='register' then
    if exists(select 1 from clinic_finance.shifts where register_id=ext and status<>'reviewed') or exists(select 1 from clinic_reception.shifts where register_id=v) then raise exception 'راجع وسلم الورديات قبل ربط الخزينة';end if;
    select * into reg from clinic_reception.registers where id=v and workspace_id=p_workspace;
    if not exists(select 1 from clinic_finance.registers where id=ext and operation_mode=reg.direction) then raise exception 'راجع اتجاه الخزينة الفعلية';end if;update clinic_reception.registers set finance_register_id=ext where id=v and workspace_id=p_workspace;
   elsif kind='provider' then
    if length(trim(coalesce(p_payload->>'doctor_key','')))<2 then raise exception 'حدد المفتاح المحاسبي الموحد للطبيب';end if;
    update clinic_reception.providers set doctor_key=p_payload->>'doctor_key' where id=v and workspace_id=p_workspace;
   elsif kind='entity' then
    if not exists(select 1 from public.contracting_entities where id=ext) then raise exception 'الجهة غير موجودة';end if;update clinic_reception.entities set contracting_entity_id=ext where id=v and workspace_id=p_workspace;
   elsif kind='entity_contract' then
    if not exists(select 1 from public.contracting_entity_contracts actual join clinic_reception.entities e on e.contracting_entity_id=actual.entity_id join clinic_reception.entity_contracts rx on rx.entity_id=e.id where rx.id=v and rx.workspace_id=p_workspace and actual.id=ext and actual.status='active') then raise exception 'اربط جهة العقد أولًا وراجع اعتماده في التعاقدات';end if;update clinic_reception.entity_contracts set external_contract_id=ext where id=v and workspace_id=p_workspace;
   else raise exception 'نوع الربط غير صالح';end if;
   if not found then raise exception 'السجل خارج المساحة';end if;
  elsif p_action='lead_link' then
   if w.mode<>'live' or not public.can_access_leads() then raise exception 'ربط الليد متاح بصلاحيته في التشغيل الفعلي';end if;
   select * into a from clinic_reception.appointments where id=(p_payload->>'appointment_id')::uuid and workspace_id=p_workspace and status='booked';if not found then raise exception 'اربط المصدر قبل الحضور';end if;
   select * into patient from clinic_reception.patients where id=a.patient_id;
   select * into lead from public.leads where id=(p_payload->>'lead_id')::uuid and patient_id=patient.patient_id;if not found then raise exception 'الليد ليس مربوطًا بنفس ملف الأرشيف؛ لا تستنتج الربط من الهاتف';end if;
   -- Existing campaign IDs are linked metadata. They are not evidence of verified tracking on their own.
   cfg:=jsonb_build_object('source',lead.source,'campaign_id',lead.meta_campaign_id,'adset_id',lead.meta_adset_id,'ad_id',lead.meta_ad_id,'creative_id',lead.meta_creative_id,'utm_source',lead.utm_source,'utm_medium',lead.utm_medium,'utm_campaign',lead.utm_campaign);
   insert into clinic_reception.attributions(appointment_id,workspace_id,lead_id,source,evidence,campaign_id,adset_id,ad_id,creative_id,utm_source,utm_medium,utm_campaign,notes,created_by,snapshot) values(a.id,p_workspace,lead.id,lead.source,'unknown',lead.meta_campaign_id,lead.meta_adset_id,lead.meta_ad_id,lead.meta_creative_id,lead.utm_source,lead.utm_medium,lead.utm_campaign,'بيانات مرتبطة من الليد؛ ليست إثبات تتبع مؤكد وحدها',me,cfg) on conflict(appointment_id) do update set lead_id=excluded.lead_id,source=excluded.source,evidence=excluded.evidence,campaign_id=excluded.campaign_id,adset_id=excluded.adset_id,ad_id=excluded.ad_id,creative_id=excluded.creative_id,utm_source=excluded.utm_source,utm_medium=excluded.utm_medium,utm_campaign=excluded.utm_campaign,notes=excluded.notes,created_by=me,snapshot=excluded.snapshot;
   update clinic_reception.appointments set source=lead.source,source_evidence='unknown' where id=a.id;v:=a.id;
  elsif p_action='task_export' then
   if w.mode<>'live' then raise exception 'التجربة لا تكلف موظفين بمهام فعلية';end if;
   select external_task_id into ext from clinic_reception.tasks where id=(p_payload->>'id')::uuid and workspace_id=p_workspace;
   if not found or ext is not null then raise exception 'المهمة غير متاحة للتصدير';end if;
   select public.task_create((p_payload->>'project_id')::uuid,null,t.subject,'متابعة استقبال وخدمات — مرجع '||t.id::text,'توثيق النتيجة دون بيانات طبية في التكليف',t.assigned_to,t.due_at,'normal') into ext from clinic_reception.tasks t where id=(p_payload->>'id')::uuid and workspace_id=p_workspace;
   update clinic_reception.tasks set external_task_id=ext where id=(p_payload->>'id')::uuid;v:=(p_payload->>'id')::uuid;
  elsif p_action='consent' then
   if length(trim(coalesce(p_payload->>'reference','')))<3 or not exists(select 1 from clinic_reception.patients where workspace_id=p_workspace and id=(p_payload->>'patient_id')::uuid) or p_payload->>'allowed' is null then raise exception 'راجع المريض ومرجع الموافقة';end if;
   insert into clinic_reception.consents values(p_workspace,(p_payload->>'patient_id')::uuid,(p_payload->>'allowed')::boolean,p_payload->>'reference',me,now()) on conflict(workspace_id,patient_id) do update set allowed=excluded.allowed,reference=excluded.reference,recorded_by=me,recorded_at=now();v:=(p_payload->>'patient_id')::uuid;
  elsif p_action='cutover_record' then
   if w.mode<>'trial' or length(trim(coalesce(p_payload->>'note','')))<10 then raise exception 'سجل محضر تجربة واضح أولًا';end if;
   cfg:=clinic_reception.configuration(p_workspace);
   insert into clinic_reception.cutovers(trial_workspace_id,configuration,configuration_hash,checks,note,created_by) values(p_workspace,cfg,md5(cfg::text),coalesce(p_payload->'checks','{}'),p_payload->>'note',me) returning id into v;
  elsif p_action='cutover_review' then
   select * into cv from clinic_reception.cutovers where trial_workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;approved:=(p_payload->>'approve')::boolean;
   if not found or cv.created_by=me or cv.status<>'pending' or approved is null or length(trim(coalesce(p_payload->>'note','')))<10 then raise exception 'محضر الانتقال يحتاج مراجعًا مستقلًا ونتيجة موثقة';end if;
   if approved and (cv.configuration_hash<>md5(clinic_reception.configuration(p_workspace)::text) or not cv.checks @> '{"sql":true,"accounting":true,"inventory":true,"permissions":true,"visual":true,"staff_uat":true,"opening_reconciled":true,"legacy_worker_stopped":true,"backup":true}'::jsonb) then raise exception 'لم تكتمل المطابقة والتجربة والنسخ الاحتياطي وإيقاف النظام القديم أو تغيرت الإعدادات';end if;
   update clinic_reception.cutovers set status=case when approved then 'approved' else 'rejected' end,reviewed_by=me,review_note=p_payload->>'note' where id=cv.id;v:=cv.id;
  end if;
  outcome:=jsonb_build_object('id',v);insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id) values(p_workspace,me,p_action,v);insert into clinic_reception.commands values(p_workspace,me,p_token,p_action,p_payload,outcome);return outcome;
 end if;
 me:=clinic_reception.access(p_workspace,case when p_action in ('execute','order_add','order_cancel') then 'execute' when p_action in ('collect','shift_open','shift_close','credit_apply') then 'collect' when p_action='request_review' then 'review' when p_action in ('receive_purchase','transfer_dispatch','transfer_receive','count') then 'warehouse' else 'view' end);
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 select * into prev from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
 if found then if prev.action<>p_action or prev.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;return prev.response;end if;
 if w.mode='live' then
  perform clinic_finance.lock_day();perform clinic_reception.sync_stock(p_workspace);
  if p_action='collect' and p_payload->>'method' in ('bank','instapay','pos','wallet') and (exists(select 1 from clinic_finance.payments where reference=p_payload->>'reference' and (method=p_payload->>'method' or method in ('bank','instapay') and p_payload->>'method' in ('bank','instapay'))) or exists(select 1 from clinic_finance.advances where reference=p_payload->>'reference' and status='received' and (method=p_payload->>'method' or method in ('bank','instapay') and p_payload->>'method' in ('bank','instapay')))) then raise exception 'مرجع التحصيل مستخدم بالفعل في المالية';end if;
 end if;
 if p_action='discount' and exists(select 1 from clinic_reception.order_quotes where order_id=(p_payload->>'id')::uuid and workspace_id=p_workspace) then raise exception 'الخدمة بسعر تعاقدي محفوظ؛ لا يضاف خصم تلقائي فوق العقد';end if;
 if p_action in ('book','reschedule') then
  select * into service from clinic_reception.services where id=(p_payload->>'service_id')::uuid and workspace_id=p_workspace;
  device:=nullif(p_payload->>'device_id','')::uuid;
  if service.requires_device or device is not null then
   if device is null or not exists(select 1 from clinic_reception.devices where id=device and workspace_id=p_workspace) then raise exception 'الخدمة تتطلب تحديد الجهاز المحجوز';end if;
   starts:=(p_payload->>'starts_at')::timestamptz;ends:=starts+make_interval(mins=>service.minutes);
   if exists(select 1 from clinic_reception.appointments where workspace_id=p_workspace and device_id=device and status not in ('cancelled','no_show') and starts_at<ends and ends_at>starts and id is distinct from nullif(p_payload->>'id','')::uuid) then raise exception 'الجهاز محجوز في نفس الموعد';end if;
  end if;
 end if;
 outcome:=clinic_reception.controls_command(p_workspace,p_action,p_payload,p_token);
 if p_action in ('book','reschedule') then update clinic_reception.appointments set device_id=device where id=(outcome->>'id')::uuid;end if;
 if w.mode='live' then
  if p_action='shift_open' then
   select * into sh from clinic_reception.shifts where id=(outcome->>'id')::uuid;
   if sh.finance_shift_id is null then
    select * into reg from clinic_reception.registers where id=sh.register_id;if reg.finance_register_id is null then raise exception 'اربط الخزينة الفعلية قبل فتح الوردية';end if;
    if exists(select 1 from clinic_finance.shifts where register_id=reg.finance_register_id and status<>'reviewed') or exists(select 1 from clinic_finance.shifts where cashier_id=me and status<>'reviewed') then raise exception 'يوجد عهدة مالية غير مسلمة أو مراجعة';end if;
    insert into clinic_finance.shifts(register_id,cashier_id,token,opening_book) values(reg.finance_register_id,me,sh.id,0) returning id into ext;update clinic_reception.shifts set finance_shift_id=ext where id=sh.id;
   end if;
  elsif p_action='shift_close' then
   select * into sh from clinic_reception.shifts where id=(outcome->>'id')::uuid;
   update clinic_finance.shifts set status='submitted',closed_at=sh.closed_at,counted=sh.counted,close_event_no=(select coalesce(max(event_no),0) from clinic_finance.entries) where id=sh.finance_shift_id;
   if sh.difference<>0 then insert into clinic_finance.cash_cases(shift_id,difference) values(sh.finance_shift_id,sh.difference) on conflict(shift_id) do nothing;end if;
  elsif p_action='shift_review' then
   select * into sh from clinic_reception.shifts where id=(outcome->>'id')::uuid;
   update clinic_finance.shifts set status='reviewed',reviewed_by=me,reviewed_at=now(),review_note=sh.review_note where id=sh.finance_shift_id;
  elsif p_action='arrive' then
   select * into visit from clinic_reception.visits where id=(outcome->>'id')::uuid;
   if visit.archive_visit_id is null then
    select * into patient from clinic_reception.patients where id=visit.patient_id;if patient.patient_id is null then raise exception 'اربط ملف الأرشيف الموحد قبل الحضور';end if;
    insert into public.patient_visits(patient_id,visit_number,visit_date,created_by,encounter_type) values(patient.patient_id,'RX-'||visit.visit_no,(visit.opened_at at time zone 'Africa/Cairo')::date,me,coalesce(p_payload->>'encounter_type','checkup')) returning id into ext;
    update clinic_reception.visits set archive_visit_id=ext where id=visit.id;
   end if;
  end if;
 end if;return outcome;
end $$;
-- Financial custody is shared by register ID. Include old registered cash and its last physical count.
alter function clinic_reception.register_cash(uuid,uuid,bigint) rename to trial_register_cash;
create or replace function clinic_reception.register_cash(p_workspace uuid,p_register uuid,p_after bigint default null) returns numeric language plpgsql stable security definer set search_path=pg_catalog,public as $$declare reg uuid;begin
 if exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then
  select finance_register_id into reg from clinic_reception.registers where id=p_register and workspace_id=p_workspace;
  return(select coalesce(sum(l.debit-l.credit),0) from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id join clinic_finance.shifts s on s.id=e.shift_id where s.register_id=reg and l.account='1111');
 end if;return clinic_reception.trial_register_cash(p_workspace,p_register,p_after);
end $$;
alter function clinic_reception.cash_limit(uuid,uuid) rename to trial_cash_limit;
create or replace function clinic_reception.cash_limit(p_workspace uuid,p_register uuid) returns numeric language plpgsql stable security definer set search_path=pg_catalog,public as $$declare sh uuid;begin
 if exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then select finance_shift_id into sh from clinic_reception.shifts where workspace_id=p_workspace and register_id=p_register and status='open';return coalesce(clinic_finance.cash_limit(sh),0);end if;return clinic_reception.trial_cash_limit(p_workspace,p_register);
end $$;
create or replace function public.clinic_reception_directory(p_workspace uuid,p_term text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 perform clinic_reception.access(p_workspace,'book');if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then raise exception 'البحث في الأرشيف الفعلي غير متاح بمساحة التجربة';end if;
 if length(trim(coalesce(p_term,'')))<2 or length(p_term)>100 then raise exception 'أدخل حرفين على الأقل أو رقم الملف';end if;
 return(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.search_patients_basic(p_term) p);
end $$;
alter function public.clinic_reception_snapshot(uuid,date,date) set schema clinic_reception;
alter function clinic_reception.clinic_reception_snapshot(uuid,date,date) rename to controls_snapshot;
create or replace function public.clinic_reception_snapshot(p_workspace uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb;manager boolean;me uuid:=clinic_reception.access(p_workspace,'view');begin
 v:=clinic_reception.controls_snapshot(p_workspace,p_from,p_to);manager:=(v->>'can_manage')::boolean;
 if v->'workspace'->>'mode'='live' then
 v:=v||jsonb_build_object('stock',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select rx.id item_id,loc.id location_id,coalesce(rl.id,l.id) lot_id,l.lot_number number,l.expiry_date,sum(m.quantity_delta) quantity,case when manager then l.unit_cost end unit_cost from clinic_reception.items rx join public.inventory_lots l on l.item_id=rx.inventory_item_id join public.inventory_movements m on m.lot_id=l.id join clinic_reception.locations loc on loc.inventory_location_id=m.location_id and loc.workspace_id=p_workspace left join clinic_reception.lots rl on rl.inventory_lot_id=l.id and rl.workspace_id=p_workspace where rx.workspace_id=p_workspace group by rx.id,loc.id,rl.id,l.id having sum(m.quantity_delta)<>0)x));end if;
 -- Expose only the authorized archive link, not all clinical sections.
 v:=v||jsonb_build_object('patients',(select coalesce(jsonb_agg(x||jsonb_build_object('archive_patient_id',case when public.has_archive_access() or public.has_archive_review_access() then (select p.patient_id from clinic_reception.patients p where p.id=(x->>'id')::uuid and p.workspace_id=p_workspace) end)),'[]') from jsonb_array_elements(v->'patients') x),
 'actors',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',coalesce(to_jsonb(a)->>'name',a.role))),'[]') from public.admins a where id in(select actor_id from clinic_reception.audit where workspace_id=p_workspace union select created_by from clinic_reception.patients where workspace_id=p_workspace)),
 'invoice_materials',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select i.id invoice_id,it.name,it.unit,m.kind,sum(-m.quantity) quantity,m.sale_price,case when m.kind='sale' then round(sum(-m.quantity)*m.sale_price,2) else 0 end amount from clinic_reception.invoices i join clinic_reception.movements m on m.source_id=i.order_id and m.workspace_id=i.workspace_id and m.kind in ('included','sale') join clinic_reception.items it on it.id=m.item_id where i.workspace_id=p_workspace group by i.id,it.id,m.kind,m.sale_price)x),
 'cutovers',case when manager then(select coalesce(jsonb_agg(to_jsonb(x)-'configuration'),'[]') from clinic_reception.cutovers x where trial_workspace_id=p_workspace) else '[]'::jsonb end,
 'consents',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.consents x where workspace_id=p_workspace),
 'bridge',jsonb_build_object('live_enabled',(select live_enabled from clinic_reception.settings where id),'communications_enabled',(select communications_enabled from clinic_reception.settings where id),'mode',v->'workspace'->>'mode'));
 return v;
end $$;
alter table clinic_reception.settings add column communications_enabled boolean not null default false;
alter table clinic_reception.outbox add column lease_token uuid,add column lease_until timestamptz,add column attempts integer not null default 0,add column delivered_at timestamptz,add column delivery_reference text,add column last_error text;
create or replace function public.clinic_reception_message_claim(p_limit integer default 10) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare result jsonb;begin
 if p_limit not between 1 and 50 then raise exception 'Invalid batch';end if;
 with eligible as(select o.id from clinic_reception.outbox o join clinic_reception.workspaces w on w.id=o.workspace_id join clinic_reception.appointments a on a.id=o.appointment_id join clinic_reception.patients p on p.id=a.patient_id join clinic_reception.consents consent on consent.workspace_id=w.id and consent.patient_id=p.id join clinic_reception.settings settings on settings.id where settings.live_enabled and settings.communications_enabled and w.mode='live' and o.status='approved' and o.delivered_at is null and o.attempts<5 and (o.lease_until is null or o.lease_until<now()) and consent.allowed and nullif(trim(p.phone),'') is not null and not exists(select 1 from public.leads l where l.patient_id=p.patient_id and l.do_not_contact) and o.version=a.starts_at::text||':'||a.status order by o.created_at,o.id for update of o skip locked limit p_limit),claimed as(update clinic_reception.outbox o set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1 from eligible where o.id=eligible.id returning o.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease_token',c.lease_token,'idempotency_key','rx:'||c.id,'phone',p.phone,'body',c.body,'kind',c.kind)),'[]') into result from claimed c join clinic_reception.appointments a on a.id=c.appointment_id join clinic_reception.patients p on p.id=a.patient_id;return result;
end $$;
create or replace function public.clinic_reception_message_validate(p_id uuid,p_lease uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from clinic_reception.outbox o join clinic_reception.workspaces w on w.id=o.workspace_id join clinic_reception.appointments a on a.id=o.appointment_id join clinic_reception.patients p on p.id=a.patient_id join clinic_reception.consents c on c.workspace_id=w.id and c.patient_id=p.id join clinic_reception.settings s on s.id where o.id=p_id and o.lease_token=p_lease and o.lease_until>=now() and o.status='approved' and o.delivered_at is null and w.mode='live' and s.live_enabled and s.communications_enabled and c.allowed and o.version=a.starts_at::text||':'||a.status and not exists(select 1 from public.leads l where l.patient_id=p.patient_id and l.do_not_contact))
$$;
revoke all on function public.clinic_reception_message_validate(uuid,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_message_validate(uuid,uuid) to service_role;
create or replace function public.clinic_reception_message_ack(p_id uuid,p_lease uuid,p_reference text,p_error text default null) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if p_error is null and length(trim(coalesce(p_reference,'')))=0 then raise exception 'Delivery reference required';end if;
 if not public.clinic_reception_message_validate(p_id,p_lease) then return false;end if;
 if length(coalesce(p_reference,''))>200 or length(coalesce(p_error,''))>500 then raise exception 'Invalid receipt';end if;
 update clinic_reception.outbox set delivered_at=case when p_error is null and length(trim(coalesce(p_reference,'')))>0 then now() end,delivery_reference=case when p_error is null then p_reference end,last_error=p_error,lease_token=null,lease_until=case when p_error is not null then now()+interval '5 minutes' end where id=p_id and lease_token=p_lease and lease_until>=now() and status='approved' and delivered_at is null;
 return found;
end $$;
-- A pre-existing booking writer must be stopped before activation; its table is read-only afterwards.
create or replace function clinic_reception.guard_legacy_booking() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin if (select live_enabled from clinic_reception.settings where id) then raise exception 'انتقل التشغيل إلى نظام الاستقبال والخدمات؛ الحجز القديم للقراءة فقط';end if;return new;end $$;
create trigger reception_legacy_cutover_guard before insert or update on public.customer_bookings for each row execute function clinic_reception.guard_legacy_booking();
-- Cross-module financial overview contains aggregates only. Detail stays in the authorized reception workspace.
create or replace function public.clinic_reception_finance_overview(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare me uuid:=clinic_finance.require_access('view');begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'راجع الفترة';end if;
 return jsonb_build_object('invoices',(select count(*) from clinic_reception.invoices i join clinic_reception.workspaces w on w.id=i.workspace_id where w.mode='live' and (i.created_at at time zone 'Africa/Cairo')::date between p_from and p_to),'billed',(select coalesce(sum(amount),0) from clinic_reception.invoices i join clinic_reception.workspaces w on w.id=i.workspace_id where w.mode='live' and (i.created_at at time zone 'Africa/Cairo')::date between p_from and p_to),'patient_due',(select coalesce(sum(clinic_reception.due(i.id)),0) from clinic_reception.invoices i join clinic_reception.workspaces w on w.id=i.workspace_id where w.mode='live'),'collections',(select coalesce(sum(amount),0) from clinic_reception.payments p join clinic_reception.workspaces w on w.id=p.workspace_id where w.mode='live' and (p.created_at at time zone 'Africa/Cairo')::date between p_from and p_to),'claims_due',(select coalesce(sum(amount-paid-contractual),0) from clinic_reception.claims c join clinic_reception.workspaces w on w.id=c.workspace_id where w.mode='live'),'unearned',(select coalesce(sum(l.credit-l.debit),0) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id join clinic_reception.workspaces w on w.id=j.workspace_id where w.mode='live' and l.account='2151'),'live_enabled',(select live_enabled from clinic_reception.settings where id));
end $$;
create or replace function public.clinic_reception_indicator_export(p_workspace uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare r jsonb;income numeric;expense numeric;begin
 r:=public.clinic_reception_report(p_workspace,p_from,p_to);
 select coalesce(sum(case when x->>'account' like '4%' then (x->>'credit')::numeric-(x->>'debit')::numeric else 0 end),0),coalesce(sum(case when x->>'account' like '5%' then (x->>'debit')::numeric-(x->>'credit')::numeric else 0 end),0) into income,expense from jsonb_array_elements(r->'ledger') x;
 return jsonb_build_object('source','reception_services','version',1,'scope',r->'scope','kpis',jsonb_build_object('recorded_net_revenue',income,'recorded_expense',expense,'recorded_result',income-expense),'funnel',r->'booking_funnel','coverage',jsonb_build_object('overhead_complete',false,'marketing_cost_complete',false));
end $$;
create or replace function clinic_reception.remap_bom(p_bom jsonb,p_map jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$declare out jsonb:='[]';x jsonb;begin
 for x in select * from jsonb_array_elements(coalesce(p_bom,'[]')) loop
  if p_map->> (x->>'item_id') is null then raise exception 'مكون غير مربوط بأصل معتمد';end if;
  out:=out||jsonb_build_array(x||jsonb_build_object('item_id',p_map->>(x->>'item_id')));
 end loop;return out;
end $$;
create or replace function clinic_reception.prepare_cutover(p_plan uuid,p_mappings jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare plan clinic_reception.cutovers%rowtype;w clinic_reception.workspaces%rowtype;me uuid:=public.my_admin_id();target uuid;v uuid;ids jsonb:='{}';x record;key text;ext uuid;oldid text;bom jsonb;active_plan boolean;
begin
 if me is null or not(public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'مدير معتمد مطلوب';end if;
 perform pg_advisory_xact_lock(927311);select * into plan from clinic_reception.cutovers where id=p_plan for update;
 if not found or plan.status<>'approved' or plan.reviewed_by=plan.created_by or plan.configuration_hash<>md5(clinic_reception.configuration(plan.trial_workspace_id)::text) or not plan.checks @> '{"sql":true,"accounting":true,"inventory":true,"permissions":true,"visual":true,"staff_uat":true,"opening_reconciled":true,"legacy_worker_stopped":true,"backup":true}' then raise exception 'محضر الانتقال غير مكتمل أو تغيرت الإعدادات';end if;
 if exists(select 1 from clinic_reception.workspaces where mode='live') or (select live_enabled from clinic_reception.settings where id) then raise exception 'مساحة التشغيل موجودة؛ لا تعاد تهيئتها أو يعاد ترحيل تاريخها';end if;
 select * into w from clinic_reception.workspaces where id=plan.trial_workspace_id;
 if me not in(w.owner_id,plan.reviewed_by) then raise exception 'المحضر خارج مسؤوليتك';end if;
 insert into clinic_reception.workspaces(name,mode,owner_id) values('الاستقبال والخدمات — التشغيل','live',w.owner_id) returning id into target;
 for x in select * from clinic_reception.items where workspace_id=w.id and p_mappings->'items' ? id::text loop
  ext:=(p_mappings->'items'->>x.id::text)::uuid;
  if not exists(select 1 from public.inventory_items where id=ext and active and base_unit=x.unit) then raise exception 'راجع أصل ووحدة المستلزم %',x.code;end if;
  insert into clinic_reception.items(workspace_id,code,name,unit,markup,track_expiry,inventory_item_id) values(target,x.code,x.name,x.unit,x.markup,x.track_expiry,ext) returning id into v;ids:=ids||jsonb_build_object(x.id::text,v);
 end loop;
 for x in select * from clinic_reception.providers where workspace_id=w.id and active and p_mappings->'providers' ? id::text loop
  key:=p_mappings->'providers'->>x.id::text;if length(trim(coalesce(key,'')))<2 then raise exception 'حدد الكود المحاسبي للطبيب';end if;
  insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values(target,x.name,key,x.department,x.branch) returning id into v;ids:=ids||jsonb_build_object(x.id::text,v);
 end loop;
 for x in select * from clinic_reception.locations where workspace_id=w.id and p_mappings->'locations' ? id::text loop
  ext:=(p_mappings->'locations'->>x.id::text)::uuid;if not exists(select 1 from public.inventory_locations where id=ext and active) then raise exception 'المخزن غير معتمد';end if;
  insert into clinic_reception.locations(workspace_id,name,inventory_location_id) values(target,x.name,ext) returning id into v;ids:=ids||jsonb_build_object(x.id::text,v);
 end loop;
 for x in select * from clinic_reception.suppliers where workspace_id=w.id and p_mappings->'suppliers' ? id::text loop
  ext:=(p_mappings->'suppliers'->>x.id::text)::uuid;if not exists(select 1 from public.inventory_suppliers where id=ext and active) then raise exception 'المورد غير معتمد';end if;
  insert into clinic_reception.suppliers(workspace_id,name,inventory_supplier_id) values(target,x.name,ext) returning id into v;ids:=ids||jsonb_build_object(x.id::text,v);
 end loop;
 for x in select * from clinic_reception.registers where workspace_id=w.id and p_mappings->'registers' ? id::text loop
  ext:=(p_mappings->'registers'->>x.id::text)::uuid;if not exists(select 1 from clinic_finance.registers where id=ext and operation_mode=x.direction) or exists(select 1 from clinic_finance.shifts where register_id=ext and status<>'reviewed') then raise exception 'الخزينة تحتاج مطابقة الاتجاه وتسليم الورديات';end if;
  insert into clinic_reception.registers(workspace_id,name,direction,finance_register_id) values(target,x.name,x.direction,ext) returning id into v;ids:=ids||jsonb_build_object(x.id::text,v);
 end loop;
 for x in select * from clinic_reception.devices where workspace_id=w.id and p_mappings->'devices' ? id::text loop
  insert into clinic_reception.devices(workspace_id,code,name,meter_kind,asset_key) values(target,x.code,x.name,x.meter_kind,p_mappings->'devices'->>x.id::text) returning id into v;ids:=ids||jsonb_build_object(x.id::text,v);
 end loop;
 for x in select * from clinic_reception.services where workspace_id=w.id and p_mappings->'services' ? id::text order by code,version loop
  bom:=clinic_reception.remap_bom(x.bom,ids);
  insert into clinic_reception.services(workspace_id,code,name,version,department,price,minutes,requires_device,bom,active,pricing_service_id) values(target,x.code,x.name,x.version,x.department,x.price,x.minutes,x.requires_device,bom,x.active,x.pricing_service_id) returning id into v;ids:=ids||jsonb_build_object(x.id::text,v);
 end loop;
 if not exists(select 1 from clinic_reception.services where workspace_id=target and active) or not exists(select 1 from clinic_reception.providers where workspace_id=target and active) then raise exception 'لا توجد خدمات وأطباء معتمدون للتشغيل';end if;
 for x in select * from clinic_reception.doctor_agreements where workspace_id=w.id and status='active' and valid_to>=current_date and ids ? provider_id::text and exists(select 1 from clinic_reception.services where workspace_id=target and code=service_code and active) loop
  insert into clinic_reception.doctor_agreements(workspace_id,provider_id,service_code,rate,deduct_material_cost,valid_from,valid_to,reference,status,created_by,reviewed_by) values(target,(ids->>x.provider_id::text)::uuid,x.service_code,x.rate,x.deduct_material_cost,x.valid_from,x.valid_to,x.reference,x.status,x.created_by,x.reviewed_by);
 end loop;
 if exists(select 1 from clinic_reception.services s where s.workspace_id=target and s.active and not exists(select 1 from clinic_reception.doctor_agreements a join clinic_reception.providers p on p.id=a.provider_id where a.workspace_id=target and a.service_code=s.code and a.status='active' and current_date between a.valid_from and a.valid_to and p.department=s.department)) then raise exception 'كل خدمة تحتاج طبيبًا من تخصصها وعقد أتعاب معتمدًا وقت الانتقال';end if;
 if exists(select 1 from clinic_reception.services where workspace_id=target and active and requires_device) and not exists(select 1 from clinic_reception.devices where workspace_id=target) then raise exception 'حدد الأجهزة اللازمة للخدمات';end if;
 for x in select * from clinic_reception.entities where workspace_id=w.id and p_mappings->'entities' ? id::text loop
  ext:=(p_mappings->'entities'->>x.id::text)::uuid;if not exists(select 1 from public.contracting_entities where id=ext) then raise exception 'أصل الجهة غير معتمد';end if;
  insert into clinic_reception.entities(workspace_id,name,kind,contracting_entity_id) values(target,x.name,x.kind,ext) returning id into v;ids:=ids||jsonb_build_object(x.id::text,v);
 end loop;
 for x in select * from clinic_reception.entity_contracts where workspace_id=w.id and status='active' and p_mappings->'entity_contracts' ? id::text loop
  ext:=(p_mappings->'entity_contracts'->>x.id::text)::uuid;
  if ids->>x.entity_id::text is null or not exists(select 1 from public.contracting_entity_contracts actual join clinic_reception.entities rx on rx.contracting_entity_id=actual.entity_id where rx.id=(ids->>x.entity_id::text)::uuid and actual.id=ext and actual.status='active') then raise exception 'راجع جهة العقد واعتماده';end if;
  insert into clinic_reception.entity_contracts(workspace_id,entity_id,service_code,price,coverage,valid_from,valid_to,reference,terms,status,created_by,reviewed_by,external_contract_id) values(target,(ids->>x.entity_id::text)::uuid,x.service_code,x.price,x.coverage,x.valid_from,x.valid_to,x.reference,x.terms,x.status,x.created_by,x.reviewed_by,ext);
 end loop;
 for x in select * from clinic_reception.package_templates where workspace_id=w.id and active and p_mappings->'templates' ? id::text loop
  insert into clinic_reception.package_templates(workspace_id,code,name,version,price,visits,validity_days,terms) values(target,x.code,x.name,x.version,x.price,x.visits,x.validity_days,x.terms) returning id into v;ids:=ids||jsonb_build_object(x.id::text,v);
 end loop;
 for x in select l.* from clinic_reception.template_lines l join clinic_reception.package_templates t on t.id=l.template_id where t.workspace_id=w.id and ids ? l.template_id::text loop
  if ids->>x.service_id::text is null then raise exception 'خدمة باكج لم تحدد ضمن الخدمات المنقولة';end if;
  select to_jsonb(s) into bom from clinic_reception.services s where s.id=(ids->>x.service_id::text)::uuid;
  insert into clinic_reception.template_lines(template_id,visit_no,service_id,quantity,standalone_price,service_snapshot) values((ids->>x.template_id::text)::uuid,x.visit_no,(ids->>x.service_id::text)::uuid,x.quantity,x.standalone_price,bom);
 end loop;
 insert into clinic_reception.members select target,m.admin_id,m.capabilities from clinic_reception.members m where m.workspace_id=w.id and p_mappings->'members' ? m.admin_id::text;
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail) values(target,me,'cutover_prepared',p_plan,jsonb_build_object('configuration_hash',plan.configuration_hash,'mappings',p_mappings,'activation',false));
 -- Deliberately no patients, reservations, balances, journals or training hours are copied, and no setting is enabled.
 return target;
end $$;
do $$declare r record;begin
 for r in select tablename from pg_tables where schemaname='clinic_reception' loop execute format('alter table clinic_reception.%I enable row level security',r.tablename);execute format('revoke all on clinic_reception.%I from public,anon,authenticated',r.tablename);end loop;
 for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_reception' or n.nspname='clinic_finance' and p.proname in ('legacy_doctor_balance','legacy_supplier_balance','doctor_balance','supplier_balance') loop execute format('revoke all on function %s from public,anon,authenticated',r.sig);end loop;
end $$;
revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid),public.clinic_reception_snapshot(uuid,date,date),public.clinic_reception_directory(uuid,text),public.clinic_reception_finance_overview(date,date),public.clinic_reception_indicator_export(uuid,date,date),public.clinic_reception_message_claim(integer),public.clinic_reception_message_ack(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid),public.clinic_reception_snapshot(uuid,date,date),public.clinic_reception_directory(uuid,text),public.clinic_reception_finance_overview(date,date),public.clinic_reception_indicator_export(uuid,date,date) to authenticated;
grant execute on function public.clinic_reception_message_claim(integer),public.clinic_reception_message_ack(uuid,uuid,text,text) to service_role;
create or replace function public.clinic_reception_masters(p_workspace uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 perform clinic_reception.access(p_workspace,'manage');if not clinic_finance.allowed('view') then raise exception 'راجع صلاحية الحسابات';end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',base_unit,'sku',sku)),'[]') from public.inventory_items where active),'locations',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.inventory_locations where active),'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.inventory_suppliers where active),'registers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'direction',operation_mode)),'[]') from clinic_finance.registers),'entities',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.contracting_entities),'entity_contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',contract_number,'entity_id',entity_id)),'[]') from public.contracting_entity_contracts where status='active'),'pricing_supplies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',unit_type)),'[]') from public.pricing_supplies where active),'pricing_services',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'category',category,'base_price',base_price,'supplies_used',supplies_used,'profit_margin_percent',profit_margin_percent)),'[]') from public.pricing_services where active));
end $$;
revoke all on function public.clinic_reception_masters(uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_masters(uuid) to authenticated;
create or replace function public.clinic_reception_links(p_workspace uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 perform clinic_reception.access(p_workspace,'book');if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then raise exception 'روابط فعلية للتشغيل فقط';end if;
 return jsonb_build_object('leads',case when public.can_access_leads() then(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select l.id,p.name,p.file_no,l.source from public.leads l join clinic_reception.patients p on p.patient_id=l.patient_id where p.workspace_id=p_workspace order by l.id limit 100)x) else '[]'::jsonb end,'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.title)),'[]') from public.task_projects p where p.archived_at is null and public.task_can_access_project(p.id)));
end $$;
revoke all on function public.clinic_reception_links(uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_links(uuid) to authenticated;
commit;
