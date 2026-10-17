begin;
insert into clinic_finance.accounts values('2111','مستحقات الموردين','liability'),('5122','فروق تكلفة مرتجعات الموردين','expense') on conflict do nothing;
alter table clinic_finance.doctor_allocations add column if not exists returned_deduction numeric(14,2) not null default 0;
create table if not exists clinic_finance.supplier_events(id uuid primary key default gen_random_uuid(),supplier_id uuid not null references public.inventory_suppliers(id),movement_id uuid unique references public.inventory_movements(id),amount numeric(14,2) not null,description text not null,created_at timestamptz not null default now());
create table if not exists clinic_finance.supplier_receipts(id uuid primary key default gen_random_uuid(),supplier_id uuid not null references public.inventory_suppliers(id),order_id uuid not null references public.inventory_requests(id),reference text not null,payload jsonb not null,created_by uuid not null references public.admins(id),token uuid not null,created_at timestamptz not null default now(),unique(supplier_id,reference),unique(created_by,token));
create table if not exists clinic_finance.supplier_actions(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('supplier_payment','supplier_refund','supplier_return','patient_return')),supplier_id uuid references public.inventory_suppliers(id),movement_id uuid references public.inventory_movements(id),refund_id uuid references clinic_finance.requests(id),quantity numeric(14,3),amount numeric(14,2) not null default 0,cost numeric(14,2) not null default 0,method text check(method in ('bank','cash')),shift_id uuid references clinic_finance.shifts(id),reference text not null,note text not null,payload jsonb not null,created_by uuid not null references public.admins(id),token uuid not null,created_at timestamptz not null default now(),status text not null default 'pending' check(status in ('pending','approved','rejected')),reviewed_by uuid references public.admins(id),reviewed_at timestamptz,review_note text,unique(created_by,token));
create unique index if not exists supplier_payment_ref on clinic_finance.supplier_actions(kind,method,reference) where status='approved' and kind in ('supplier_payment','supplier_refund');
create index if not exists supplier_event_balance on clinic_finance.supplier_events(supplier_id);
create index if not exists supplier_action_balance on clinic_finance.supplier_actions(supplier_id,status);
do $$declare t text;begin foreach t in array array['supplier_events','supplier_receipts','supplier_actions'] loop execute format('alter table clinic_finance.%I enable row level security',t);execute format('revoke all on clinic_finance.%I from public,anon,authenticated',t);end loop;end $$;
create or replace function clinic_finance.supplier_balance(p_id uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select coalesce((select sum(amount) from clinic_finance.supplier_events where supplier_id=p_id),0)+coalesce((select sum(case when kind='supplier_refund' then amount else -amount end) from clinic_finance.supplier_actions where supplier_id=p_id and status='approved' and kind in ('supplier_payment','supplier_refund')),0);$$;
create or replace function clinic_finance.post_purchase() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare sup uuid;v numeric;
begin if new.movement_type='receipt' and new.reference_type='purchase' then
 select s.id into sup from public.inventory_suppliers s join public.inventory_requests r on trim(r.supplier_name)=s.name where r.id=new.reference_id and s.active;
 if sup is null then raise exception 'سجل المورد باسم مطابق لأمر الشراء قبل الاستلام';end if;
 v:=round(new.quantity_delta*new.unit_cost,2);if v>0 then insert into clinic_finance.supplier_events(supplier_id,movement_id,amount,description) values(sup,new.id,v,'توريد أمر شراء');perform clinic_finance.post('inventory_purchase',new.id,'توريد مستلزمات بالأجل',null,'1131','2111',v);end if;end if;return new;end $$;
drop trigger if exists clinic_finance_inventory_purchase on public.inventory_movements;
create trigger clinic_finance_inventory_purchase after insert on public.inventory_movements for each row execute function clinic_finance.post_purchase();
do $$begin
 if to_regprocedure('clinic_finance.supplier_receive_base(uuid,jsonb,text)') is null then alter function public.inventory_receive_request(uuid,jsonb,text) set schema clinic_finance;alter function clinic_finance.inventory_receive_request(uuid,jsonb,text) rename to supplier_receive_base;end if;
 if to_regprocedure('clinic_finance.supplier_review_base(uuid,boolean,text)') is null then alter function public.inventory_review_request(uuid,boolean,text) set schema clinic_finance;alter function clinic_finance.inventory_review_request(uuid,boolean,text) rename to supplier_review_base;end if;
 if to_regprocedure('clinic_finance.supplier_snapshot_base(date,date,integer)') is null then alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance;alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to supplier_snapshot_base;end if;
end $$;
create or replace function public.inventory_receive_request(p_id uuid,p_lines jsonb,p_note text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$begin perform clinic_finance.lock_day();perform clinic_finance.supplier_receive_base(p_id,p_lines,p_note);end $$;
create or replace function public.inventory_review_request(p_id uuid,p_approve boolean,p_note text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$begin perform clinic_finance.lock_day();if p_approve and exists(select 1 from public.inventory_requests where id=p_id and request_type='purchase' and requester_id=public.my_admin_id()) then raise exception 'أمر الشراء يحتاج اعتماد شخص آخر';end if;perform clinic_finance.supplier_review_base(p_id,p_approve,p_note);end $$;
create or replace function public.clinic_finance_supplier_receive(p_order uuid,p_lines jsonb,p_reference text,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');r clinic_finance.supplier_receipts%rowtype;sup uuid;v uuid;payload jsonb:=jsonb_build_object('order',p_order,'lines',p_lines,'reference',trim(p_reference));
begin perform clinic_finance.lock_day();select * into r from clinic_finance.supplier_receipts where created_by=me and token=p_token;if found then if r.payload is distinct from payload then raise exception 'مفتاح طلب مختلف';end if;return r.id;end if;
 select s.id into sup from public.inventory_suppliers s join public.inventory_requests x on trim(x.supplier_name)=s.name where x.id=p_order and s.active;
 if sup is null or length(trim(coalesce(p_reference,'')))<2 then raise exception 'راجع المورد ومرجع الفاتورة';end if;
 insert into clinic_finance.supplier_receipts(supplier_id,order_id,reference,payload,created_by,token) values(sup,p_order,trim(p_reference),payload,me,p_token) returning id into v;
 perform public.inventory_receive_request(p_order,p_lines,'فاتورة مورد '||p_reference);insert into clinic_finance.audit(actor,action,entity_id) values(me,'supplier_receipt',v);return v;end $$;
create or replace function public.clinic_finance_supplier_command(p_action text,p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;v uuid;r clinic_finance.supplier_actions%rowtype;m public.inventory_movements%rowtype;sup uuid;k text:=p_payload->>'kind';qty numeric;amount numeric;v_cost numeric;credit numeric;approval boolean;refund clinic_finance.requests%rowtype;
begin perform clinic_finance.lock_day();
 if p_action='request' then me:=clinic_finance.require_access('create');select * into r from clinic_finance.supplier_actions where created_by=me and token=p_token;if found then if r.payload is distinct from p_payload then raise exception 'مفتاح طلب مختلف';end if;return r.id;end if;
 if k is null or k not in ('supplier_payment','supplier_refund','supplier_return','patient_return') or length(trim(coalesce(p_payload->>'reference','')))<2 or length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'راجع نوع الطلب ومرجعه وسببه';end if;
 if k in ('supplier_payment','supplier_refund') then
  sup:=(p_payload->>'supplier_id')::uuid;amount:=(p_payload->>'amount')::numeric;
  if amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') or amount<>round(amount,2) or not exists(select 1 from public.inventory_suppliers where id=sup and active) then raise exception 'المورد أو المبلغ غير صالح';end if;
  if p_payload->>'method'='cash' then perform clinic_finance.check_shift((p_payload->>'shift_id')::uuid);end if;
 else
  select * into m from public.inventory_movements where id=(p_payload->>'movement_id')::uuid;qty:=(p_payload->>'quantity')::numeric;
  if not found or qty is null or qty<=0 or qty::text in ('NaN','Infinity','-Infinity') or qty<>round(qty,3) or not public.inventory_location_can(m.location_id,'manage') then raise exception 'راجع الحركة والكمية وصلاحية إدارة المخزن';end if;
  if k='supplier_return' then
   select supplier_id into sup from clinic_finance.supplier_events where movement_id=m.id;if sup is null or m.movement_type<>'receipt' then raise exception 'اختر توريدا مربوطا بمورد';end if;
  else
   select * into refund from clinic_finance.requests where id=(p_payload->>'refund_id')::uuid and kind='refund' and status='approved';
   if not found or m.movement_type<>'sale' or m.reference_type<>'clinic_invoice' or refund.invoice_id<>m.reference_id or not exists(select 1 from clinic_finance.invoices where id=m.reference_id and (created_by=me or clinic_finance.allowed('review'))) then raise exception 'المرتجع يحتاج صرف فاتورة واستردادا ماليا معتمدا لنفس الفاتورة';end if;
   if qty*m.unit_sale_price+coalesce((select sum(quantity*x.unit_sale_price) from clinic_finance.supplier_actions a join public.inventory_movements x on x.id=a.movement_id where a.refund_id=refund.id and a.status in ('pending','approved')),0)>refund.amount then raise exception 'الكمية تتجاوز مبلغ الاسترداد المعتمد';end if;
  end if;
  if qty+coalesce((select sum(quantity) from clinic_finance.supplier_actions where movement_id=m.id and status in ('pending','approved')),0)>abs(m.quantity_delta) then raise exception 'المرتجع يتجاوز الكمية الأصلية';end if;amount:=0;
 end if;
 insert into clinic_finance.supplier_actions(kind,supplier_id,movement_id,refund_id,quantity,amount,method,shift_id,reference,note,payload,created_by,token) values(k,sup,case when k in ('supplier_return','patient_return') then m.id end,case when k='patient_return' then refund.id end,qty,amount,case when k in ('supplier_payment','supplier_refund') then p_payload->>'method' end,case when p_payload->>'method'='cash' and k in ('supplier_payment','supplier_refund') then (p_payload->>'shift_id')::uuid end,trim(p_payload->>'reference'),p_payload->>'note',p_payload,me,p_token) returning id into v;
 elsif p_action='review' then me:=clinic_finance.require_access('review');select * into r from clinic_finance.supplier_actions where id=(p_payload->>'id')::uuid for update;approval:=(p_payload->>'approve')::boolean;
 if not found or r.created_by=me or r.status<>'pending' or approval is null or length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'الطلب غير متاح أو لا يمكنك اعتماد طلبك';end if;
 if approval then
  if r.kind='supplier_payment' then if r.amount>clinic_finance.supplier_balance(r.supplier_id) then raise exception 'السداد يتجاوز رصيد المورد';end if;perform clinic_finance.post('supplier_payment',r.id,'سداد مورد — '||r.reference,r.shift_id,'2111',case when r.method='cash' then '1111' else '1112' end,r.amount);
  elsif r.kind='supplier_refund' then if r.amount> -clinic_finance.supplier_balance(r.supplier_id) then raise exception 'المبلغ يتجاوز المسترد من المورد';end if;perform clinic_finance.post('supplier_refund',r.id,'رد مورد — '||r.reference,r.shift_id,case when r.method='cash' then '1111' else '1112' end,'2111',r.amount);
  else
   select * into m from public.inventory_movements where id=r.movement_id;perform 1 from public.inventory_items where id=m.item_id for update;
   if not public.inventory_location_can(m.location_id,'manage') then raise exception 'المراجعة تحتاج صلاحية إدارة المخزن';end if;
   if r.kind='supplier_return' then
    if public.inventory_location_balance(m.location_id,m.item_id,m.lot_id,false)<r.quantity then raise exception 'رصيد التشغيلة لا يكفي للمرتجع';end if;
    v_cost:=round(public.inventory_location_cost(m.location_id,m.item_id,m.lot_id,false),2);credit:=round(r.quantity*m.unit_cost,2);
    insert into public.inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by) values(m.item_id,m.location_id,m.lot_id,'issue',-r.quantity,v_cost,'supplier_return',r.id,r.note,me);
    insert into clinic_finance.supplier_events(supplier_id,amount,description) values(r.supplier_id,-credit,'مرتجع للمورد — '||r.reference);
    if credit>0 then perform clinic_finance.post('supplier_return_credit',r.id,r.note,null,'2111','1131',credit);end if;
    amount:=round(r.quantity*v_cost,2)-credit;if amount<>0 then perform clinic_finance.post('supplier_return_variance',r.id,r.note,null,case when amount>0 then '5122' else '1131' end,case when amount>0 then '1131' else '5122' end,abs(amount));end if;
   else
    if exists(select 1 from public.inventory_lots where id=m.lot_id and expiry_date<current_date) or coalesce((r.payload->>'sealed')::boolean,false) is not true then raise exception 'لا يعود للمخزون إلا صنف صالح غير مفتوح بعد الفحص';end if;
    v_cost:=round(r.quantity*m.unit_cost,2);insert into public.inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by) values(m.item_id,m.location_id,m.lot_id,'return',r.quantity,m.unit_cost,'patient_return',r.id,r.note,me);
    if v_cost>0 then perform clinic_finance.post('patient_stock_return',r.id,r.note,null,'1131','5121',v_cost);end if;
   end if;
  end if;
 end if;
 update clinic_finance.supplier_actions set status=case when approval then 'approved' else 'rejected' end,reviewed_by=me,reviewed_at=now(),review_note=p_payload->>'note',cost=case when kind='patient_return' then coalesce(v_cost,0) when kind='supplier_return' then coalesce(round(quantity*v_cost,2),0) else 0 end where id=r.id;v:=r.id;
 if approval and r.kind='patient_return' then
  update clinic_finance.doctor_allocations a set returned_deduction=coalesce((select sum(case a.terms->>'deduction' when 'cost' then x.cost when 'sale' then x.quantity*sm.unit_sale_price else 0 end) from clinic_finance.supplier_actions x join public.inventory_movements sm on sm.id=x.movement_id where x.kind='patient_return' and x.status='approved' and sm.reference_id=a.invoice_id),0) where a.invoice_id=m.reference_id;
  perform clinic_finance.doctor_sync(m.reference_id);
 end if;
 else raise exception 'إجراء غير معروف';end if;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'supplier_'||p_action,v,jsonb_build_object('note',p_payload->>'note'));return v;
end $$;
-- Verified stock returns may release the original material deduction, without changing frozen contract terms.
do $$declare d text;begin d:=pg_get_functiondef('clinic_finance.doctor_sync(uuid)'::regprocedure);if position('revenue/i.amount-a.original_deduction)' in d)>0 then execute replace(d,'revenue/i.amount-a.original_deduction)','revenue/i.amount-greatest(0,a.original_deduction-a.returned_deduction))');end if;end $$;
create or replace function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb:=clinic_finance.supplier_snapshot_base(p_from,p_to,p_offset);me uuid:=public.my_admin_id();reviewer boolean:=clinic_finance.allowed('review');
begin return v||jsonb_build_object('suppliers',case when reviewer then(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('balance',clinic_finance.supplier_balance(s.id)) order by s.name),'[]') from public.inventory_suppliers s where s.active) else (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.inventory_suppliers where active) end,
 'can_receive',public.inventory_location_can('00000000-0000-4000-8000-000000000001','manage'),
 'purchase_orders',(select coalesce(jsonb_agg(x),'[]') from(select to_jsonb(r)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(l)||jsonb_build_object('name',i.name,'track_lots',i.track_lots)) from public.inventory_request_lines l join public.inventory_items i on i.id=l.item_id where l.request_id=r.id)) x from public.inventory_requests r where r.request_type='purchase' and r.status in ('approved','partial') and (reviewer or r.requester_id=me) order by r.requested_at desc limit 200)t),
 'supplier_actions',(select coalesce(jsonb_agg(x),'[]') from(select to_jsonb(a) x from clinic_finance.supplier_actions a where (reviewer or a.created_by=me) order by a.created_at desc,a.id desc limit 200 offset p_offset)t),
 'stock_receipts',(select coalesce(jsonb_agg(x),'[]') from(select jsonb_build_object('id',m.id,'item_name',i.name,'quantity',m.quantity_delta,'unit_cost',m.unit_cost,'supplier_id',e.supplier_id,'created_at',m.created_at) x from public.inventory_movements m join clinic_finance.supplier_events e on e.movement_id=m.id join public.inventory_items i on i.id=m.item_id where public.inventory_location_can(m.location_id,'manage') order by m.created_at desc,m.id desc limit 200 offset p_offset)t),
 'stock_sales',(select coalesce(jsonb_agg(x),'[]') from(select jsonb_build_object('id',m.id,'item_name',it.name,'invoice_id',i.id,'invoice_reference',i.reference,'quantity',-m.quantity_delta,'sale_price',m.unit_sale_price) x from public.inventory_movements m join clinic_finance.invoices i on i.id=m.reference_id join public.inventory_items it on it.id=m.item_id where m.reference_type='clinic_invoice' and m.movement_type='sale' and (reviewer or i.created_by=me) and public.inventory_location_can(m.location_id,'manage') order by m.created_at desc,m.id desc limit 200 offset p_offset)t));end $$;
revoke all on all functions in schema clinic_finance from public,anon,authenticated;
do $$declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'clinic_finance_%' or p.proname in ('inventory_receive_request','inventory_review_request')) loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to authenticated',f.sig);end loop;end $$;
commit;
