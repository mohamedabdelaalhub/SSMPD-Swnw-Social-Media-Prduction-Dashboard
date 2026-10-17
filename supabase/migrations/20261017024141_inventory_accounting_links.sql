begin;
-- Request prices are per dispensing unit. Keep package_cost for older clients.
alter table public.inventory_request_lines add column if not exists requested_unit_cost numeric(14,4);
alter table public.inventory_request_lines add column if not exists expiry_date date;
alter table public.inventory_request_lines add column if not exists lot_number text not null default '';
alter table public.inventory_request_lines add column if not exists lot_id uuid references public.inventory_lots(id);
create index if not exists inventory_request_line_lot_idx on public.inventory_request_lines(lot_id) where lot_id is not null;
create or replace function public.inventory_create_request(p_type text,p_note text,p_supplier_name text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v uuid;r jsonb;i public.inventory_items%rowtype;q numeric;c numeric;lid uuid;exp date;ln text;
begin
 if not public.inventory_can_view() then raise exception 'غير مسموح بطلب مستلزمات';end if;
 if p_type is null or p_type not in ('purchase','issue') or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 30 then raise exception 'راجع نوع الطلب والأصناف';end if;
 if (select count(distinct x->>'item_id') from jsonb_array_elements(p_lines) x)<>jsonb_array_length(p_lines) then raise exception 'لا تكرر الصنف في نفس الطلب';end if;
 if p_type='purchase' and not exists(select 1 from public.inventory_suppliers where active and name=trim(p_supplier_name)) then raise exception 'اختر موردا مسجلا ونشطا';end if;
 insert into public.inventory_requests(request_type,requester_id,note,supplier_name) values(p_type,public.my_admin_id(),coalesce(p_note,''),case when p_type='purchase' then trim(p_supplier_name) else '' end) returning id into v;
 for r in select * from jsonb_array_elements(p_lines) loop
  select * into i from public.inventory_items where id=(r->>'item_id')::uuid and active for share;
  if not found then raise exception 'الصنف غير موجود';end if;
  q:=(r->>'quantity')::numeric;lid:=nullif(r->>'lot_id','')::uuid;exp:=nullif(r->>'expiry_date','')::date;ln:=trim(coalesce(r->>'lot_number',''));
  if q is null or q<=0 or q::text in ('NaN','Infinity','-Infinity') or q<>round(q,3) then raise exception 'الكمية غير صالحة';end if;
  if p_type='purchase' then
   c:=coalesce(nullif(r->>'unit_cost','')::numeric,nullif(r->>'package_cost','')::numeric/i.units_per_pack);
   if c is null or c<0 or c::text in ('NaN','Infinity','-Infinity') or c<>round(c,4) then raise exception 'أدخل تكلفة وحدة الصرف، والصفر يحتاج إدخالا صريحا';end if;
   if exp<current_date then raise exception 'لا تطلب توريدا منتهي الصلاحية';end if;
   lid:=null;
  else
   if lid is not null then
    select expiry_date,lot_number into exp,ln from public.inventory_lots where id=lid and item_id=i.id and (expiry_date is null or expiry_date>=current_date);
    if not found or public.inventory_location_balance('00000000-0000-4000-8000-000000000001',i.id,lid,false)<=0 then raise exception 'التشغيلة غير متاحة للصرف من الرئيسي';end if;
   else exp:=null;ln:='';end if;
   c:=public.inventory_location_cost('00000000-0000-4000-8000-000000000001',i.id,lid,lid is null);
  end if;
  insert into public.inventory_request_lines(request_id,item_id,quantity,package_cost,requested_unit_cost,expiry_date,lot_number,lot_id)
   values(v,i.id,q,round(c*i.units_per_pack,2),c,exp,ln,lid);
 end loop;
 return v;
end $$;

-- Validate the shared receiving endpoint as well as the new documented UI.
create or replace function public.inventory_receive_request(p_id uuid,p_lines jsonb,p_note text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare line jsonb;c numeric;q numeric;expected numeric;units numeric;
begin
 perform clinic_finance.lock_day();
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0 then raise exception 'أدخل بنود الاستلام';end if;
 for line in select * from jsonb_array_elements(p_lines) loop
  c:=nullif(line->>'package_cost','')::numeric;q:=(line->>'quantity')::numeric;
  if c is not null and (c<0 or c::text in ('NaN','Infinity','-Infinity')) or q is null or q<=0 or q::text in ('NaN','Infinity','-Infinity') then raise exception 'راجع السعر والكمية';end if;
  if nullif(line->>'expiry_date','')::date<current_date then raise exception 'التوريد منتهي الصلاحية';end if;
  select l.requested_unit_cost,i.units_per_pack into expected,units from public.inventory_request_lines l join public.inventory_items i on i.id=l.item_id where l.request_id=p_id and l.item_id=(line->>'item_id')::uuid;
  if expected is not null and c is not null and round(c/units,4)<>expected then raise exception 'السعر يختلف عن الطلب المعتمد؛ أنشئ طلبا بالسعر الجديد للمراجعة';end if;
 end loop;
 perform clinic_finance.supplier_receive_base(p_id,p_lines,p_note);
end $$;

-- A receipt is one documented supplier invoice, not a cash payment.
create or replace function public.inventory_receive_document(p_order uuid,p_lines jsonb,p_reference text,p_token uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();r clinic_finance.supplier_receipts%rowtype;sup uuid;v uuid;
 payload jsonb:=jsonb_build_object('order',p_order,'lines',p_lines,'reference',trim(p_reference));line jsonb;c numeric;q numeric;
begin
 if not public.inventory_location_can('00000000-0000-4000-8000-000000000001','manage') then raise exception 'الاستلام لمسؤول الرئيسي';end if;
 perform clinic_finance.lock_day();
 -- Serialize retries, including simultaneous retries from the same modal.
 perform pg_advisory_xact_lock(hashtextextended(me::text||coalesce(p_token::text,''),0));
 select * into r from clinic_finance.supplier_receipts where created_by=me and token=p_token;
 if found then if r.payload is distinct from payload then raise exception 'مفتاح طلب مختلف';end if;return r.id;end if;
 if p_token is null or length(trim(coalesce(p_reference,''))) not between 2 and 120 or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0 then raise exception 'راجع مرجع فاتورة المورد وبنود الاستلام';end if;
 for line in select * from jsonb_array_elements(p_lines) loop
  c:=nullif(line->>'package_cost','')::numeric;q:=(line->>'quantity')::numeric;
  if c is null or c<0 or c::text in ('NaN','Infinity','-Infinity') or q is null or q<=0 or q::text in ('NaN','Infinity','-Infinity') then raise exception 'راجع كمية وسعر الاستلام';end if;
  if nullif(line->>'expiry_date','')::date<current_date then raise exception 'التوريد منتهي الصلاحية';end if;
 end loop;
 select s.id into sup from public.inventory_suppliers s join public.inventory_requests x on trim(x.supplier_name)=s.name where x.id=p_order and s.active;
 if sup is null then raise exception 'راجع مورد أمر الشراء';end if;
 insert into clinic_finance.supplier_receipts(supplier_id,order_id,reference,payload,created_by,token)
 values(sup,p_order,trim(p_reference),payload,me,p_token) returning id into v;
 perform public.inventory_receive_request(p_order,p_lines,'فاتورة مورد '||trim(p_reference));
 insert into clinic_finance.audit(actor,action,entity_id) values(me,'supplier_receipt',v);
 return v;
end $$;

-- Respect a requested batch at fulfillment; actual inventory valuation wins.
do $$declare def text;patched text;fn regprocedure;begin
 fn:=coalesce(to_regprocedure('public.inventory_fulfill_issue_legacy_supply(uuid,jsonb,text)'),to_regprocedure('public.inventory_fulfill_issue(uuid,jsonb,text)'));
 def:=pg_get_functiondef(fn);
 patched:=replace(def,$s$coalesce(p_note,''));$s$,$s$coalesce(p_note,''),'','',ln.lot_id);$s$);
 if patched=def and position('ln.lot_id' in def)=0 then raise exception 'Missing issue allocation hook';end if;
 execute patched;
end $$;

insert into clinic_finance.accounts values
 ('5123','استهلاك المستلزمات داخل المركز','expense'),
 ('5226','فروق عجز المخزون قيد المراجعة','expense'),
 ('4117','فروق زيادة المخزون','income') on conflict do nothing;
create or replace function clinic_finance.post_inventory_usage() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare a numeric;
begin
 if new.movement_type='issue' and coalesce(new.reference_type,'')<>'supplier_return' then
  a:=round(-new.quantity_delta*new.unit_cost,2);
  if a>0 then perform clinic_finance.post('inventory_usage',new.id,'استهلاك مستلزمات — '||coalesce(new.note,''),null,'5123','1131',a);end if;
 elsif new.movement_type='count_adjustment' then
  a:=round(abs(new.quantity_delta*new.unit_cost),2);
  if a>0 then perform clinic_finance.post('inventory_count',new.id,'تسوية جرد معتمدة — '||coalesce(new.note,''),null,
   case when new.quantity_delta>0 then '1131' else '5226' end,
   case when new.quantity_delta>0 then '4117' else '1131' end,a);end if;
 end if;
 return new;
end $$;
drop trigger if exists clinic_finance_inventory_usage on public.inventory_movements;
create trigger clinic_finance_inventory_usage after insert on public.inventory_movements for each row execute function clinic_finance.post_inventory_usage();

-- A sale must use the performed-service bill, with stock/cost/revenue posted atomically.
create or replace function public.inventory_consume_at(p_location uuid,p_item uuid,p_quantity numeric,p_kind text,p_note text default '',p_invoice text default '',p_payment text default '',p_lot uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform clinic_finance.lock_day();
 if p_kind='sale' then raise exception 'سجل بيع المستلزمات من فاتورة خدمة ومستلزمات في الحسابات لضمان ترحيل البيع والتكلفة والتحصيل';end if;
 return clinic_finance.stock_consume_base(p_location,p_item,p_quantity,p_kind,p_note,p_invoice,p_payment,p_lot);
end $$;

alter table clinic_finance.invoices add column if not exists visit_ref text;
alter table clinic_finance.payments add column if not exists patient_file_ref text;
alter table clinic_finance.payments add column if not exists visit_ref text;
create or replace function public.clinic_finance_collect_linked(p_invoice uuid,p_shift uuid,p_method text,p_amount numeric,p_reference text,p_token uuid,p_patient_file text,p_visit text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');i clinic_finance.invoices%rowtype;p clinic_finance.payments%rowtype;v uuid;
 file_ref text:=trim(coalesce(p_patient_file,''));visit text:=trim(coalesce(p_visit,''));
begin
 perform clinic_finance.lock_day();
 if length(file_ref) not between 1 and 120 or length(visit) not between 1 and 120 then raise exception 'أدخل رقم ملف المريض ورقم الزيارة';end if;
 select * into i from clinic_finance.invoices where id=p_invoice for update;
 if not found or (i.created_by<>me and not clinic_finance.allowed('review')) then raise exception 'الفاتورة خارج نطاقك';end if;
 if nullif(trim(i.patient_ref),'') is not null and trim(i.patient_ref)<>file_ref then raise exception 'رقم الملف لا يطابق الفاتورة المختارة';end if;
 if i.visit_ref is not null and i.visit_ref<>visit then raise exception 'رقم الزيارة لا يطابق الفاتورة المختارة';end if;
 select * into p from clinic_finance.payments where created_by=me and token=p_token;
 if found and (p.patient_file_ref is distinct from file_ref or p.visit_ref is distinct from visit) then raise exception 'مفتاح طلب مختلف لبيانات المريض';end if;
 v:=public.clinic_finance_collect(p_invoice,p_shift,p_method,p_amount,p_reference,p_token);
 update clinic_finance.invoices set patient_ref=file_ref,visit_ref=visit where id=p_invoice;
 update clinic_finance.payments set patient_file_ref=file_ref,visit_ref=visit where id=v;
 if not found then raise exception 'لم يحفظ سند التحصيل';end if;
 return v;
end $$;
revoke all on function clinic_finance.post_inventory_usage() from public,anon,authenticated;
revoke all on function public.inventory_receive_document(uuid,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.clinic_finance_collect_linked(uuid,uuid,text,numeric,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.inventory_receive_document(uuid,jsonb,text,uuid),public.clinic_finance_collect_linked(uuid,uuid,text,numeric,text,uuid,text,text) to authenticated;
commit;
