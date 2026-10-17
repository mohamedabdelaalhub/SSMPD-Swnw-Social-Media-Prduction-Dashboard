-- Invoice-linked receipt quantities/costs remain the accounting source. Highest purchase cost is a pricing reference only.
alter table public.inventory_request_lines add column production_date date,add column shelf_life_months integer check(shelf_life_months between 1 and 1200);
alter table public.inventory_lots add column production_date date,add column shelf_life_months integer check(shelf_life_months between 1 and 1200);
alter table clinic_finance.supplier_receipts add column invoice_date date,add column document_url text not null default '',add column invoice_total numeric(14,2) check(invoice_total>=0);
create function clinic_finance.inventory_highest_purchase(p_item uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select max(unit_cost) from public.inventory_movements where item_id=p_item and movement_type='receipt' and reference_type='purchase' and quantity_delta>0$$;
create index inventory_purchase_cost_idx on public.inventory_movements(item_id,unit_cost desc) where movement_type='receipt' and reference_type='purchase' and quantity_delta>0;
create function clinic_finance.inventory_batch_dates(p_lines jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare r jsonb;v jsonb:='[]';prod date;exp date;months integer;calculated date;begin
 if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'راجع بنود الطلب';end if;
 for r in select * from jsonb_array_elements(p_lines) loop
  prod:=nullif(r->>'production_date','')::date;exp:=nullif(r->>'expiry_date','')::date;months:=nullif(r->>'shelf_life_months','')::integer;
  if prod>(now() at time zone 'Africa/Cairo')::date or months is not null and (months not between 1 and 1200 or prod is null) then raise exception 'راجع تاريخ الإنتاج ومدة الصلاحية بالشهور';end if;
  if prod is not null and months is not null then calculated:=(prod+make_interval(months=>months))::date;if exp is not null and exp<>calculated then raise exception 'تاريخ الانتهاء لا يطابق الإنتاج ومدة الصلاحية؛ راجع بيانات العبوة';end if;exp:=calculated;end if;
  if exp<prod or exp<(now() at time zone 'Africa/Cairo')::date then raise exception 'راجع تاريخ انتهاء التشغيلة؛ لا تستلم صنفًا منتهيًا';end if;
  v:=v||jsonb_build_array(r||jsonb_build_object('production_date',prod,'shelf_life_months',months,'expiry_date',exp));
 end loop;return v;
end $$;
alter function public.inventory_create_request(text,text,text,jsonb) rename to inventory_request_before_dates;
alter function public.inventory_request_before_dates(text,text,text,jsonb) set schema clinic_finance;
create function public.inventory_create_request(p_type text,p_note text,p_supplier_name text,p_lines jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare v uuid;r jsonb;lines jsonb:=p_lines;begin
 if p_type='purchase' then lines:=clinic_finance.inventory_batch_dates(p_lines);end if;
 v:=clinic_finance.inventory_request_before_dates(p_type,p_note,p_supplier_name,lines);
 if p_type='purchase' then for r in select * from jsonb_array_elements(lines) loop update public.inventory_request_lines set production_date=(r->>'production_date')::date,shelf_life_months=(r->>'shelf_life_months')::integer where request_id=v and item_id=(r->>'item_id')::uuid;end loop;end if;return v;
end $$;
-- Modify the single shared allocation path, preserving its authorization, item/order locks and actual receipt valuation.
do $$declare d text;begin
 d:=pg_get_functiondef('clinic_finance.supplier_receive_base(uuid,jsonb,text)'::regprocedure);
 if position('price:=round(cost*(1+i.markup_percent/100),2);' in d)=0 or position('item_id,lot_number,expiry_date,received_quantity,unit_cost,supplier_name,created_by)' in d)=0 then raise exception 'Receipt hooks changed; review source before migration';end if;
 d:=replace(d,'price:=round(cost*(1+i.markup_percent/100),2);','price:=round(greatest(cost,coalesce(clinic_finance.inventory_highest_purchase(i.id),0))*(1+i.markup_percent/100),2);');
 d:=replace(d,'item_id,lot_number,expiry_date,received_quantity,unit_cost,supplier_name,created_by)','item_id,lot_number,expiry_date,received_quantity,unit_cost,supplier_name,created_by,production_date,shelf_life_months)');
 d:=replace(d,'q,cost,req.supplier_name,public.my_admin_id()) returning id into lid;','q,cost,req.supplier_name,public.my_admin_id(),nullif(r->>''production_date'','''')::date,nullif(r->>''shelf_life_months'','''')::integer) returning id into lid;');
 d:=replace(d,'if i.track_lots or nullif(r->>''lot_number'','''') is not null or nullif(r->>''expiry_date'','''') is not null then','if i.track_lots or nullif(r->>''lot_number'','''') is not null or nullif(r->>''expiry_date'','''') is not null or nullif(r->>''production_date'','''') is not null then');
 execute d;
end $$;
alter function public.inventory_receive_request(uuid,jsonb,text) rename to inventory_receive_before_dates;
alter function public.inventory_receive_before_dates(uuid,jsonb,text) set schema clinic_finance;
create function public.inventory_receive_request(p_id uuid,p_lines jsonb,p_note text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if not exists(select 1 from clinic_finance.supplier_receipts where order_id=p_id and created_by=public.my_admin_id() and payload->'lines'=p_lines and created_at=transaction_timestamp()) then raise exception 'سجل الاستلام من فاتورة مورد برقمها؛ لا توريد دون مستند';end if;
 perform clinic_finance.inventory_receive_before_dates(p_id,clinic_finance.inventory_batch_dates(p_lines),p_note);
end $$;
alter function public.inventory_receive_document(uuid,jsonb,text,uuid) rename to inventory_document_before_header;
alter function public.inventory_document_before_header(uuid,jsonb,text,uuid) set schema clinic_finance;
create function public.inventory_receive_invoice(p_order uuid,p_lines jsonb,p_reference text,p_invoice_date date,p_document_url text,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare r clinic_finance.supplier_receipts%rowtype;v uuid;total numeric;url text:=trim(coalesce(p_document_url,''));begin
 if not public.inventory_location_can('00000000-0000-4000-8000-000000000001','manage') then raise exception 'فاتورة التوريد لمسؤول المخزن الرئيسي';end if;
 if p_invoice_date is null or p_invoice_date>(now() at time zone 'Africa/Cairo')::date or length(url)>2000 or (url<>'' and url!~* '^https?://[^[:space:]]+$') then raise exception 'راجع تاريخ الفاتورة ورابط المستند';end if;
 perform pg_advisory_xact_lock(hashtextextended(public.my_admin_id()::text||coalesce(p_token::text,''),0));
 select * into r from clinic_finance.supplier_receipts where created_by=public.my_admin_id() and token=p_token;
 if found and ((r.invoice_date is not null and r.invoice_date<>p_invoice_date) or r.document_url<>url) then raise exception 'مفتاح طلب مختلف لبيانات فاتورة المورد';end if;
 select round(sum((j->>'quantity')::numeric*(j->>'package_cost')::numeric/i.units_per_pack),2) into total from jsonb_array_elements(p_lines) j join public.inventory_items i on i.id=(j->>'item_id')::uuid;
 v:=clinic_finance.inventory_document_before_header(p_order,p_lines,p_reference,p_token);
 update clinic_finance.supplier_receipts set invoice_date=coalesce(invoice_date,p_invoice_date),document_url=url,invoice_total=coalesce(invoice_total,total) where id=v;return v;
end $$;
create function public.inventory_receive_document(p_order uuid,p_lines jsonb,p_reference text,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare d date;begin
 select coalesce(invoice_date,(created_at at time zone 'Africa/Cairo')::date) into d from clinic_finance.supplier_receipts where created_by=public.my_admin_id() and token=p_token;
 return public.inventory_receive_invoice(p_order,p_lines,p_reference,coalesce(d,(now() at time zone 'Africa/Cairo')::date),'',p_token);
end $$;
create or replace function public.clinic_finance_supplier_receive(p_order uuid,p_lines jsonb,p_reference text,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$begin
 perform clinic_finance.require_access('create');return public.inventory_receive_document(p_order,p_lines,p_reference,p_token);
end $$;
-- Catalog edits use the same highest-price reference after purchases; actual stock valuation remains unchanged.
alter function public.inventory_save_catalog(uuid,text,jsonb) rename to inventory_catalog_before_pricing;
alter function public.inventory_catalog_before_pricing(uuid,text,jsonb) set schema clinic_finance;
create function public.inventory_save_catalog(p_location uuid,p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare cost numeric;begin
 if not public.inventory_location_can(p_location,'manage') then raise exception 'غير مسموح بإدارة الأصناف';end if;
 if p_action='item' and nullif(p_payload->>'p_id','') is not null then perform 1 from public.inventory_items where id=(p_payload->>'p_id')::uuid for update;cost:=clinic_finance.inventory_highest_purchase((p_payload->>'p_id')::uuid);if cost is not null then p_payload:=p_payload||jsonb_build_object('p_sale_price',round(cost*(1+(p_payload->>'p_markup')::numeric/100),2));end if;end if;
 return clinic_finance.inventory_catalog_before_pricing(p_location,p_action,p_payload);
end $$;
create function clinic_finance.sync_supply_purchase_reference() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if new.movement_type='receipt' and new.reference_type='purchase' and to_regclass('public.pricing_supplies') is not null then
  execute 'update public.pricing_supplies set package_price=$1*inventory_quantity_per_unit*units_per_package where inventory_item_id=$2 and inventory_quantity_per_unit>0 and units_per_package>0' using clinic_finance.inventory_highest_purchase(new.item_id),new.item_id;
 end if;return new;
end $$;
create trigger inventory_supply_reference after insert on public.inventory_movements for each row execute function clinic_finance.sync_supply_purchase_reference();
alter function public.inventory_workspace_snapshot(uuid) rename to inventory_snapshot_before_invoice;
alter function public.inventory_snapshot_before_invoice(uuid) set schema clinic_finance;
create function public.inventory_workspace_snapshot(p_location uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare v jsonb;manager boolean;begin
 v:=clinic_finance.inventory_snapshot_before_invoice(p_location);manager:=(v->>'can_manage')::boolean;
 v:=v||jsonb_build_object('items',(select coalesce(jsonb_agg(x||jsonb_build_object('highest_purchase_cost',case when manager then clinic_finance.inventory_highest_purchase((x->>'id')::uuid) end)),'[]') from jsonb_array_elements(v->'items') x),
 'supplier_invoices',case when manager then(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'order_id',r.order_id,'reference',r.reference,'invoice_date',r.invoice_date,'document_url',r.document_url,'invoice_total',r.invoice_total,'supplier_name',s.name) order by r.created_at desc),'[]') from clinic_finance.supplier_receipts r join public.inventory_suppliers s on s.id=r.supplier_id where exists(select 1 from public.inventory_movements m where m.reference_id=r.order_id and m.reference_type='purchase' and m.note='فاتورة مورد '||r.reference and public.inventory_location_can(m.location_id,'manage'))) else '[]'::jsonb end);return v;
end $$;
-- Only guarded public APIs are available; private helpers and retained implementations are not RPC bypasses.
revoke all on function clinic_finance.inventory_highest_purchase(uuid),clinic_finance.inventory_batch_dates(jsonb),clinic_finance.inventory_request_before_dates(text,text,text,jsonb),clinic_finance.inventory_receive_before_dates(uuid,jsonb,text),clinic_finance.inventory_document_before_header(uuid,jsonb,text,uuid),clinic_finance.inventory_catalog_before_pricing(uuid,text,jsonb),clinic_finance.sync_supply_purchase_reference(),clinic_finance.inventory_snapshot_before_invoice(uuid) from public,anon,authenticated;
revoke all on function public.inventory_create_request(text,text,text,jsonb),public.inventory_receive_request(uuid,jsonb,text),public.inventory_receive_invoice(uuid,jsonb,text,date,text,uuid),public.inventory_receive_document(uuid,jsonb,text,uuid),public.inventory_save_catalog(uuid,text,jsonb),public.inventory_workspace_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.inventory_create_request(text,text,text,jsonb),public.inventory_receive_request(uuid,jsonb,text),public.inventory_receive_invoice(uuid,jsonb,text,date,text,uuid),public.inventory_receive_document(uuid,jsonb,text,uuid),public.inventory_save_catalog(uuid,text,jsonb),public.inventory_workspace_snapshot(uuid) to authenticated;
alter function public.inventory_save_item(uuid,text,text,text,text,numeric,numeric,numeric,numeric) rename to inventory_item_before_pricing;
alter function public.inventory_item_before_pricing(uuid,text,text,text,text,numeric,numeric,numeric,numeric) set schema clinic_finance;
create function public.inventory_save_item(p_id uuid,p_sku text,p_name text,p_category text,p_base_unit text,p_units_per_pack numeric,p_minimum numeric,p_markup numeric,p_sale_price numeric) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare cost numeric;begin
 if not public.inventory_is_manager() then raise exception 'إدارة الصنف لمسؤول المخزن';end if;
 if p_id is not null then perform 1 from public.inventory_items where id=p_id for update;cost:=clinic_finance.inventory_highest_purchase(p_id);if cost is not null then p_sale_price:=round(cost*(1+p_markup/100),2);end if;end if;
 return clinic_finance.inventory_item_before_pricing(p_id,p_sku,p_name,p_category,p_base_unit,p_units_per_pack,p_minimum,p_markup,p_sale_price);
end $$;
revoke all on function clinic_finance.inventory_item_before_pricing(uuid,text,text,text,text,numeric,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.inventory_save_item(uuid,text,text,text,text,numeric,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.inventory_save_item(uuid,text,text,text,text,numeric,numeric,numeric,numeric) to authenticated;
alter function public.clinic_finance_snapshot(date,date,integer) rename to finance_snapshot_before_purchase_invoice;
alter function public.finance_snapshot_before_purchase_invoice(date,date,integer) set schema clinic_finance;
create function public.clinic_finance_snapshot(p_from date default current_date,p_to date default current_date,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare v jsonb;begin
 v:=clinic_finance.finance_snapshot_before_purchase_invoice(p_from,p_to,p_offset);
 v:=v||jsonb_build_object('purchase_orders',(select coalesce(jsonb_agg(o||jsonb_build_object('lines',(select coalesce(jsonb_agg(l||jsonb_build_object('units_per_pack',(select units_per_pack from public.inventory_items where id=(l->>'item_id')::uuid))),'[]') from jsonb_array_elements(o->'lines') l))),'[]') from jsonb_array_elements(v->'purchase_orders') o));
 return v||jsonb_build_object('supplier_invoices',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'reference',r.reference,'invoice_date',r.invoice_date,'invoice_total',r.invoice_total,'document_url',r.document_url,'supplier_name',s.name) order by r.created_at desc),'[]') from clinic_finance.supplier_receipts r join public.inventory_suppliers s on s.id=r.supplier_id where (r.created_by=public.my_admin_id() or (v->>'can_review')::boolean) and (r.created_at at time zone 'Africa/Cairo')::date between p_from and p_to));
end $$;
revoke all on function clinic_finance.finance_snapshot_before_purchase_invoice(date,date,integer) from public,anon,authenticated;
revoke all on function public.clinic_finance_snapshot(date,date,integer) from public,anon,authenticated;
grant execute on function public.clinic_finance_snapshot(date,date,integer) to authenticated;
