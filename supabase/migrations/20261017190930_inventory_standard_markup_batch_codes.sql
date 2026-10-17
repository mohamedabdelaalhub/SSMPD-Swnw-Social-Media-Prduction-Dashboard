-- Explicit missing manufacturer code, with a separate internal receiving reference.
alter table public.inventory_lots add column lot_code_missing boolean not null default false;
alter table public.inventory_request_lines add column lot_code_missing boolean not null default false;
do $$declare d text;begin
 d:=pg_get_functiondef('clinic_finance.inventory_batch_dates(jsonb)'::regprocedure);
 if position('v:=v||jsonb_build_array' in d)=0 then raise exception 'Batch normalization hook changed';end if;
 d:=replace(d,'v:=v||jsonb_build_array', 'if coalesce((r->>''lot_code_missing'')::boolean,false) then r:=r||jsonb_build_object(''lot_number'',''INT-''||gen_random_uuid()::text);end if;v:=v||jsonb_build_array');execute d;
 d:=pg_get_functiondef('clinic_finance.supplier_receive_base(uuid,jsonb,text)'::regprocedure);
 if position('created_by,production_date,shelf_life_months)' in d)=0 then raise exception 'Receipt batch hook changed';end if;
 d:=replace(d,'created_by,production_date,shelf_life_months)','created_by,production_date,shelf_life_months,lot_code_missing)');
 d:=replace(d,'nullif(r->>''shelf_life_months'','''')::integer) returning id into lid;','nullif(r->>''shelf_life_months'','''')::integer,coalesce((r->>''lot_code_missing'')::boolean,false)) returning id into lid;');execute d;
 d:=pg_get_functiondef('public.inventory_create_request(text,text,text,jsonb)'::regprocedure);
 if position('set production_date=' in d)=0 then raise exception 'Request batch hook changed';end if;
 d:=replace(d,'set production_date=','set lot_code_missing=coalesce((r->>''lot_code_missing'')::boolean,false),production_date=');execute d;
end $$;
-- Configuring the standard is an explicit management action, with no assumed rate.
create table clinic_finance.inventory_pricing_settings(id boolean primary key default true check(id),configured boolean not null default false,markup_percent numeric(12,4) not null default 0 check(markup_percent between 0 and 10000),updated_by uuid references public.admins(id),updated_at timestamptz not null default now());
insert into clinic_finance.inventory_pricing_settings(id) values(true);
alter table clinic_finance.inventory_pricing_settings enable row level security;
revoke all on clinic_finance.inventory_pricing_settings from public,anon,authenticated;
alter table public.inventory_items add column use_standard_markup boolean not null default false;
alter table public.inventory_items alter column use_standard_markup set default true;
create function clinic_finance.inventory_apply_standard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$declare setting clinic_finance.inventory_pricing_settings%rowtype;c numeric;begin
 select * into setting from clinic_finance.inventory_pricing_settings where id;
 if new.use_standard_markup and setting.configured then
  new.markup_percent:=setting.markup_percent;c:=clinic_finance.inventory_highest_purchase(new.id);
  if c is not null then new.current_sale_price:=round(c*(1+new.markup_percent/100),2);end if;
 elsif new.use_standard_markup then new.use_standard_markup:=false;end if;return new;
end $$;
create trigger inventory_standard_markup before insert or update of markup_percent,use_standard_markup on public.inventory_items for each row execute function clinic_finance.inventory_apply_standard();
create function public.inventory_set_standard_markup(p_markup numeric,p_apply_all boolean default false) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$declare i public.inventory_items%rowtype;c numeric;price numeric;total integer:=0;begin
 if not public.inventory_is_manager() or not exists(select 1 from public.admins where id=public.my_admin_id() and active) then raise exception 'إعداد الهامش الموحّد لإدارة المركز';end if;
 if p_markup is null or p_markup::text in ('NaN','Infinity','-Infinity') or p_markup<0 or p_markup>10000 or p_markup<>round(p_markup,4) then raise exception 'أدخل نسبة من صفر إلى10000';end if;
 update clinic_finance.inventory_pricing_settings set configured=true,markup_percent=p_markup,updated_by=public.my_admin_id(),updated_at=now() where id;
 for i in select * from public.inventory_items where use_standard_markup or p_apply_all order by id for update loop
  c:=clinic_finance.inventory_highest_purchase(i.id);price:=case when c is null then i.current_sale_price else round(c*(1+p_markup/100),2) end;
  update public.inventory_items set use_standard_markup=true,markup_percent=p_markup,current_sale_price=price,updated_at=now() where id=i.id;
  if i.current_sale_price<>price or i.markup_percent<>p_markup then insert into public.inventory_price_history(item_id,previous_price,new_price,previous_markup,new_markup,changed_by) values(i.id,i.current_sale_price,price,i.markup_percent,p_markup,public.my_admin_id());end if;
  total:=total+1;
 end loop;
 insert into public.inventory_audit_events(entity_id,kind,actor_id,detail) values(public.my_admin_id(),'standard_markup',public.my_admin_id(),'rate='||p_markup||';apply_all='||p_apply_all||';items='||total);return total;
end $$;
alter function public.inventory_save_catalog(uuid,text,jsonb) rename to inventory_catalog_before_standard;
alter function public.inventory_catalog_before_standard(uuid,text,jsonb) set schema clinic_finance;
create function public.inventory_save_catalog(p_location uuid,p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare v uuid;use_default boolean;setting clinic_finance.inventory_pricing_settings%rowtype;cost numeric;rate numeric;begin
 if not public.inventory_location_can(p_location,'manage') then raise exception 'غير مسموح بإدارة الأصناف';end if;
 if p_action<>'item' then return clinic_finance.inventory_catalog_before_standard(p_location,p_action,p_payload);end if;
 select * into setting from clinic_finance.inventory_pricing_settings where id;
 v:=nullif(p_payload->>'p_id','')::uuid;
 if v is not null then perform 1 from public.inventory_items where id=v for update;end if;
 use_default:=coalesce((p_payload->>'p_use_standard_markup')::boolean,(select use_standard_markup from public.inventory_items where id=v),setting.configured);
 if use_default and not setting.configured then raise exception 'حدد نسبة الهامش الموحّد أولًا';end if;
 rate:=case when use_default then setting.markup_percent else (p_payload->>'p_markup')::numeric end;
 if v is not null then update public.inventory_items set use_standard_markup=false where id=v;end if;
 p_payload:=p_payload||jsonb_build_object('p_markup',rate);v:=clinic_finance.inventory_catalog_before_standard(p_location,p_action,p_payload);
 cost:=clinic_finance.inventory_highest_purchase(v);
 update public.inventory_items set use_standard_markup=use_default,markup_percent=rate,current_sale_price=case when cost is null then (p_payload->>'p_sale_price')::numeric else round(cost*(1+rate/100),2) end where id=v;return v;
end $$;
alter function public.inventory_workspace_snapshot(uuid) rename to inventory_snapshot_before_standard;
alter function public.inventory_snapshot_before_standard(uuid) set schema clinic_finance;
create function public.inventory_workspace_snapshot(p_location uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb;begin
 v:=clinic_finance.inventory_snapshot_before_standard(p_location);return v||jsonb_build_object('pricing_settings',case when (v->>'can_manage')::boolean then(select jsonb_build_object('configured',configured,'markup_percent',markup_percent,'can_update',public.inventory_is_manager()) from clinic_finance.inventory_pricing_settings where id) else null end);
end $$;
revoke all on function clinic_finance.inventory_apply_standard(),clinic_finance.inventory_catalog_before_standard(uuid,text,jsonb),clinic_finance.inventory_snapshot_before_standard(uuid) from public,anon,authenticated;
revoke all on function public.inventory_set_standard_markup(numeric,boolean),public.inventory_save_catalog(uuid,text,jsonb),public.inventory_workspace_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.inventory_set_standard_markup(numeric,boolean),public.inventory_save_catalog(uuid,text,jsonb),public.inventory_workspace_snapshot(uuid) to authenticated;
notify pgrst,'reload schema';
-- Searchable historical registry includes exhausted lots; no prices or patient data.
create index inventory_internal_codes on public.inventory_lots(received_at desc,id) where lot_code_missing;
create function public.inventory_tracking_codes(p_location uuid,p_query text default '',p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare q text:=trim(coalesce(p_query,''));total integer;rows jsonb;begin
 if not public.inventory_location_can(p_location,'view') then raise exception 'سجل التتبع غير متاح لهذا المخزن';end if;
 if length(q)>120 or p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'راجع البحث أو رقم الصفحة';end if;
 select count(*) into total from public.inventory_lots l join public.inventory_items i on i.id=l.item_id where l.lot_code_missing and (q='' or position(lower(q) in lower(l.lot_number||' '||i.name||' '||coalesce(i.sku,'')||' '||coalesce(l.supplier_name,'')))>0) and exists(select 1 from public.inventory_movements m where m.lot_id=l.id and m.location_id=p_location);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.received_at desc,x.id),'[]') into rows from(
 select l.id,l.lot_number code,i.name item_name,i.sku,l.supplier_name,l.received_at,l.received_quantity,l.production_date,l.shelf_life_months,l.expiry_date,public.inventory_location_balance(p_location,l.item_id,l.id,false) remaining,
 case when public.inventory_location_can(p_location,'manage') then (select r.reference from clinic_finance.supplier_receipts r join public.inventory_movements m on m.reference_id=r.order_id and m.note='فاتورة مورد '||r.reference where m.lot_id=l.id and m.movement_type='receipt' order by r.created_at limit 1) end invoice_reference
 from public.inventory_lots l join public.inventory_items i on i.id=l.item_id where l.lot_code_missing and (q='' or position(lower(q) in lower(l.lot_number||' '||i.name||' '||coalesce(i.sku,'')||' '||coalesce(l.supplier_name,'')))>0) and exists(select 1 from public.inventory_movements m where m.lot_id=l.id and m.location_id=p_location) order by l.received_at desc,l.id offset p_offset limit 50)x;
 return jsonb_build_object('rows',rows,'total',total,'offset',p_offset,'page_size',50);end $$;
revoke all on function public.inventory_tracking_codes(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.inventory_tracking_codes(uuid,text,integer) to authenticated;
create unique index inventory_internal_code_unique on public.inventory_lots(lot_number) where lot_code_missing;
