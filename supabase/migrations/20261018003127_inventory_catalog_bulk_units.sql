-- Catalog definitions only: no movements, supplier liabilities, receipts or journal entries.
alter table public.inventory_items add column pack_unit text not null default 'عبوة' check(length(trim(pack_unit)) between 1 and 60);
create table clinic_finance.inventory_catalog_prices(item_id uuid primary key references public.inventory_items(id) on delete cascade,reference_purchase_price numeric(14,4) check(reference_purchase_price>=0));
alter table clinic_finance.inventory_catalog_prices enable row level security;
revoke all on clinic_finance.inventory_catalog_prices from public,anon,authenticated;
create sequence clinic_finance.inventory_sku_sequence;
revoke all on sequence clinic_finance.inventory_sku_sequence from public,anon,authenticated;
create function clinic_finance.inventory_assign_sku() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare n bigint;
begin
 if nullif(trim(new.sku),'') is null then
  if tg_op='UPDATE' and nullif(trim(old.sku),'') is not null then new.sku:=old.sku;
  else loop
   n:=nextval('clinic_finance.inventory_sku_sequence'::regclass);
   new.sku:='ITM-'||lpad(n::text,greatest(7,length(n::text)),'0');
   exit when not exists(select 1 from public.inventory_items where sku=new.sku);
  end loop;end if;
 end if;return new;
end $$;
create trigger inventory_assign_sku before insert or update of sku on public.inventory_items for each row execute function clinic_finance.inventory_assign_sku();
-- Existing explicit codes are retained. Missing codes acquire stable catalog identifiers.
update public.inventory_items set sku=null where nullif(trim(sku),'') is null;
create function clinic_finance.catalog_name_key(v text) returns text language sql immutable set search_path=pg_catalog as $$
 select regexp_replace(translate(lower(trim(v)),'أإآى','اااي'),'[[:space:]ـًٌٍَُِّْ]+','','g')
$$;
alter function public.inventory_save_catalog(uuid,text,jsonb) rename to inventory_catalog_before_units;
alter function public.inventory_catalog_before_units(uuid,text,jsonb) set schema clinic_finance;
create function public.inventory_save_catalog(p_location uuid,p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v uuid;old public.inventory_items%rowtype;pack text;cost numeric;
begin
 if not exists(select 1 from public.admins where id=public.my_admin_id() and active) or not public.inventory_location_can(p_location,'manage') then raise exception 'إدارة الأصناف تحتاج صلاحية إدارة المخزن';end if;
 if p_action='item' then
  if nullif(p_payload->>'p_id','') is null then
   perform pg_advisory_xact_lock(hashtextextended('inventory_catalog_definitions',0));
   if exists(select 1 from public.inventory_items where clinic_finance.catalog_name_key(name)=clinic_finance.catalog_name_key(p_payload->>'p_name') and clinic_finance.catalog_name_key(base_unit)=clinic_finance.catalog_name_key(p_payload->>'p_base_unit')) then raise exception 'الصنف مسجل بنفس الاسم والوحدة. عدل الصنف الموجود';end if;
  else
   select * into old from public.inventory_items where id=(p_payload->>'p_id')::uuid for update;
   if found and (old.units_per_pack<>(p_payload->>'p_units_per_pack')::numeric or old.base_unit<>trim(p_payload->>'p_base_unit')) and
    (exists(select 1 from public.inventory_movements where item_id=old.id) or exists(select 1 from public.inventory_request_lines where item_id=old.id) or exists(select 1 from public.pricing_supplies where inventory_item_id=old.id)) then raise exception 'لا تغير وحدة الصرف أو عدد وحدات العبوة بعد الربط أو تسجيل الطلبات والحركات';end if;
  end if;
  if p_payload ? 'p_pack_unit' then pack:=trim(p_payload->>'p_pack_unit');if pack is null or length(pack) not between 1 and 60 then raise exception 'أدخل اسم الوحدة الكبرى';end if;end if;
  if p_payload ? 'p_reference_purchase_price' then
   cost:=nullif(p_payload->>'p_reference_purchase_price','')::numeric;
   if cost is not null and (cost::text in ('NaN','Infinity','-Infinity') or cost<0 or cost>=10000000000 or cost<>round(cost,4)) then raise exception 'راجع سعر الشراء الاسترشادي للوحدة الصغرى';end if;
  end if;
 end if;
 v:=clinic_finance.inventory_catalog_before_units(p_location,p_action,p_payload);
 if p_action='item' then
  if p_payload ? 'p_pack_unit' then update public.inventory_items set pack_unit=pack where id=v;end if;
  if p_payload ? 'p_reference_purchase_price' then insert into clinic_finance.inventory_catalog_prices(item_id,reference_purchase_price) values(v,cost) on conflict(item_id) do update set reference_purchase_price=excluded.reference_purchase_price;end if;
 end if;return v;
end $$;
alter function public.inventory_workspace_snapshot(uuid) rename to inventory_snapshot_before_catalog_units;
alter function public.inventory_snapshot_before_catalog_units(uuid) set schema clinic_finance;
create function public.inventory_workspace_snapshot(p_location uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb;
begin
 v:=clinic_finance.inventory_snapshot_before_catalog_units(p_location);
 if coalesce((v->>'can_manage')::boolean,false) then
  v:=v||jsonb_build_object('items',(select coalesce(jsonb_agg(x||jsonb_build_object('reference_purchase_price',(select c.reference_purchase_price from clinic_finance.inventory_catalog_prices c where c.item_id=(x->>'id')::uuid))),'[]'::jsonb) from jsonb_array_elements(v->'items') x));
 end if;return v;
end $$;
revoke all on function clinic_finance.inventory_snapshot_before_catalog_units(uuid) from public,anon,authenticated;
revoke all on function public.inventory_workspace_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.inventory_workspace_snapshot(uuid) to authenticated;
create table clinic_finance.inventory_catalog_imports(
 actor_id uuid not null references public.admins(id),token uuid not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,token)
);
alter table clinic_finance.inventory_catalog_imports enable row level security;
revoke all on clinic_finance.inventory_catalog_imports from public,anon,authenticated;
create function public.inventory_import_catalog(p_location uuid,p_rows jsonb,p_token uuid,p_pricing boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();payload jsonb:=jsonb_build_object('location',p_location,'rows',p_rows,'pricing',p_pricing);prior clinic_finance.inventory_catalog_imports%rowtype;
 r jsonb;v uuid;i public.inventory_items%rowtype;result jsonb:='[]';k integer:=0;factor numeric;cost numeric;rate numeric;price numeric;minimum numeric;consume numeric;use_standard boolean;setting clinic_finance.inventory_pricing_settings%rowtype;
begin
 if me is null or not exists(select 1 from public.admins where id=me and active) or not public.inventory_location_can(p_location,'manage') then raise exception 'استيراد الأصناف يحتاج صلاحية إدارة المخزن المحدد';end if;
 if p_pricing is null then raise exception 'حدد وجهة الاستيراد';end if;
 if p_pricing and not (public.can_manage_all_content() or (public.is_controlled_finance() and public.finance_module_allowed('accounting','create'))) then raise exception 'إضافة المستلزمات للتسعير تحتاج صلاحية إضافة بالحسابات';end if;
 if p_token is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'ارفع من صنف واحد إلى500 صنف';end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory_catalog_definitions',0));
 select * into prior from clinic_finance.inventory_catalog_imports where actor_id=me and token=p_token;
 if found then if prior.payload is distinct from payload then raise exception 'محتوى الطلب يختلف عن العملية المحفوظة. أعد فتح المعاينة';end if;return prior.result;end if;
 select * into setting from clinic_finance.inventory_pricing_settings where id;
 for r in select * from jsonb_array_elements(p_rows) loop
  k:=k+1;
  begin
   if jsonb_typeof(r) is distinct from 'object' or length(trim(coalesce(r->>'name',''))) not between 2 and 180 or length(trim(coalesce(r->>'base_unit',''))) not between 1 and 60 or length(trim(coalesce(r->>'pack_unit',''))) not between 1 and 60 or length(coalesce(r->>'category',''))>100 then raise exception 'راجع الاسم والفئة والوحدتين';end if;
   factor:=(r->>'units_per_pack')::numeric;cost:=nullif(r->>'reference_purchase_price','')::numeric;rate:=coalesce(nullif(r->>'markup_percent','')::numeric,0);minimum:=coalesce(nullif(r->>'minimum_quantity','')::numeric,0);consume:=coalesce(nullif(r->>'consumption_per_patient','')::numeric,1);
   use_standard:=coalesce((r->>'use_standard_markup')::boolean,false);
   if use_standard and not setting.configured then raise exception 'الهامش الموحّد غير معد';end if;
   if use_standard then rate:=setting.markup_percent;end if;
   price:=coalesce(nullif(r->>'sale_price','')::numeric,round(cost*(1+rate/100),2),0);
   if factor is null or factor::text in ('NaN','Infinity','-Infinity') or factor<=0 or factor>1000000 or factor<>round(factor,3) or rate::text in ('NaN','Infinity','-Infinity') or rate<0 or rate>1000 or rate<>round(rate,3) or minimum::text in ('NaN','Infinity','-Infinity') or minimum<0 or minimum>1000000000 or minimum<>round(minimum,3) or consume::text in ('NaN','Infinity','-Infinity') or consume<0 or consume>1000000 or consume<>round(consume,3) or price::text in ('NaN','Infinity','-Infinity') or price<0 or price>1000000000 or price<>round(price,2) then raise exception 'راجع الأعداد والأسعار والنسب ودقة الكسور';end if;
   if p_pricing and cost is null then raise exception 'أدخل سعر الشراء الاسترشادي لتكلفة مستلزم التسعير';end if;
   if p_pricing and exists(select 1 from public.pricing_supplies where clinic_finance.catalog_name_key(name)=clinic_finance.catalog_name_key(r->>'name')) then raise exception 'مستلزم التسعير مسجل بهذا الاسم بالفعل';end if;
   v:=public.inventory_save_catalog(p_location,'item',jsonb_build_object('p_id',null,'p_sku','','p_name',trim(r->>'name'),'p_category',coalesce(nullif(trim(r->>'category'),''),'عام'),'p_base_unit',trim(r->>'base_unit'),'p_pack_unit',trim(r->>'pack_unit'),'p_units_per_pack',factor,'p_minimum',minimum,'p_markup',rate,'p_sale_price',price,'p_use_standard_markup',use_standard,'p_reference_purchase_price',cost));
   perform public.inventory_save_catalog(p_location,'track',jsonb_build_object('p_item_id',v,'p_track',coalesce((r->>'track_lots')::boolean,false)));
   select * into i from public.inventory_items where id=v;
   if p_pricing then
    insert into public.pricing_supplies(name,unit_type,units_per_package,package_price,consumption_per_patient,category,created_by,inventory_item_id,inventory_quantity_per_unit)
    values(i.name,i.pack_unit,factor,round(cost*factor,2),consume,i.category,me,v,1);
   end if;
   result:=result||jsonb_build_array(jsonb_build_object('id',v,'sku',i.sku,'name',i.name));
  exception when others then raise exception 'السطر %: %',k,sqlerrm using errcode='22023';end;
 end loop;
 insert into clinic_finance.inventory_catalog_imports(actor_id,token,payload,result) values(me,p_token,payload,result);
 insert into public.inventory_audit_events(entity_id,kind,actor_id,detail) values(me,'catalog_import',me,'items='||k||';pricing='||p_pricing||';token='||p_token);
 return result;
end $$;
revoke all on function clinic_finance.inventory_assign_sku(),clinic_finance.catalog_name_key(text),clinic_finance.inventory_catalog_before_units(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.inventory_save_catalog(uuid,text,jsonb),public.inventory_import_catalog(uuid,jsonb,uuid,boolean) from public,anon,authenticated;
grant execute on function public.inventory_save_catalog(uuid,text,jsonb),public.inventory_import_catalog(uuid,jsonb,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
