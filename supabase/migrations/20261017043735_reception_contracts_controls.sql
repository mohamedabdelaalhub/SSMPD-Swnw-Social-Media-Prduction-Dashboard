begin;
create table clinic_reception.entities(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),name text not null,kind text not null check(kind in ('insurer','discount','referral')),contracting_entity_id uuid);
create table clinic_reception.entity_contracts(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),entity_id uuid not null references clinic_reception.entities(id),service_code text not null,price numeric(14,2) not null check(price>0),coverage numeric(5,2) not null check(coverage between 0 and 100),valid_from date not null,valid_to date not null,reference text not null,terms text not null,status text not null default 'pending' check(status in ('pending','active','rejected')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),external_contract_id uuid,check(valid_to>=valid_from));
create table clinic_reception.order_quotes(order_id uuid primary key references clinic_reception.orders(id),workspace_id uuid not null references clinic_reception.workspaces(id),contract_id uuid not null references clinic_reception.entity_contracts(id),snapshot jsonb not null,authorization_ref text not null,quoted_by uuid not null references public.admins(id),quoted_at timestamptz not null default now());
create table clinic_reception.claims(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),invoice_id uuid not null unique references clinic_reception.invoices(id),entity_id uuid not null references clinic_reception.entities(id),amount numeric(14,2) not null check(amount>0),paid numeric(14,2) not null default 0,contractual numeric(14,2) not null default 0,allowance numeric(14,2) not null default 0,status text not null default 'ready' check(status in ('ready','correction','submitted','settled')),authorization_ref text not null,snapshot jsonb not null,check(paid+contractual<=amount),check(allowance>=0 and allowance<=amount-paid-contractual));
create table clinic_reception.requests(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),kind text not null check(kind in ('claim_correction','claim_submit','claim_contractual','claim_loss','claim_payment','credit_note','package_cancel','refund','doctor_payout','supplier_payout','expense','fund','waste')),subject_id uuid,amount numeric(14,2) not null check(amount>=0),payload jsonb not null,reason text not null,evidence text not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),created_at timestamptz not null default now(),review_note text);
alter table clinic_reception.invoices add column credit_amount numeric(14,2) not null default 0;
create or replace function clinic_reception.due(p_invoice uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select i.amount-i.payer_amount-i.credit_amount-coalesce((select sum(amount) from clinic_reception.allocations where invoice_id=i.id),0) from clinic_reception.invoices i where i.id=p_invoice$$;
create table clinic_reception.transfers(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),item_id uuid not null references clinic_reception.items(id),source_id uuid not null references clinic_reception.locations(id),destination_id uuid not null references clinic_reception.locations(id),quantity numeric(14,3) not null check(quantity>0),status text not null default 'pending' check(status in ('pending','approved','rejected','dispatched','received')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),dispatched_by uuid references public.admins(id),received_by uuid references public.admins(id),reason text not null,check(source_id<>destination_id));
create table clinic_reception.counts(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),location_id uuid not null references clinic_reception.locations(id),lot_id uuid not null references clinic_reception.lots(id),book numeric(14,3) not null,counted numeric(14,3) not null check(counted>=0),created_at timestamptz not null default now(),created_by uuid not null references public.admins(id),status text not null default 'pending' check(status in ('pending','approved','rejected')),reviewed_by uuid references public.admins(id),reason text not null);
create table clinic_reception.tasks(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),patient_id uuid references clinic_reception.patients(id),appointment_id uuid references clinic_reception.appointments(id),assigned_to uuid not null references public.admins(id),subject text not null,due_at timestamptz not null,status text not null default 'open' check(status in ('open','submitted','accepted','returned')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),result text,external_task_id uuid,created_at timestamptz not null default now(),submitted_at timestamptz);
create table clinic_reception.outbox(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),appointment_id uuid not null references clinic_reception.appointments(id),kind text not null check(kind in ('confirmation','reminder','cancellation','reschedule')),version text not null,body text not null,status text not null default 'draft' check(status in ('draft','approved','cancelled')),created_by uuid not null references public.admins(id),approved_by uuid references public.admins(id),created_at timestamptz not null default now(),unique(appointment_id,kind,version));
create table clinic_reception.attributions(appointment_id uuid primary key references clinic_reception.appointments(id),workspace_id uuid not null references clinic_reception.workspaces(id),lead_id uuid,source text not null,evidence text not null check(evidence in ('unknown','patient','tracked')),campaign_id text,adset_id text,ad_id text,creative_id text,utm_source text,utm_medium text,utm_campaign text,notes text not null,created_by uuid not null references public.admins(id),snapshot jsonb not null,created_at timestamptz not null default now());
-- Extend guarded endpoints; keep the previous version private for unchanged operations.
alter function public.clinic_reception_command(uuid,text,jsonb,uuid) set schema clinic_reception;
alter function clinic_reception.clinic_reception_command(uuid,text,jsonb,uuid) rename to packages_command;
alter function public.clinic_reception_snapshot(uuid,date,date) set schema clinic_reception;
alter function clinic_reception.clinic_reception_snapshot(uuid,date,date) rename to packages_snapshot;
alter table clinic_reception.journal add column event_no bigint generated always as identity;
alter table clinic_reception.shifts add column close_event_no bigint;
create or replace function clinic_reception.register_cash(p_workspace uuid,p_register uuid,p_after bigint default null) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(sum(l.debit-l.credit),0) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id left join clinic_reception.shifts s on s.id=nullif(j.dimensions->>'shift_id','')::uuid where j.workspace_id=p_workspace and l.account='1111' and coalesce(nullif(j.dimensions->>'register_id','')::uuid,s.register_id)=p_register and (p_after is null or j.event_no>p_after)
$$;
create or replace function clinic_reception.cash_limit(p_workspace uuid,p_register uuid) returns numeric language plpgsql stable security definer set search_path=pg_catalog,public as $$declare s clinic_reception.shifts%rowtype;book numeric;physical numeric;begin
 book:=clinic_reception.register_cash(p_workspace,p_register);select * into s from clinic_reception.shifts where workspace_id=p_workspace and register_id=p_register and status<>'open' order by closed_at desc,id desc limit 1;
 physical:=case when found then s.counted+clinic_reception.register_cash(p_workspace,p_register,coalesce(s.close_event_no,0)) else book end;return greatest(0,least(book,physical));
end $$;
-- Retain the period-independent register balance while closing a particular cashier's shift.
do $$declare def text;patched text;begin
 def:=pg_get_functiondef('clinic_reception.payment_operation(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$n:=clinic_reception.balance(p_workspace,'1111','shift_id',shift.id::text);$s$,$s$n:=clinic_reception.register_cash(p_workspace,shift.register_id);$s$);
 if def=patched then raise exception 'Missing shift close patch';end if;execute patched;
end $$;
create or replace function clinic_reception.review_operation(p_workspace uuid,p_payload jsonb,p_me uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r clinic_reception.requests%rowtype;i clinic_reception.invoices%rowtype;p clinic_reception.payments%rowtype;pkg clinic_reception.packages%rowtype;c clinic_reception.claims%rowtype;o clinic_reception.orders%rowtype;sh clinic_reception.shifts%rowtype;reg clinic_reception.registers%rowtype;v_amount numeric;due numeric;value numeric;fee numeric;already numeric;unpaid numeric;account text;method text;dims jsonb;payment uuid;patient uuid;sid uuid;ref text;approve boolean;item uuid;
begin
 select * into r from clinic_reception.requests where workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;approve:=(p_payload->>'approve')::boolean;
 if not found or r.created_by=p_me or r.status<>'pending' or approve is null or length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'الطلب يحتاج مراجعًا آخر وسبب القرار';end if;
 if not approve then update clinic_reception.requests set status='rejected',reviewed_by=p_me,review_note=p_payload->>'note' where id=r.id;return jsonb_build_object('id',r.id);end if;
 v_amount:=r.amount;
 if r.kind like 'claim_%' then
  select * into c from clinic_reception.claims where workspace_id=p_workspace and id=r.subject_id for update;if not found then raise exception 'المطالبة غير متاحة';end if;
  select * into i from clinic_reception.invoices where id=c.invoice_id;patient:=i.patient_id;
  dims:=jsonb_build_object('patient_id',patient,'entity_id',c.entity_id,'invoice_id',i.id,'claim_id',c.id,'request_id',r.id);
  due:=c.amount-c.paid-c.contractual;
  if r.kind in ('claim_contractual','claim_loss','claim_payment') and (v_amount<=0 or v_amount>due) then raise exception 'القيمة تتجاوز رصيد المطالبة';end if;
  if r.kind='claim_correction' then update clinic_reception.claims set status='correction' where id=c.id;
  elsif r.kind='claim_submit' then update clinic_reception.claims set status='submitted' where id=c.id;
  elsif r.kind='claim_loss' then
   if v_amount>due-c.allowance then raise exception 'المخصص يتجاوز الدين المتبقي';end if;
   perform clinic_reception.post(p_workspace,'claim_loss',r.id,'خسارة ائتمان متوقعة','5230','1193',v_amount,dims);update clinic_reception.claims set allowance=allowance+v_amount where id=c.id;
  else
   value:=least(c.allowance,v_amount);if value>0 then perform clinic_reception.post(p_workspace,'claim_allowance_release',r.id,'رد المخصص المقابل للتسوية','1193','5230',value,dims);update clinic_reception.claims set allowance=allowance-value where id=c.id;end if;
   if r.kind='claim_payment' then
    method:=r.payload->>'method';if method not in ('bank','instapay') or method is null or length(trim(coalesce(r.payload->>'reference','')))<2 then raise exception 'تحصيل الجهة بالبنك أو إنستا باي مع مرجع';end if;
    if exists(select 1 from clinic_reception.requests where workspace_id=p_workspace and id<>r.id and status='approved' and kind='claim_payment' and payload->>'reference'=r.payload->>'reference') then raise exception 'مرجع تحصيل الجهة مكرر';end if;
    perform clinic_reception.post(p_workspace,'claim_payment',r.id,'تحصيل مطالبة جهة','1112','1123',v_amount,dims);update clinic_reception.claims set paid=paid+v_amount where id=c.id;
   else
    perform clinic_reception.post(p_workspace,'claim_contractual',r.id,'تخفيض تعاقدي معتمد','4191','1123',v_amount,dims);update clinic_reception.claims set contractual=contractual+v_amount where id=c.id;
    select * into o from clinic_reception.orders where id=i.order_id;fee:=round(o.doctor_fee*v_amount/i.amount,2);
    if fee>0 then perform clinic_reception.post(p_workspace,'doctor_contractual',r.id,'تسوية أتعاب مرتبطة بتخفيض الإيراد','2120','5111',fee,dims||jsonb_build_object('provider_id',o.provider_id));end if;
   end if;

   update clinic_reception.claims set status=case when v_amount=due then 'settled' else status end where id=c.id;
  end if;
 elsif r.kind='credit_note' then
  select * into i from clinic_reception.invoices where id=r.subject_id and workspace_id=p_workspace and kind='service' for update;if not found then raise exception 'اختر فاتورة خدمة منفذة';end if;
  select coalesce(sum(amount),0) into already from clinic_reception.requests where workspace_id=p_workspace and subject_id=i.id and kind='credit_note' and status='approved';
  if v_amount<=0 or v_amount+already>i.amount-coalesce((select amount from clinic_reception.claims where invoice_id=i.id),0) then raise exception 'قيمة الإشعار تتجاوز حصة المريض القابلة للتخفيض';end if;
  patient:=i.patient_id;dims:=jsonb_build_object('patient_id',patient,'invoice_id',i.id,'request_id',r.id);due:=clinic_reception.due(i.id);value:=least(due,v_amount);
  if value>0 then perform clinic_reception.post(p_workspace,'credit_note_ar',r.id,'إشعار دائن للمريض','4192','1122',value,dims);update clinic_reception.invoices set credit_amount=credit_amount+value where id=i.id;end if;
  if v_amount>value then perform clinic_reception.post(p_workspace,'credit_note_credit',r.id,'رصيد إشعار دائن للمريض','4192','2150',v_amount-value,dims);end if;
  select * into o from clinic_reception.orders where id=i.order_id;fee:=round(o.doctor_fee*v_amount/i.amount,2);
  if fee>0 then perform clinic_reception.post(p_workspace,'doctor_credit_note',r.id,'تسوية أتعاب الإشعار الدائن','2120','5111',fee,dims||jsonb_build_object('provider_id',o.provider_id));end if;
  -- A financial credit never fabricates a stock return or restores an executed entitlement.
 elsif r.kind='package_cancel' then
  select * into pkg from clinic_reception.packages where id=r.subject_id and workspace_id=p_workspace and status='active' for update;if not found then raise exception 'الباكج غير متاح للإيقاف';end if;
  patient:=pkg.patient_id;dims:=jsonb_build_object('patient_id',patient,'package_id',pkg.id,'request_id',r.id);
  -- Cancel only unconditional installments not yet settled, then release the paid unused liability.
  for i in select * from clinic_reception.invoices where package_id=pkg.id and kind='installment' for update loop
   unpaid:=clinic_reception.due(i.id);if unpaid>0 then perform clinic_reception.post(p_workspace,'cancel_installment',i.id,'إلغاء استحقاق غير منفذ عند إيقاف الباكج','2151','1122',unpaid,dims||jsonb_build_object('invoice_id',i.id));update clinic_reception.invoices set credit_amount=credit_amount+unpaid where id=i.id;end if;
  end loop;
  value:=-clinic_reception.balance(p_workspace,'2151','package_id',pkg.id::text);
  if value<0 or v_amount<>value then raise exception 'راجع الرصيد غير المستخدم المسترد بعد إلغاء الأقساط غير المحصلة';end if;
  if v_amount>0 then perform clinic_reception.post(p_workspace,'package_cancel',r.id,'تحويل مقدم غير مستخدم لرصيد المريض','2151','2150',v_amount,dims);end if;
  update clinic_reception.packages set status='frozen' where id=pkg.id;
  update clinic_reception.orders set status='cancelled' where status='ordered' and entitlement_id in(select id from clinic_reception.entitlements where package_id=pkg.id);
  update clinic_reception.appointments set status='cancelled',cancel_reason=r.reason where package_id=pkg.id and status='booked';
 elsif r.kind='refund' then
  select * into p from clinic_reception.payments where id=r.subject_id and workspace_id=p_workspace for update;if not found then raise exception 'إيصال التحصيل غير متاح';end if;
  patient:=p.patient_id;select coalesce(sum(amount),0) into already from clinic_reception.requests where workspace_id=p_workspace and kind='refund' and subject_id=p.id and status='approved';
  if v_amount<=0 or v_amount>p.amount-already or v_amount> -clinic_reception.balance(p_workspace,'2150','patient_id',patient::text) then raise exception 'الاسترداد يتجاوز الإيصال أو الرصيد المستحق للمريض';end if;
  method:=p.method;account:=case method when 'cash' then '1111' when 'pos' then '1114' when 'wallet' then '1115' else '1112' end;sid:=nullif(r.payload->>'shift_id','')::uuid;
  if method='cash' then
   select * into sh from clinic_reception.shifts where id=sid and workspace_id=p_workspace and status='open' and cashier_id=r.created_by;
   if not found then raise exception 'اختر وردية صرف مفتوحة تخص طالب الاسترداد';end if;
   select * into reg from clinic_reception.registers where id=sh.register_id;
   if reg.direction='receive' or v_amount>clinic_reception.cash_limit(p_workspace,reg.id) then raise exception 'الخزينة لا تسمح بالصرف أو الكاش لا يكفي؛ لا يسمح برصيد سالب';end if;
  end if;
  if length(trim(coalesce(r.payload->>'reference','')))<2 then raise exception 'أدخل مرجع الرد عبر نفس وسيلة التحصيل';end if;
  perform clinic_reception.post(p_workspace,'refund',r.id,'استرداد رصيد المريض عبر الوسيلة الأصلية','2150',account,v_amount,jsonb_build_object('patient_id',patient,'payment_id',p.id,'request_id',r.id,'shift_id',sid,'register_id',sh.register_id,'method',method));
 elsif r.kind in ('doctor_payout','supplier_payout','expense','fund') then
  method:=r.payload->>'method';sid:=nullif(r.payload->>'shift_id','')::uuid;
  if v_amount<=0 or method is null or method not in ('cash','bank','instapay') or length(trim(coalesce(r.payload->>'reference','')))<2 then raise exception 'راجع القيمة وطريقة الصرف والمرجع';end if;
  account:=case when method='cash' then '1111' else '1112' end;
  if method='cash' or r.kind='fund' then
   select * into sh from clinic_reception.shifts where id=sid and workspace_id=p_workspace and status='open' and cashier_id=r.created_by;if not found then raise exception 'الوردية غير متاحة لطالب الصرف';end if;
   select * into reg from clinic_reception.registers where id=sh.register_id;
   if r.kind<>'fund' and (reg.direction='receive' or v_amount>clinic_reception.cash_limit(p_workspace,reg.id)) then raise exception 'الكاش المتاح لا يكفي أو الخزينة للاستلام فقط';end if;
  end if;
  dims:=jsonb_build_object('request_id',r.id,'shift_id',sid,'register_id',sh.register_id,'provider_id',case when r.kind='doctor_payout' then r.subject_id end,'supplier_id',case when r.kind='supplier_payout' then r.subject_id end);
  if r.kind='doctor_payout' then
   value:=-clinic_reception.balance(p_workspace,'2120','provider_id',r.subject_id::text);if v_amount>value then raise exception 'الصرف يتجاوز مستحق الطبيب المنفذ';end if;perform clinic_reception.post(p_workspace,r.kind,r.id,'صرف مستحق طبيب','2120',account,v_amount,dims);
  elsif r.kind='supplier_payout' then
   value:=-clinic_reception.balance(p_workspace,'2111','supplier_id',r.subject_id::text);if v_amount>value then raise exception 'الصرف يتجاوز حساب المورد';end if;perform clinic_reception.post(p_workspace,r.kind,r.id,'سداد حساب المورد','2111',account,v_amount,dims);
  elsif r.kind='fund' then perform clinic_reception.post(p_workspace,r.kind,r.id,'تغذية خزينة من البنك','1111','1112',v_amount,dims);
  else
   account:=case r.payload->>'category' when 'electricity' then '5219' when 'water' then '5220' when 'gas' then '5222' when 'waste' then '5223' when 'rent' then '5225' when 'other' then '5224' end;
   if account is null then raise exception 'حدد بند المصروف';end if;
   perform clinic_reception.post(p_workspace,r.kind,r.id,'مصروف عمومي معتمد',account,case when method='cash' then '1111' else '1112' end,v_amount,dims);
  end if;
 elsif r.kind='waste' then
  perform clinic_reception.consume(p_workspace,r.subject_id,(r.payload->>'location_id')::uuid,clinic_reception.number(r.payload->>'quantity',3),'waste',r.id);
 else raise exception 'نوع الطلب غير معروف';end if;
 update clinic_reception.requests set status='approved',reviewed_by=p_me,review_note=p_payload->>'note' where id=r.id;return jsonb_build_object('id',r.id);
end $$;
create or replace function clinic_reception.controls_operation(p_workspace uuid,p_action text,p_payload jsonb,p_me uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v uuid;contract clinic_reception.entity_contracts%rowtype;entity clinic_reception.entities%rowtype;o clinic_reception.orders%rowtype;tr clinic_reception.transfers%rowtype;ct clinic_reception.counts%rowtype;lot clinic_reception.lots%rowtype;task clinic_reception.tasks%rowtype;a clinic_reception.appointments%rowtype;v_kind text;approve boolean;balance numeric;delta numeric;qty numeric;value numeric;movement record;snapshot jsonb;cap text;
begin
 if p_action='entity' then
  if length(trim(coalesce(p_payload->>'name','')))<2 then raise exception 'أدخل اسم الجهة';end if;
  insert into clinic_reception.entities(workspace_id,name,kind) values(p_workspace,p_payload->>'name',p_payload->>'kind') returning id into v;
 elsif p_action='entity_contract' then
  select * into entity from clinic_reception.entities where id=(p_payload->>'entity_id')::uuid and workspace_id=p_workspace;
  if not found or length(trim(coalesce(p_payload->>'reference','')))<2 or length(trim(coalesce(p_payload->>'terms','')))<3 or not exists(select 1 from clinic_reception.services where workspace_id=p_workspace and code=p_payload->>'service_code' and active) then raise exception 'راجع الجهة والخدمة ومستند الاتفاق';end if;
  if entity.kind<>'insurer' and coalesce((p_payload->>'coverage')::numeric,0)<>0 then raise exception 'جهة الخصم والترشيح لا تتحمل مطالبة تأمين';end if;
  insert into clinic_reception.entity_contracts(workspace_id,entity_id,service_code,price,coverage,valid_from,valid_to,reference,terms,created_by) values(p_workspace,entity.id,p_payload->>'service_code',clinic_reception.number(p_payload->>'price'),clinic_reception.number(p_payload->>'coverage',2,true),(p_payload->>'from')::date,(p_payload->>'to')::date,p_payload->>'reference',p_payload->>'terms',p_me) returning id into v;
 elsif p_action='entity_contract_review' then
  select * into contract from clinic_reception.entity_contracts where id=(p_payload->>'id')::uuid and workspace_id=p_workspace for update;approve:=(p_payload->>'approve')::boolean;
  if not found or contract.created_by=p_me or contract.status<>'pending' or approve is null then raise exception 'العقد يحتاج مراجعًا آخر';end if;
  if approve and exists(select 1 from clinic_reception.entity_contracts where workspace_id=p_workspace and entity_id=contract.entity_id and service_code=contract.service_code and status='active' and valid_from<=contract.valid_to and valid_to>=contract.valid_from) then raise exception 'تداخل عقود الجهة والخدمة';end if;
  update clinic_reception.entity_contracts set status=case when approve then 'active' else 'rejected' end,reviewed_by=p_me where id=contract.id;v:=contract.id;
 elsif p_action='quote' then
  select * into o from clinic_reception.orders where workspace_id=p_workspace and id=(p_payload->>'order_id')::uuid and status='ordered' for update;
  if not found then raise exception 'الخدمة غير متاحة للتسعير';end if;
  if exists(select 1 from clinic_reception.discount_requests where order_id=o.id and status='pending') then raise exception 'احسم الخصم المعلق قبل تسعير الجهة';end if;
  select * into contract from clinic_reception.entity_contracts where id=(p_payload->>'contract_id')::uuid and workspace_id=p_workspace and status='active' and service_code=o.snapshot->>'code' and current_date between valid_from and valid_to;
  if not found or length(trim(coalesce(p_payload->>'authorization_ref','')))<2 then raise exception 'راجع عقد الجهة وإثبات الأهلية أو الموافقة';end if;
  select * into entity from clinic_reception.entities where id=contract.entity_id;
  if o.entitlement_id is not null and entity.kind<>'insurer' then raise exception 'الباكج يحفظ سعر تعاقده؛ لا يجمع خصمًا جديدًا تلقائيًا';end if;
  insert into clinic_reception.order_quotes values(o.id,p_workspace,contract.id,to_jsonb(contract)||jsonb_build_object('entity_name',entity.name,'entity_kind',entity.kind),p_payload->>'authorization_ref',p_me,now()) on conflict(order_id) do update set contract_id=excluded.contract_id,snapshot=excluded.snapshot,authorization_ref=excluded.authorization_ref,quoted_by=p_me,quoted_at=now();
  if o.entitlement_id is null then update clinic_reception.orders set price=contract.price,discount=0 where id=o.id;end if;v:=o.id;
 elsif p_action='request' then
  v_kind:=p_payload->>'kind';
  if length(trim(coalesce(p_payload->>'reason','')))<3 or length(trim(coalesce(p_payload->>'evidence','')))<2 then raise exception 'أدخل السبب والمستند';end if;
  insert into clinic_reception.requests(workspace_id,kind,subject_id,amount,payload,reason,evidence,created_by) values(p_workspace,v_kind,nullif(p_payload->>'subject_id','')::uuid,clinic_reception.number(coalesce(p_payload->>'amount','0'),2,true),p_payload,p_payload->>'reason',p_payload->>'evidence',p_me) returning id into v;
 elsif p_action='request_review' then return clinic_reception.review_operation(p_workspace,p_payload,p_me);
 elsif p_action='transfer_request' then
  if not exists(select 1 from clinic_reception.items where id=(p_payload->>'item_id')::uuid and workspace_id=p_workspace) or (select count(*) from clinic_reception.locations where workspace_id=p_workspace and id in((p_payload->>'source_id')::uuid,(p_payload->>'destination_id')::uuid))<>2 or length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'راجع الصنف والمخزنين والسبب';end if;
  insert into clinic_reception.transfers(workspace_id,item_id,source_id,destination_id,quantity,created_by,reason) values(p_workspace,(p_payload->>'item_id')::uuid,(p_payload->>'source_id')::uuid,(p_payload->>'destination_id')::uuid,clinic_reception.number(p_payload->>'quantity',3),p_me,p_payload->>'reason') returning id into v;
 elsif p_action in ('transfer_review','transfer_dispatch','transfer_receive') then
  select * into tr from clinic_reception.transfers where id=(p_payload->>'id')::uuid and workspace_id=p_workspace for update;if not found then raise exception 'التحويل غير موجود';end if;
  if p_action='transfer_review' then
   approve:=(p_payload->>'approve')::boolean;if tr.created_by=p_me or tr.status<>'pending' or approve is null then raise exception 'التحويل يحتاج اعتماد شخص آخر';end if;
   update clinic_reception.transfers set status=case when approve then 'approved' else 'rejected' end,reviewed_by=p_me where id=tr.id;
  elsif p_action='transfer_dispatch' then
   if tr.status<>'approved' then raise exception 'التحويل غير معتمد';end if;
   perform clinic_reception.consume(p_workspace,tr.item_id,tr.source_id,tr.quantity,'transfer_out',tr.id);
   -- Inventory ownership is unchanged while stock is in transit. No consumption/revenue entry.
   update clinic_reception.transfers set status='dispatched',dispatched_by=p_me where id=tr.id;
  else
   if tr.status<>'dispatched' or tr.dispatched_by=p_me then raise exception 'الاستلام لشخص آخر بعد الإرسال الفعلي';end if;
   if clinic_reception.number(p_payload->>'quantity',3)<>tr.quantity then raise exception 'الكمية مختلفة؛ لا تعتمد استلامًا وهميًا، سجل فرقًا للمراجعة قبل التسوية';end if;
   for movement in select * from clinic_reception.movements where workspace_id=p_workspace and source_id=tr.id and kind='transfer_out' loop
    insert into clinic_reception.movements(workspace_id,item_id,location_id,lot_id,kind,quantity,unit_cost,source_id,actor_id) values(p_workspace,tr.item_id,tr.destination_id,movement.lot_id,'transfer_in',-movement.quantity,movement.unit_cost,tr.id,p_me);
   end loop;
   update clinic_reception.transfers set status='received',received_by=p_me where id=tr.id;
  end if;v:=tr.id;
 elsif p_action='count' then
  select * into lot from clinic_reception.lots where workspace_id=p_workspace and id=(p_payload->>'lot_id')::uuid;
  if not found or not exists(select 1 from clinic_reception.locations where workspace_id=p_workspace and id=(p_payload->>'location_id')::uuid) or length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'راجع التشغيلة والمخزن وسبب الجرد';end if;
  select coalesce(sum(quantity),0) into balance from clinic_reception.movements where workspace_id=p_workspace and lot_id=lot.id and location_id=(p_payload->>'location_id')::uuid;
  if exists(select 1 from clinic_reception.counts where workspace_id=p_workspace and lot_id=lot.id and location_id=(p_payload->>'location_id')::uuid and status='pending') then raise exception 'يوجد جرد لنفس التشغيلة قيد المراجعة';end if;
  insert into clinic_reception.counts(workspace_id,lot_id,location_id,book,counted,created_by,reason) values(p_workspace,lot.id,(p_payload->>'location_id')::uuid,balance,clinic_reception.number(p_payload->>'counted',3,true),p_me,p_payload->>'reason') returning id into v;
 elsif p_action='count_review' then
  select * into ct from clinic_reception.counts where workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;approve:=(p_payload->>'approve')::boolean;
  if not found or ct.created_by=p_me or ct.status<>'pending' or approve is null then raise exception 'الجرد يحتاج مراجعة شخص آخر';end if;
  if approve then
   delta:=ct.counted-ct.book;select * into lot from clinic_reception.lots where id=ct.lot_id;
   select coalesce(sum(quantity),0) into balance from clinic_reception.movements where workspace_id=p_workspace and lot_id=ct.lot_id and location_id=ct.location_id;
   if balance+delta<0 then raise exception 'حدث صرف لاحق؛ راجع الفرق قبل اعتماد جرد يؤدي لرصيد سالب';end if;
   if delta<>0 then
    insert into clinic_reception.movements(workspace_id,item_id,location_id,lot_id,kind,quantity,unit_cost,source_id,actor_id) values(p_workspace,lot.item_id,ct.location_id,ct.lot_id,'count',delta,lot.unit_cost,ct.id,p_me);
    perform clinic_reception.post(p_workspace,'count',ct.id,'فرق جرد معتمد',case when delta<0 then '5226' else '1131' end,case when delta<0 then '1131' else '4117' end,round(abs(delta)*lot.unit_cost,2),jsonb_build_object('item_id',lot.item_id,'location_id',ct.location_id));
   end if;
  end if;
  update clinic_reception.counts set status=case when approve then 'approved' else 'rejected' end,reviewed_by=p_me where id=ct.id;v:=ct.id;
 elsif p_action='task' then
  if not exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=(p_payload->>'assigned_to')::uuid and cardinality(capabilities)>0) and not exists(select 1 from clinic_reception.workspaces where id=p_workspace and owner_id=(p_payload->>'assigned_to')::uuid) then raise exception 'المسؤول ليس عضوًا بالمساحة';end if;
  if nullif(p_payload->>'patient_id','') is not null and not exists(select 1 from clinic_reception.patients where workspace_id=p_workspace and id=(p_payload->>'patient_id')::uuid) or length(trim(coalesce(p_payload->>'subject','')))<3 then raise exception 'راجع المريض والمهمة';end if;
  insert into clinic_reception.tasks(workspace_id,patient_id,assigned_to,subject,due_at,created_by) values(p_workspace,nullif(p_payload->>'patient_id','')::uuid,(p_payload->>'assigned_to')::uuid,p_payload->>'subject',(p_payload->>'due_at')::timestamptz,p_me) returning id into v;
 elsif p_action='task_submit' then
  select * into task from clinic_reception.tasks where workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;
  if not found or task.assigned_to<>p_me or task.status not in ('open','returned') or length(trim(coalesce(p_payload->>'result','')))<3 then raise exception 'المهمة غير متاحة للتسليم';end if;
  update clinic_reception.tasks set status='submitted',result=p_payload->>'result',submitted_at=now() where id=task.id;v:=task.id;
 elsif p_action='task_review' then
  select * into task from clinic_reception.tasks where workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;approve:=(p_payload->>'approve')::boolean;
  if not found or task.assigned_to=p_me or task.status<>'submitted' or approve is null then raise exception 'المهمة تحتاج مراجعة مستقلة بعد التسليم';end if;
  update clinic_reception.tasks set status=case when approve then 'accepted' else 'returned' end,reviewed_by=p_me where id=task.id;v:=task.id;
 elsif p_action in ('message','message_review') then
  if p_action='message' then
   select * into a from clinic_reception.appointments where workspace_id=p_workspace and id=(p_payload->>'appointment_id')::uuid;
   if not found or length(trim(coalesce(p_payload->>'body','')))<3 then raise exception 'راجع الحجز ونص التواصل';end if;
   insert into clinic_reception.outbox(workspace_id,appointment_id,kind,version,body,created_by) values(p_workspace,a.id,p_payload->>'kind',a.starts_at::text||':'||a.status,p_payload->>'body',p_me) returning id into v;
  else
   update clinic_reception.outbox set status='approved',approved_by=p_me where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and status='draft' and created_by<>p_me returning id into v;
   if v is null then raise exception 'الرسالة تحتاج مراجعة شخص آخر';end if;
  end if;
 elsif p_action='attribution' then
  select * into a from clinic_reception.appointments where workspace_id=p_workspace and id=(p_payload->>'appointment_id')::uuid;
  if not found or exists(select 1 from clinic_reception.visits where appointment_id=a.id) then raise exception 'ثبت المصدر قبل بدء الزيارة للحفاظ على تاريخ الإسناد';end if;
  if p_payload->>'evidence'='tracked' then raise exception 'التتبع المؤكد يؤخذ من الليد المرتبط، لا يدخل يدويًا';end if;
  insert into clinic_reception.attributions(appointment_id,workspace_id,source,evidence,notes,created_by,snapshot) values(a.id,p_workspace,p_payload->>'source',p_payload->>'evidence',coalesce(p_payload->>'notes',''),p_me,p_payload) on conflict(appointment_id) do update set source=excluded.source,evidence=excluded.evidence,notes=excluded.notes,created_by=p_me,snapshot=excluded.snapshot;
  update clinic_reception.appointments set source=p_payload->>'source',source_evidence=p_payload->>'evidence' where id=a.id;v:=a.id;
 else raise exception 'إجراء غير معروف';end if;
 return jsonb_build_object('id',v);
end $$;
create or replace function public.clinic_reception_report(p_workspace uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'reports');v jsonb;begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'اختر فترة حتى سنة';end if;
 with performed as(select o.*,v.patient_id,a.source,a.source_evidence,a.created_by booked_by,p.branch,coalesce(at.campaign_id,'unknown') campaign_id,coalesce(at.ad_id,'unknown') ad_id,coalesce(at.creative_id,'unknown') creative_id,i.id invoice_id,
  coalesce((select sum(r.amount) from clinic_reception.requests r where r.workspace_id=p_workspace and r.status='approved' and (r.kind='credit_note' and r.subject_id=i.id or r.kind='claim_contractual' and r.subject_id in(select id from clinic_reception.claims where invoice_id=i.id))),0) reductions
  from clinic_reception.orders o join clinic_reception.visits v on v.id=o.visit_id join clinic_reception.appointments a on a.id=v.appointment_id join clinic_reception.providers p on p.id=o.provider_id join clinic_reception.invoices i on i.order_id=o.id left join clinic_reception.attributions at on at.appointment_id=a.id
  where o.workspace_id=p_workspace and o.status='completed' and (o.completed_at at time zone 'Africa/Cairo')::date between p_from and p_to),
 grouped as(select snapshot->>'department' department,branch,provider_id,booked_by,executed_by,source,source_evidence,campaign_id,ad_id,creative_id,count(*) service_lines,count(distinct visit_id) visits,count(distinct patient_id) patients,sum(net_revenue) revenue,sum(reductions) reductions,sum(cost) material_cost,sum(doctor_fee) physician_fee from performed group by snapshot->>'department',branch,provider_id,booked_by,executed_by,source,source_evidence,campaign_id,ad_id,creative_id)
 select jsonb_build_object('by_execution',coalesce((select jsonb_agg(to_jsonb(g)) from grouped g),'[]'),
 'ledger',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select l.account,sum(l.debit) debit,sum(l.credit) credit from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.workspace_id=p_workspace and (j.created_at at time zone 'Africa/Cairo')::date between p_from and p_to group by l.account)x),
 'collections',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select method,count(*) receipts,sum(amount) amount from clinic_reception.payments where workspace_id=p_workspace and (created_at at time zone 'Africa/Cairo')::date between p_from and p_to group by method)x),
 'devices',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select device_id,count(*) uses,sum(minutes) minutes,sum(meter_after-meter_before) meter_units from clinic_reception.device_uses where workspace_id=p_workspace and (created_at at time zone 'Africa/Cairo')::date between p_from and p_to group by device_id)x),
 'team',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select assigned_to,count(*) assigned,count(*) filter(where status='accepted') accepted,count(*) filter(where status='submitted') waiting_review,count(*) filter(where submitted_at>due_at) submitted_late,count(*) filter(where status in ('open','returned') and due_at<now()) overdue from clinic_reception.tasks where workspace_id=p_workspace and (created_at at time zone 'Africa/Cairo')::date between p_from and p_to group by assigned_to)x),
 'booking_funnel',(select jsonb_build_object('booked',count(*),'arrived',count(*) filter(where status in ('arrived','completed')),'no_show',count(*) filter(where status='no_show'),'cancelled',count(*) filter(where status='cancelled')) from clinic_reception.appointments where workspace_id=p_workspace and (starts_at at time zone 'Africa/Cairo')::date between p_from and p_to),
 'scope',jsonb_build_object('from',p_from,'to',p_to,'timezone','Africa/Cairo','trial',(select mode='trial' from clinic_reception.workspaces where id=p_workspace),'marketing_cost_complete',false,'overhead_complete',false,'note','أرقام من العمليات المسجلة؛ لا تعد أرباحًا نهائية قبل استكمال المصروفات والتكاليف والإعلانات. عدد الزيارات داخل المجموعات غير قابل للجمع عبر خدمات وأطباء مختلفين.')) into v;return v;
end $$;
-- Register dimensions are frozen for every posting, including earlier payment code paths.
alter function clinic_reception.post(uuid,text,uuid,text,text,text,numeric,jsonb) rename to trial_post;
create or replace function clinic_reception.post(p_workspace uuid,p_source text,p_id uuid,p_description text,p_debit text,p_credit text,p_amount numeric,p_dimensions jsonb default '{}') returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare sh clinic_reception.shifts%rowtype;begin
 if nullif(p_dimensions->>'shift_id','') is not null then select * into sh from clinic_reception.shifts where id=(p_dimensions->>'shift_id')::uuid and workspace_id=p_workspace;if not found then raise exception 'الوردية خارج المساحة';end if;p_dimensions:=p_dimensions||jsonb_build_object('register_id',sh.register_id);end if;
 return clinic_reception.trial_post(p_workspace,p_source,p_id,p_description,p_debit,p_credit,p_amount,p_dimensions);
end $$;
create or replace function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;prev clinic_reception.commands%rowtype;outcome jsonb;q clinic_reception.order_quotes%rowtype;i clinic_reception.invoices%rowtype;cover numeric;ar numeric;v uuid;dims jsonb;new_action boolean;
begin
 new_action:=p_action in ('entity','entity_contract','entity_contract_review','quote','request','request_review','transfer_request','transfer_review','transfer_dispatch','transfer_receive','count','count_review','task','task_submit','task_review','message','message_review','attribution');
 if not new_action then
  if p_action='execute' then
   perform clinic_reception.access(p_workspace,'execute');select * into q from clinic_reception.order_quotes where order_id=(p_payload->>'id')::uuid and workspace_id=p_workspace;
   if found and current_date not between (q.snapshot->>'valid_from')::date and (q.snapshot->>'valid_to')::date then raise exception 'راجع صلاحية عقد التغطية وقت التنفيذ';end if;
  end if;
  outcome:=clinic_reception.packages_command(p_workspace,p_action,p_payload,p_token);
  if p_action='execute' then
   v:=(outcome->>'id')::uuid;select * into i from clinic_reception.invoices where id=v;
   select * into q from clinic_reception.order_quotes where order_id=i.order_id;
   if found and not exists(select 1 from clinic_reception.claims where invoice_id=i.id) then
    -- Coverage concerns the service only. Additional materials stay on the patient unless a future explicit contract covers them.
    select round((case when o.entitlement_id is null then o.price*o.quantity*(1-o.discount/100) else en.allocated_value*o.quantity/en.quantity end)*(q.snapshot->>'coverage')::numeric/100,2) into cover from clinic_reception.orders o left join clinic_reception.entitlements en on en.id=o.entitlement_id where o.id=i.order_id;
    if cover>0 then
     insert into clinic_reception.claims(workspace_id,invoice_id,entity_id,amount,authorization_ref,snapshot) values(p_workspace,i.id,(q.snapshot->>'entity_id')::uuid,cover,q.authorization_ref,q.snapshot) returning id into v;
     dims:=jsonb_build_object('patient_id',i.patient_id,'invoice_id',i.id,'claim_id',v,'entity_id',q.snapshot->>'entity_id','package_id',i.package_id);
     ar:=least(clinic_reception.due(i.id),cover);if ar>0 then perform clinic_reception.post(p_workspace,'payer_ar',v,'تحويل حصة جهة التغطية','1123','1122',ar,dims);update clinic_reception.invoices set payer_amount=ar where id=i.id;end if;
     if cover>ar then perform clinic_reception.post(p_workspace,'payer_credit',v,'رصيد للمريض مقابل تغطية مدفوعة مقدمًا','1123','2150',cover-ar,dims);end if;
    end if;
   end if;
  end if;
  if p_action='shift_close' then update clinic_reception.shifts set close_event_no=(select coalesce(max(event_no),0) from clinic_reception.journal) where id=(outcome->>'id')::uuid;end if;
  if p_action in ('cancel','no_show','reschedule') then update clinic_reception.outbox set status='cancelled' where workspace_id=p_workspace and appointment_id=(p_payload->>'id')::uuid and status in ('draft','approved');end if;
  return outcome;
 end if;
 me:=clinic_reception.access(p_workspace,case when p_action in ('entity','entity_contract','task') then 'manage' when p_action in ('entity_contract_review','request_review','transfer_review','count_review','task_review','message_review') then 'review' when p_action in ('transfer_request','transfer_dispatch','transfer_receive','count') then 'warehouse' when p_action='task_submit' then 'view' when p_action='request' then 'collect' else 'book' end);
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>60000 then raise exception 'طلب غير صالح';end if;
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 select * into prev from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
 if found then if prev.action<>p_action or prev.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;return prev.response;end if;
 outcome:=clinic_reception.controls_operation(p_workspace,p_action,p_payload,me);
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id) values(p_workspace,me,p_action,(outcome->>'id')::uuid);
 insert into clinic_reception.commands values(p_workspace,me,p_token,p_action,p_payload,outcome);return outcome;
end $$;
create or replace function public.clinic_reception_snapshot(p_workspace uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare me uuid:=clinic_reception.access(p_workspace,'view');v jsonb;manager boolean;reviewer boolean;begin
 v:=clinic_reception.packages_snapshot(p_workspace,p_from,p_to);manager:=(v->>'can_manage')::boolean;reviewer:=manager or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and 'review'=any(capabilities));
 if reviewer and not manager then v:=v||jsonb_build_object('agreements',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.doctor_agreements x where workspace_id=p_workspace),'purchases',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from clinic_reception.purchase_lines l where purchase_id=x.id))),'[]') from clinic_reception.purchases x where workspace_id=p_workspace),'discounts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.discount_requests x where workspace_id=p_workspace),'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from clinic_reception.suppliers where workspace_id=p_workspace));end if;
 return v||jsonb_build_object(
 'can_review',reviewer,
 'entities',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.entities x where workspace_id=p_workspace),
 'entity_contracts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.entity_contracts x where workspace_id=p_workspace and (manager or status='active')),
 'quotes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.order_quotes x where workspace_id=p_workspace),
 'claims',case when reviewer then(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.claims x where workspace_id=p_workspace) else '[]'::jsonb end,
 'requests',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.requests x where workspace_id=p_workspace and (manager or created_by=me or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and 'review'=any(capabilities)))),
 'transfers',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.transfers x where workspace_id=p_workspace),
 'counts',(select coalesce(jsonb_agg(case when manager then to_jsonb(x) else to_jsonb(x)-'book' end),'[]') from clinic_reception.counts x where workspace_id=p_workspace and (reviewer or created_by=me)),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.tasks x where workspace_id=p_workspace and (manager or assigned_to=me)),
 'outbox',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.outbox x where workspace_id=p_workspace),
 'attributions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.attributions x where workspace_id=p_workspace),
 'provider_balances',case when manager then(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'due',-clinic_reception.balance(p_workspace,'2120','provider_id',x.id::text))),'[]') from clinic_reception.providers x where workspace_id=p_workspace) else '[]'::jsonb end);
end $$;
do $$declare r record;begin
 for r in select tablename from pg_tables where schemaname='clinic_reception' loop execute format('alter table clinic_reception.%I enable row level security',r.tablename);execute format('revoke all on clinic_reception.%I from public,anon,authenticated',r.tablename);end loop;
 for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_reception' loop execute format('revoke all on function %s from public,anon,authenticated',r.sig);end loop;
end $$;
revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid),public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
revoke all on function public.clinic_reception_report(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_report(uuid,date,date) to authenticated;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid),public.clinic_reception_snapshot(uuid,date,date) to authenticated;
commit;
