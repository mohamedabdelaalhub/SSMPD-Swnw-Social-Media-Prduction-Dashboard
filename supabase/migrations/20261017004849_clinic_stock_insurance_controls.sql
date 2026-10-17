begin;
insert into clinic_finance.accounts values ('1131','مخزون المستلزمات والأدوية','asset'),('5121','تكلفة المستلزمات والأدوية المباعة','expense'),('5217','هالك وتالف طبي','expense'),('4116','مبيعات المستلزمات والأدوية','income'),('1121','مطالبات شركات التأمين','asset'),('1292','مخصص خسائر ائتمان التأمين','asset'),('4153','تخفيضات تعاقدية للتأمين','income'),('5230','خسائر ائتمان التأمين','expense') on conflict do nothing;
alter table clinic_finance.entries add column if not exists event_no bigint generated always as identity;
create unique index if not exists fin_event_no on clinic_finance.entries(event_no);
alter table clinic_finance.shifts add column if not exists close_event_no bigint;
update clinic_finance.shifts s set close_event_no=coalesce((select max(e.event_no) from clinic_finance.entries e where e.created_at<=s.closed_at),0) where s.closed_at is not null and close_event_no is null;
alter table clinic_finance.invoices add column if not exists bill_payload jsonb;
create table if not exists clinic_finance.bill_items(id uuid primary key default gen_random_uuid(),invoice_id uuid not null references clinic_finance.invoices(id),item_id uuid not null references public.inventory_items(id),location_id uuid not null references public.inventory_locations(id),name text not null,unit text not null,quantity numeric(14,3) not null check(quantity>0),sale_price numeric(14,2) not null check(sale_price>0),cost_total numeric(14,2) not null check(cost_total>=0),unique(invoice_id,item_id,location_id));
create table if not exists clinic_finance.cash_cases(id uuid primary key default gen_random_uuid(),shift_id uuid not null unique references clinic_finance.shifts(id),difference numeric(14,2) not null check(difference<>0),status text not null default 'recorded' check(status in ('recorded','reviewed','responsibility','decided')),review_note text,responsibility text,responsible_id uuid references public.admins(id),responsibility_note text,decision text,decision_note text,updated_by uuid references public.admins(id),updated_at timestamptz not null default now());
create table if not exists clinic_finance.insurance_claims(id uuid primary key default gen_random_uuid(),invoice_id uuid not null references clinic_finance.invoices(id),reference text not null unique,insurer text not null,amount numeric(14,2) not null check(amount>0),created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),token uuid not null,unique(created_by,token));
create table if not exists clinic_finance.insurance_actions(id uuid primary key default gen_random_uuid(),claim_id uuid not null references clinic_finance.insurance_claims(id),kind text not null check(kind in ('correction','resubmit','contractual','credit_loss','payment')),amount numeric(14,2) not null check(amount>=0),reference text not null,reason text not null,created_by uuid not null references public.admins(id),token uuid not null,created_at timestamptz not null default now(),status text not null default 'pending' check(status in ('pending','approved','rejected')),reviewed_by uuid references public.admins(id),reviewed_at timestamptz,review_note text,released_allowance numeric(14,2) not null default 0,payload jsonb not null,unique(created_by,token));
create unique index if not exists insurance_payment_ref on clinic_finance.insurance_actions(reference) where kind='payment' and status='approved';
do $$ declare t text;begin foreach t in array array['bill_items','cash_cases','insurance_claims','insurance_actions'] loop execute format('alter table clinic_finance.%I enable row level security',t);execute format('revoke all on clinic_finance.%I from public,anon,authenticated',t);end loop;end $$;
create or replace function clinic_finance.cash_limit(p_shift uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$
 with reg as(select register_id from clinic_finance.shifts where id=p_shift),last_count as(select s.counted,s.close_event_no from clinic_finance.shifts s where s.register_id=(select register_id from reg) and s.closed_at is not null order by s.closed_at desc,s.id desc limit 1),book as(select coalesce(sum(l.debit-l.credit),0) v from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id join clinic_finance.shifts s on s.id=e.shift_id where s.register_id=(select register_id from reg) and l.account='1111'),physical as(select c.counted+coalesce((select sum(l.debit-l.credit) from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id join clinic_finance.shifts s on s.id=e.shift_id where s.register_id=(select register_id from reg) and l.account='1111' and e.event_no>c.close_event_no),0) v from last_count c)
 select greatest(0,least(book.v,coalesce(physical.v,book.v))) from book left join physical on true;
$$;
create or replace function clinic_finance.post(p_source text,p_source_id uuid,p_description text,p_shift uuid,p_debit text,p_credit text,p_amount numeric) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
 perform clinic_finance.lock_day();
 if public.my_admin_id() is null or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) then raise exception 'المبلغ أو المستخدم غير صالح';end if;
 if p_debit='1111' or p_credit='1111' then perform clinic_finance.check_shift(p_shift,false);end if;
 if p_credit='1111' and p_amount>clinic_finance.cash_limit(p_shift) then raise exception 'الكاش المتاح لا يكفي للصرف؛ الخزينة لا تقبل رصيدا سالبا';end if;
 insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values(p_source,p_source_id,p_description,p_shift,public.my_admin_id()) returning id into v_id;
 insert into clinic_finance.lines(entry_id,account,debit,credit) values(v_id,p_debit,p_amount,0),(v_id,p_credit,0,p_amount);return v_id;
end $$;
-- Preserve guarded first-stage implementations privately, never grant direct access.
do $$ begin
 if to_regprocedure('clinic_finance.snapshot_base(date,date,integer)') is null then alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance;alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to snapshot_base;end if;
 if to_regprocedure('clinic_finance.collect_base(uuid,uuid,text,numeric,text,uuid)') is null then alter function public.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid) set schema clinic_finance;alter function clinic_finance.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid) rename to collect_base;end if;
 if to_regprocedure('clinic_finance.request_base(jsonb,uuid)') is null then alter function public.clinic_finance_request(jsonb,uuid) set schema clinic_finance;alter function clinic_finance.clinic_finance_request(jsonb,uuid) rename to request_base;end if;
 if to_regprocedure('clinic_finance.review_request_base(uuid,boolean,text)') is null then alter function public.clinic_finance_review_request(uuid,boolean,text) set schema clinic_finance;alter function clinic_finance.clinic_finance_review_request(uuid,boolean,text) rename to review_request_base;end if;
 if to_regprocedure('clinic_finance.close_shift_base(uuid,jsonb,text)') is null then alter function public.clinic_finance_close_shift(uuid,jsonb,text) set schema clinic_finance;alter function clinic_finance.clinic_finance_close_shift(uuid,jsonb,text) rename to close_shift_base;end if;
 if to_regprocedure('clinic_finance.stock_consume_base(uuid,uuid,numeric,text,text,text,text,uuid)') is null then alter function public.inventory_consume_at(uuid,uuid,numeric,text,text,text,text,uuid) set schema clinic_finance;alter function clinic_finance.inventory_consume_at(uuid,uuid,numeric,text,text,text,text,uuid) rename to stock_consume_base;end if;
end $$;
create or replace function public.inventory_consume_at(p_location uuid,p_item uuid,p_quantity numeric,p_kind text,p_note text default '',p_invoice text default '',p_payment text default '',p_lot uuid default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
begin perform clinic_finance.lock_day();return clinic_finance.stock_consume_base(p_location,p_item,p_quantity,p_kind,p_note,p_invoice,p_payment,p_lot);end $$;
create or replace function clinic_finance.post_waste() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare a numeric;
begin if new.movement_type in ('waste','expired') then
 if new.quantity_delta>=0 or public.my_admin_id() is null then raise exception 'حركة الهالك غير صالحة';end if;
 a:=round(-new.quantity_delta*new.unit_cost,2);if a>0 then perform clinic_finance.post('inventory_waste',new.id,'هالك مستلزمات — '||new.note,null,'5217','1131',a);end if;end if;return new;end $$;
drop trigger if exists clinic_finance_inventory_waste on public.inventory_movements;
create trigger clinic_finance_inventory_waste after insert on public.inventory_movements for each row execute function clinic_finance.post_waste();

create or replace function public.clinic_finance_bill(p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');inv clinic_finance.invoices%rowtype;v_id uuid;v_item_id uuid;v_loc uuid;line jsonb;item public.inventory_items%rowtype;a record;qty numeric;service numeric:=(p_payload->>'service_amount')::numeric;total numeric:=0;cost numeric;line_id uuid;
begin perform clinic_finance.lock_day();
 select * into inv from clinic_finance.invoices where created_by=me and token=p_token;if found then if inv.bill_payload is distinct from p_payload then raise exception 'مفتاح الطلب مستخدم لعملية مختلفة';end if;return inv.id;end if;
 if service is null or service<0 or service::text in ('NaN','Infinity','-Infinity') or service<>round(service,2) or jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items')>50 then raise exception 'راجع قيمة الخدمة وبنود الفاتورة';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'items') x group by x->>'item_id',x->>'location_id' having count(*)>1) then raise exception 'اجمع كميات نفس الصنف والمخزن في بند واحد';end if;
 for line in select value from jsonb_array_elements(p_payload->'items') order by value->>'item_id',value->>'location_id' loop
  v_item_id:=(line->>'item_id')::uuid;v_loc:=(line->>'location_id')::uuid;qty:=(line->>'quantity')::numeric;
  if qty is null or qty<=0 or qty::text in ('NaN','Infinity','-Infinity') or qty<>round(qty,3) or not(public.inventory_location_can(v_loc,'receive') or public.inventory_location_can(v_loc,'manage')) then raise exception 'راجع كمية الصنف وصلاحية الصرف من المخزن';end if;
  select * into item from public.inventory_items where id=v_item_id and active for update;if not found or item.current_sale_price<=0 or (line->>'sale_price')::numeric is distinct from item.current_sale_price then raise exception 'سعر البيع تغير أو الصنف غير متاح؛ حدّث الفاتورة';end if;
  total:=total+round(qty*item.current_sale_price,2);
 end loop;
 if total+service<=0 then raise exception 'أضف خدمة أو صنفا بسعر بيع';end if;
 insert into clinic_finance.invoices(reference,patient_ref,description,amount,created_by,token,bill_payload) values(trim(p_payload->>'reference'),trim(coalesce(p_payload->>'patient_ref','')),trim(p_payload->>'description'),total+service,me,p_token,p_payload) returning id into v_id;
 if service>0 then perform clinic_finance.post('invoice',v_id,'خدمة منفذة '||(p_payload->>'reference'),null,'1122','4110',service);end if;
 for line in select value from jsonb_array_elements(p_payload->'items') order by value->>'item_id',value->>'location_id' loop
  v_item_id:=(line->>'item_id')::uuid;v_loc:=(line->>'location_id')::uuid;qty:=(line->>'quantity')::numeric;select * into item from public.inventory_items where id=v_item_id;cost:=0;
  line_id:=gen_random_uuid();
  for a in select * from public.inventory_allocate_at(v_loc,v_item_id,qty) loop
   insert into public.inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,unit_sale_price,margin_percent,profit_amount,reference_type,reference_id,patient_invoice_ref,note,created_by)
   values(v_item_id,v_loc,a.lot_id,'sale',-a.qty,round(a.unit_cost,2),item.current_sale_price,item.markup_percent,round((item.current_sale_price-round(a.unit_cost,2))*a.qty,2),'clinic_invoice',v_id,p_payload->>'reference','صرف بند فاتورة',me);
   cost:=cost+round(round(a.unit_cost,2)*a.qty,2);
  end loop;
  insert into clinic_finance.bill_items(id,invoice_id,item_id,location_id,name,unit,quantity,sale_price,cost_total) values(line_id,v_id,v_item_id,v_loc,item.name,item.base_unit,qty,item.current_sale_price,cost);
  perform clinic_finance.post('stock_revenue',line_id,'بيع مستلزمات '||item.name,null,'1122','4116',round(qty*item.current_sale_price,2));
  if cost>0 then perform clinic_finance.post('stock_cost',line_id,'تكلفة مستلزمات '||item.name,null,'5121','1131',cost);end if;
 end loop;
 insert into clinic_finance.audit(actor,action,entity_id) values(me,'bill_dispensed',v_id);return v_id;end $$;

create or replace function public.clinic_finance_close_shift(p_shift uuid,p_counts jsonb,p_note text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;diff numeric;
begin v_id:=clinic_finance.close_shift_base(p_shift,p_counts,p_note);
 update clinic_finance.shifts set close_event_no=coalesce((select max(event_no) from clinic_finance.entries),0) where id=v_id and close_event_no is null;
 select counted-clinic_finance.shift_cash(id) into diff from clinic_finance.shifts where id=v_id;
 if diff<>0 then insert into clinic_finance.cash_cases(shift_id,difference) values(v_id,diff) on conflict(shift_id) do nothing;end if;return v_id;end $$;
create or replace function public.clinic_finance_case_step(p_id uuid,p_step text,p_note text,p_responsibility text default null,p_person uuid default null,p_decision text default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('review');c clinic_finance.cash_cases%rowtype;
begin perform clinic_finance.lock_day();select * into c from clinic_finance.cash_cases where id=p_id for update;if not found or length(trim(coalesce(p_note,'')))<3 then raise exception 'أدخل ملف الفرق ونتيجة الإجراء';end if;
 if exists(select 1 from clinic_finance.shifts where id=c.shift_id and cashier_id=me) then raise exception 'لا يمكن التحقيق في فرق ورديتك بنفسك';end if;
 if p_step='review' and c.status='recorded' then update clinic_finance.cash_cases set status='reviewed',review_note=p_note where id=c.id;
 elsif p_step='responsibility' and c.status='reviewed' then
  if p_responsibility is null or p_responsibility not in ('unresolved','process_error','employee','no_employee_fault') or (p_responsibility='employee' and not exists(select 1 from public.admins where id=p_person and active)) then raise exception 'حدد نتيجة المسؤولية والشخص عند نسبتها لموظف';end if;
  update clinic_finance.cash_cases set status='responsibility',responsibility=p_responsibility,responsible_id=case when p_responsibility='employee' then p_person end,responsibility_note=p_note where id=c.id;
 elsif p_step='decision' and c.status='responsibility' then
  if p_decision is null or p_decision not in ('correct_records','further_investigation','refer_management','no_employee_charge') then raise exception 'اختر القرار الإداري';end if;
  update clinic_finance.cash_cases set status='decided',decision=p_decision,decision_note=p_note where id=c.id;
 else raise exception 'الخطوة لا تطابق حالة الملف';end if;
 update clinic_finance.cash_cases set updated_by=me,updated_at=now() where id=c.id;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'cash_case_'||p_step,c.id,jsonb_build_object('note',p_note,'responsibility',p_responsibility,'person',p_person,'decision',p_decision));return c.id;end $$;
create or replace function clinic_finance.claim_due(p_id uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$
 select c.amount-coalesce((select sum(amount) from clinic_finance.insurance_actions where claim_id=c.id and status='approved' and kind in ('contractual','payment')),0) from clinic_finance.insurance_claims c where c.id=p_id;
$$;
create or replace function clinic_finance.claim_allowance(p_id uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(sum(case when kind='credit_loss' then amount else -released_allowance end),0) from clinic_finance.insurance_actions where claim_id=p_id and status='approved';
$$;
create or replace function public.clinic_finance_insurance_claim(p_invoice uuid,p_reference text,p_insurer text,p_amount numeric,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');i clinic_finance.invoices%rowtype;c clinic_finance.insurance_claims%rowtype;used numeric;v_id uuid;
begin perform clinic_finance.lock_day();select * into c from clinic_finance.insurance_claims where created_by=me and token=p_token;if found then if c.invoice_id is distinct from p_invoice or c.reference is distinct from trim(p_reference) or c.insurer is distinct from trim(p_insurer) or c.amount is distinct from p_amount then raise exception 'مفتاح الطلب مستخدم لعملية مختلفة';end if;return c.id;end if;
 select * into i from clinic_finance.invoices where id=p_invoice for update;if not found or i.voided or (i.created_by<>me and not clinic_finance.allowed('review')) then raise exception 'الفاتورة غير متاحة';end if;
 select coalesce((select sum(amount) from clinic_finance.payments where invoice_id=i.id),0)+coalesce((select sum(amount) from clinic_finance.insurance_claims where invoice_id=i.id),0) into used;
 if p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) or used+p_amount>i.amount or length(trim(coalesce(p_reference,'')))<2 or length(trim(coalesce(p_insurer,'')))<2 then raise exception 'راجع مبلغ ومرجع المطالبة وجهة التأمين';end if;
 insert into clinic_finance.insurance_claims(invoice_id,reference,insurer,amount,created_by,token) values(i.id,trim(p_reference),trim(p_insurer),p_amount,me,p_token) returning id into v_id;
 perform clinic_finance.post('insurance_claim',v_id,'نقل مديونية مطالبة '||p_reference,null,'1121','1122',p_amount);insert into clinic_finance.audit(actor,action,entity_id) values(me,'insurance_claim',v_id);return v_id;end $$;
create or replace function public.clinic_finance_insurance_action(p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');c clinic_finance.insurance_claims%rowtype;r clinic_finance.insurance_actions%rowtype;k text:=p_payload->>'kind';a numeric:=coalesce((p_payload->>'amount')::numeric,0);v_id uuid;
begin perform clinic_finance.lock_day();select * into r from clinic_finance.insurance_actions where created_by=me and token=p_token;if found then if r.payload is distinct from p_payload then raise exception 'مفتاح الطلب مستخدم لعملية مختلفة';end if;return r.id;end if;
 select * into c from clinic_finance.insurance_claims where id=(p_payload->>'claim_id')::uuid for update;if not found or (c.created_by<>me and not clinic_finance.allowed('review')) then raise exception 'المطالبة خارج نطاقك';end if;
 if k is null or k not in ('correction','resubmit','contractual','credit_loss','payment') or length(trim(coalesce(p_payload->>'reason','')))<3 or length(trim(coalesce(p_payload->>'reference','')))<2 then raise exception 'راجع تصنيف المعالجة والسبب والمرجع';end if;
 if a<0 or a::text in ('NaN','Infinity','-Infinity') or a<>round(a,2) or (k in ('correction','resubmit') and a<>0) or (k not in ('correction','resubmit') and (a<=0 or a>clinic_finance.claim_due(c.id))) then raise exception 'مبلغ المعالجة يتجاوز المديونية أو غير صالح';end if;
 insert into clinic_finance.insurance_actions(claim_id,kind,amount,reference,reason,created_by,token,payload) values(c.id,k,a,trim(p_payload->>'reference'),trim(p_payload->>'reason'),me,p_token,p_payload) returning id into v_id;
 insert into clinic_finance.audit(actor,action,entity_id) values(me,'insurance_action_requested',v_id);return v_id;end $$;
create or replace function public.clinic_finance_insurance_review(p_id uuid,p_approve boolean,p_note text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('review');r clinic_finance.insurance_actions%rowtype;due numeric;allowance numeric;released numeric:=0;
begin perform clinic_finance.lock_day();select * into r from clinic_finance.insurance_actions where id=p_id for update;if not found or r.created_by=me then raise exception 'الطلب غير متاح أو لا يمكنك اعتماد طلبك';end if;
 if p_approve is null or length(trim(coalesce(p_note,'')))<3 then raise exception 'سجل سبب القرار';end if;
 if r.status<>'pending' then if r.reviewed_by=me and r.status=(case when p_approve then 'approved' else 'rejected' end) then return r.id;end if;raise exception 'سبق اتخاذ قرار في الطلب';end if;
 if p_approve then due:=clinic_finance.claim_due(r.claim_id);allowance:=clinic_finance.claim_allowance(r.claim_id);
  if r.kind not in ('correction','resubmit') and r.amount>due then raise exception 'المبلغ يتجاوز الرصيد الحالي للمطالبة';end if;
  if r.kind='contractual' then perform clinic_finance.post('insurance_contractual',r.id,r.reason,null,'4153','1121',r.amount);released:=greatest(0,allowance-(due-r.amount));
  elsif r.kind='credit_loss' then if r.amount>due-allowance then raise exception 'المبلغ يتجاوز المديونية غير المخصص لها';end if;perform clinic_finance.post('insurance_credit_loss',r.id,r.reason,null,'5230','1292',r.amount);
  elsif r.kind='payment' then perform clinic_finance.post('insurance_payment',r.id,r.reason,null,'1112','1121',r.amount);released:=least(allowance,r.amount);
  end if;
  if released>0 then perform clinic_finance.post('insurance_allowance_release',r.id,'رد مخصص بعد التحصيل أو التخفيض',null,'1292','5230',released);end if;
 end if;
 update clinic_finance.insurance_actions set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=me,reviewed_at=now(),review_note=p_note,released_allowance=released where id=r.id;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'insurance_action_reviewed',r.id,jsonb_build_object('note',p_note,'approved',p_approve));return r.id;end $$;
create or replace function public.clinic_finance_collect(p_invoice uuid,p_shift uuid,p_method text,p_amount numeric,p_reference text,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');available numeric;
begin perform clinic_finance.lock_day();
 if not exists(select 1 from clinic_finance.payments where created_by=me and token=p_token) then
 select i.amount-coalesce((select sum(amount) from clinic_finance.payments where invoice_id=i.id),0)-coalesce((select sum(amount) from clinic_finance.insurance_claims where invoice_id=i.id),0) into available from clinic_finance.invoices i where id=p_invoice;
 if p_amount>available then raise exception 'التحصيل يتجاوز حصة المريض؛ حصة التأمين تحصل من المطالبة';end if;end if;
 return clinic_finance.collect_base(p_invoice,p_shift,p_method,p_amount,p_reference,p_token);end $$;
create or replace function public.clinic_finance_request(p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
begin perform clinic_finance.require_access('create');perform clinic_finance.lock_day();
 if p_payload->>'kind'='void' and (exists(select 1 from clinic_finance.bill_items where invoice_id=nullif(p_payload->>'invoice_id','')::uuid) or exists(select 1 from clinic_finance.insurance_claims where invoice_id=nullif(p_payload->>'invoice_id','')::uuid)) then raise exception 'الفاتورة بها صرف مخزون أو مطالبة تأمين؛ تحتاج معالجة مستقلة دون إلغاء الصرف تلقائيا';end if;
 return clinic_finance.request_base(p_payload,p_token);end $$;

create or replace function public.clinic_finance_review_request(p_id uuid,p_approve boolean,p_note text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare r clinic_finance.requests%rowtype;
begin perform clinic_finance.require_access('review');perform clinic_finance.lock_day();select * into r from clinic_finance.requests where id=p_id;
 if p_approve and r.status='pending' and r.kind='void' and (exists(select 1 from clinic_finance.insurance_claims where invoice_id=r.invoice_id) or exists(select 1 from clinic_finance.bill_items where invoice_id=r.invoice_id)) then raise exception 'أصبحت الفاتورة مرتبطة بمطالبة أو صرف؛ ارفض طلب الإلغاء وراجع المعالجة';end if;
 return clinic_finance.review_request_base(p_id,p_approve,p_note);end $$;

create or replace function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb:=clinic_finance.snapshot_base(p_from,p_to,p_offset);me uuid:=public.my_admin_id();reviewer boolean:=clinic_finance.allowed('review');
begin
 v:=v||jsonb_build_object('invoices',(select coalesce(jsonb_agg(x),'[]') from(select j||jsonb_build_object('insurance_assigned',coalesce((select sum(amount) from clinic_finance.insurance_claims where invoice_id=(j->>'id')::uuid),0),'patient_due',case when (j->>'voided')::boolean then 0 else (j->>'amount')::numeric-(j->>'collected')::numeric-coalesce((select sum(amount) from clinic_finance.insurance_claims where invoice_id=(j->>'id')::uuid),0) end,'items',(select coalesce(jsonb_agg(jsonb_build_object('name',b.name,'quantity',b.quantity,'sale_price',b.sale_price,'unit',b.unit)),'[]') from clinic_finance.bill_items b where b.invoice_id=(j->>'id')::uuid)) x from jsonb_array_elements(v->'invoices') j)t),
 'cash_cases',(select coalesce(jsonb_agg(x),'[]') from(select to_jsonb(c)||jsonb_build_object('cashier_name',a.name,'cashier_id',s.cashier_id,'register_name',r.name) x from clinic_finance.cash_cases c join clinic_finance.shifts s on s.id=c.shift_id join public.admins a on a.id=s.cashier_id join clinic_finance.registers r on r.id=s.register_id where (reviewer or s.cashier_id=me) order by c.updated_at desc,c.id desc limit 200 offset p_offset)t),
 'people',case when reviewer then(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.admins where active) else '[]'::jsonb end,
 'stock_catalog',(select coalesce(jsonb_agg(x),'[]') from(select jsonb_build_object('item_id',i.id,'location_id',l.id,'name',i.name,'unit',i.base_unit,'sale_price',i.current_sale_price,'location_name',l.name) x from public.inventory_items i cross join public.inventory_locations l where i.active and l.active and i.current_sale_price>0 and (public.inventory_location_can(l.id,'receive') or public.inventory_location_can(l.id,'manage')) order by l.name,i.name limit 2000)t),
 'insurance_claims',(select coalesce(jsonb_agg(x),'[]') from(select to_jsonb(c)||jsonb_build_object('due',clinic_finance.claim_due(c.id),'allowance',clinic_finance.claim_allowance(c.id),'invoice_reference',i.reference,'last_classification',(select kind from clinic_finance.insurance_actions where claim_id=c.id and status='approved' and kind in ('correction','resubmit') order by reviewed_at desc,id desc limit 1)) x from clinic_finance.insurance_claims c join clinic_finance.invoices i on i.id=c.invoice_id where (reviewer or c.created_by=me) and (c.created_at at time zone 'Africa/Cairo')::date between p_from and p_to order by c.created_at desc,c.id desc limit 200 offset p_offset)t),
 'insurance_actions',(select coalesce(jsonb_agg(x),'[]') from(select to_jsonb(a)||jsonb_build_object('claim_reference',c.reference) x from clinic_finance.insurance_actions a join clinic_finance.insurance_claims c on c.id=a.claim_id where (reviewer or a.created_by=me) and (a.status='pending' or (a.created_at at time zone 'Africa/Cairo')::date between p_from and p_to) order by a.created_at desc,a.id desc limit 200 offset p_offset)t));return v;
end $$;
revoke all on all functions in schema clinic_finance from public,anon,authenticated;
do $$ declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'clinic_finance_%' or p.proname='inventory_consume_at') loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to authenticated',f.sig);end loop;end $$;
commit;
