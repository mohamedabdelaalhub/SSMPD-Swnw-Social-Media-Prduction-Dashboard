begin;
alter table clinic_reception.invoices add column invoice_no bigint generated always as identity;
alter table clinic_reception.visits add column close_note text;
alter table clinic_reception.invoices drop constraint invoices_amount_check;
alter table clinic_reception.invoices add constraint invoices_amount_check check(amount>=0 and amount::text not in ('NaN','Infinity','-Infinity'));
create unique index reception_invoice_number on clinic_reception.invoices(invoice_no);
create index reception_patient_ledger on clinic_reception.journal(workspace_id,(dimensions->>'patient_id'));
create index reception_invoice_patient on clinic_reception.invoices(workspace_id,patient_id,created_at);
create index reception_payment_patient on clinic_reception.payments(workspace_id,patient_id,created_at);
create index reception_visit_order on clinic_reception.orders(workspace_id,visit_id);
create index reception_package_patient on clinic_reception.packages(workspace_id,patient_id);
create or replace function clinic_reception.booking_minutes(p_workspace uuid,p_payload jsonb) returns integer language plpgsql stable security definer set search_path=pg_catalog,public as $$declare n integer;begin
 if nullif(p_payload->>'package_id','') is null then select minutes into n from clinic_reception.services where workspace_id=p_workspace and id=(p_payload->>'service_id')::uuid;
 else select ceil(sum((e.snapshot->>'minutes')::numeric*(e.quantity-e.used))) into n from clinic_reception.entitlements e join clinic_reception.packages p on p.id=e.package_id where p.workspace_id=p_workspace and p.id=(p_payload->>'package_id')::uuid and p.patient_id=(p_payload->>'patient_id')::uuid and e.visit_no=(p_payload->>'package_visit_no')::integer and e.used<e.quantity;end if;
 if n is null or n not between 5 and 480 then raise exception 'راجع مدة خدمات الزيارة؛ الحد ثماني ساعات';end if;return n;
end $$;
do $$declare def text;patched text;begin
 def:=pg_get_functiondef('clinic_reception.workspace_command(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$e:=t+make_interval(mins=>s.minutes);$s$,$s$e:=t+make_interval(mins=>clinic_reception.booking_minutes(p_workspace,p_payload));$s$);
 if def=patched then raise exception 'Missing duration patch';end if;execute patched;
 def:=pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$if not exists(select 1 from clinic_reception.orders where visit_id=visit.id and status='ordered') then update clinic_reception.visits set status='completed',closed_at=now() where id=visit.id;update clinic_reception.appointments set status='completed' where id=visit.appointment_id;end if;$s$,$s$-- Visit closure is an explicit event; additional services may still be added.$s$);
 if def=patched then raise exception 'Missing visit closure patch';end if;patched:=replace(patched,'if net+extra<=0 then','if net+extra<0 then');execute patched;
 def:=pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$ends:=starts+make_interval(mins=>service.minutes);$s$,$s$ends:=starts+make_interval(mins=>clinic_reception.booking_minutes(p_workspace,p_payload));$s$);
 if def=patched then raise exception 'Missing device duration patch';end if;execute patched;
end $$;
do $$declare def text;patched text;begin
 def:=pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$perform clinic_finance.lock_day();perform clinic_reception.sync_stock(p_workspace);$s$,$s$if p_action in ('execute','collect','credit_apply','receive_purchase','transfer_dispatch','transfer_receive','count_review','request_review','installment_bill','shift_open','shift_close','shift_review') then perform clinic_finance.lock_day();perform clinic_reception.sync_stock(p_workspace);elsif p_action='count' then perform clinic_reception.sync_stock(p_workspace);end if;$s$);
 if def=patched then raise exception 'Missing operational/financial period patch';end if;execute patched;
 def:=pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure);patched:=replace(def,$s$if service.requires_device or device is not null then$s$,$s$if service.requires_device or device is not null or exists(select 1 from clinic_reception.entitlements e join clinic_reception.packages p on p.id=e.package_id where p.workspace_id=p_workspace and p.id=nullif(p_payload->>'package_id','')::uuid and e.visit_no=(p_payload->>'package_visit_no')::integer and e.used<e.quantity and coalesce((e.snapshot->>'requires_device')::boolean,false)) then$s$);if def=patched then raise exception 'Missing package device guard';end if;execute patched;
end $$;
alter function public.clinic_reception_command(uuid,text,jsonb,uuid) set schema clinic_reception;
alter function clinic_reception.clinic_reception_command(uuid,text,jsonb,uuid) rename to bridge_command;
create table clinic_reception.marketing_requests(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),ad_id text not null,reference text not null,lines jsonb not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),created_at timestamptz not null default now(),review_note text,request_no bigint generated always as identity);
create table clinic_reception.marketing_daily(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),ad_id text not null,day date not null,amount numeric(14,2) not null check(amount>=0),request_id uuid not null references clinic_reception.marketing_requests(id),is_current boolean not null default true);
create unique index reception_daily_marketing_active on clinic_reception.marketing_daily(workspace_id,ad_id,day) where is_current;
alter table clinic_reception.marketing_requests enable row level security;
alter table clinic_reception.marketing_daily enable row level security;
revoke all on clinic_reception.marketing_requests,clinic_reception.marketing_daily from public,anon,authenticated;
create or replace function clinic_reception.marketing_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare me uuid;prev clinic_reception.commands%rowtype;r clinic_reception.marketing_requests%rowtype;x jsonb;v uuid;approve boolean;outcome jsonb;begin
 me:=clinic_reception.access(p_workspace,case when p_action='marketing_review' then 'review' else 'reports' end);
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>60000 then raise exception 'طلب غير صالح';end if;
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 select * into prev from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
 if found then if prev.action<>p_action or prev.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;return prev.response;end if;
 if p_action='marketing_spend' then
  if length(trim(coalesce(p_payload->>'ad_id',''))) not between 2 and 100 or length(trim(coalesce(p_payload->>'reference',''))) not between 3 and 150 or jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 366 then raise exception 'أدخل الإعلان ومرجع تقرير الإنفاق وأيامه';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'lines') elt group by elt->>'day' having count(*)>1) then raise exception 'اليوم مكرر في تقرير الإنفاق';end if;
  for x in select * from jsonb_array_elements(p_payload->'lines') loop perform clinic_reception.number(x->>'amount',2,true);if (x->>'day')::date is null or (x->>'day')::date<'2020-01-01'::date or (x->>'day')::date>clinic_reception.today() then raise exception 'أدخل تاريخ إنفاق فعلي صالح';end if;end loop;
  insert into clinic_reception.marketing_requests(workspace_id,ad_id,reference,lines,created_by) values(p_workspace,trim(p_payload->>'ad_id'),p_payload->>'reference',p_payload->'lines',me) returning id into v;
 elsif p_action='marketing_review' then
  select * into r from clinic_reception.marketing_requests where id=(p_payload->>'id')::uuid and workspace_id=p_workspace for update;approve:=(p_payload->>'approve')::boolean;
  if not found or r.created_by=me or r.status<>'pending' or approve is null or length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'الإنفاق يحتاج مراجعة شخص آخر ومرجع القرار';end if;
  if approve then for x in select * from jsonb_array_elements(r.lines) loop
   if exists(select 1 from clinic_reception.marketing_daily d join clinic_reception.marketing_requests newer on newer.id=d.request_id where d.workspace_id=p_workspace and d.ad_id=r.ad_id and d.day=(x->>'day')::date and d.is_current and newer.request_no>r.request_no) then raise exception 'تقرير أحدث معتمد لنفس اليوم؛ راجع النسخة قبل الاعتماد';end if;
   update clinic_reception.marketing_daily set is_current=false where workspace_id=p_workspace and ad_id=r.ad_id and day=(x->>'day')::date and is_current;
   insert into clinic_reception.marketing_daily(workspace_id,ad_id,day,amount,request_id) values(p_workspace,r.ad_id,(x->>'day')::date,(x->>'amount')::numeric,r.id);
  end loop;end if;
  update clinic_reception.marketing_requests set status=case when approve then 'approved' else 'rejected' end,reviewed_by=me,review_note=p_payload->>'note' where id=r.id;v:=r.id;
 else raise exception 'إجراء غير معروف';end if;
 outcome:=jsonb_build_object('id',v);insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id) values(p_workspace,me,p_action,v);insert into clinic_reception.commands values(p_workspace,me,p_token,p_action,p_payload,outcome);return outcome;
end $$;
create or replace function public.clinic_reception_marketing(p_workspace uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare me uuid:=clinic_reception.access(p_workspace,'reports');v jsonb;begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then raise exception 'اختر فترة حتى سنة';end if;
 with money as(select coalesce(nullif(at.ad_id,''),'unknown') ad_id,coalesce(at.evidence,a.source_evidence,'unknown') evidence,
 sum(case when l.account in ('4110','4116','4190','4191','4192') then l.credit-l.debit else 0 end) revenue,
 sum(case when l.account in ('5111','5121','5123') then l.debit-l.credit else 0 end) direct_cost
 from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id left join clinic_reception.invoices i on i.id=nullif(j.dimensions->>'invoice_id','')::uuid join clinic_reception.orders o on o.id=coalesce(nullif(j.dimensions->>'order_id','')::uuid,i.order_id) join clinic_reception.visits v on v.id=o.visit_id join clinic_reception.appointments a on a.id=v.appointment_id left join clinic_reception.attributions at on at.appointment_id=a.id where j.workspace_id=p_workspace and (j.created_at at time zone 'Africa/Cairo')::date between p_from and p_to group by coalesce(nullif(at.ad_id,''),'unknown'),coalesce(at.evidence,a.source_evidence,'unknown')),
 revenue as(select ad_id,sum(revenue) revenue,sum(direct_cost) direct_cost,bool_and(evidence='tracked') verified from money group by ad_id),
 spend as(select ad_id,sum(amount) amount,count(distinct day) days from clinic_reception.marketing_daily where workspace_id=p_workspace and is_current and day between p_from and p_to group by ad_id),
 joined as(select coalesce(r.ad_id,s.ad_id) ad_id,coalesce(r.revenue,0) revenue,coalesce(r.direct_cost,0) direct_cost,s.amount spend,s.days days,s.days=p_to-p_from+1 period_complete,coalesce(r.verified,false) verified from revenue r full join spend s on s.ad_id=r.ad_id)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('associated_revenue_multiple',case when period_complete and spend>0 and ad_id<>'unknown' then round(revenue/spend,4) end,'contribution_after_marketing',case when period_complete then revenue-direct_cost-spend end)) from joined x),'[]'),
 'note','الإنفاق اليومي المعتمد يطابق نفس الفترة؛ القيم المفقودة مجهولة وليست صفرًا. الإيراد مرتبط بمعرف الإعلان ودرجة دليل الإسناد، وليس إثباتًا لتأثير سببي أو صافي ربح المركز. التكلفة هنا مستلزمات وأتعاب مباشرة فقط، والإنفاق التحليلي لا يكرر تسجيل مصروف محاسبي.',
 'requests',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.marketing_requests x where workspace_id=p_workspace and (created_by=me or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and capabilities && array['manage','review']) or exists(select 1 from clinic_reception.workspaces where id=p_workspace and owner_id=me)))) into v;return v;
end $$;
create or replace function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare me uuid;prev clinic_reception.commands%rowtype;v clinic_reception.visits%rowtype;outcome jsonb;begin
 if p_action in ('marketing_spend','marketing_review') then return clinic_reception.marketing_command(p_workspace,p_action,p_payload,p_token);end if;
 if p_action<>'visit_close' then
  if p_action in ('book','reschedule') and coalesce(p_payload->>'source_evidence','unknown')='tracked' then raise exception 'التتبع المؤكد لا يدخل يدويًا؛ ثبت المصدر من دليله';end if;
  return clinic_reception.bridge_command(p_workspace,p_action,p_payload,p_token);
 end if;
 me:=clinic_reception.access(p_workspace,'execute');if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'طلب غير صالح';end if;
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 select * into prev from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
 if found then if prev.action<>p_action or prev.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;return prev.response;end if;
 select * into v from clinic_reception.visits where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and status='open' for update;
 if not found or exists(select 1 from clinic_reception.orders where visit_id=v.id and status='ordered') then raise exception 'نفذ الخدمات أو ألغ غير المنفذ منها قبل إنهاء الزيارة';end if;
 if not exists(select 1 from clinic_reception.orders where visit_id=v.id and status='completed') and length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'سجل سبب إنهاء الزيارة دون تنفيذ خدمة';end if;
 update clinic_reception.visits set status='completed',closed_at=now(),close_note=nullif(trim(p_payload->>'reason'),'') where id=v.id;update clinic_reception.appointments set status='completed' where id=v.appointment_id;
 outcome:=jsonb_build_object('id',v.id);insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id) values(p_workspace,me,p_action,v.id);insert into clinic_reception.commands values(p_workspace,me,p_token,p_action,p_payload,outcome);return outcome;
end $$;
-- Detail records identify the original receipt method without pretending a package allocation is another cash receipt.
alter function public.clinic_reception_snapshot(uuid,date,date) set schema clinic_reception;
alter function clinic_reception.clinic_reception_snapshot(uuid,date,date) rename to bridge_snapshot;
create or replace function public.clinic_reception_snapshot(p_workspace uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb;begin
 v:=clinic_reception.bridge_snapshot(p_workspace,p_from,p_to);
 return v||jsonb_build_object('provider_balances',case when (v->>'can_manage')::boolean then(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'due',-clinic_reception.balance(p_workspace,'2120','provider_id',p.id::text)-clinic_reception.balance(p_workspace,'1194','provider_id',p.id::text))),'[]') from clinic_reception.providers p where p.workspace_id=p_workspace) else '[]'::jsonb end,'allocations',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'invoice_id',a.invoice_id,'source',a.source,'amount',a.amount,'payment_reference',p.reference,'method',p.method)),'[]') from clinic_reception.allocations a left join clinic_reception.payments p on p.id=a.payment_id where a.workspace_id=p_workspace));
end $$;
insert into clinic_finance.accounts(code,name,kind) values('1194','مبالغ مستحقة من الأطباء بعد تسويات الأتعاب','asset') on conflict do nothing;
create or replace function clinic_reception.service_value(p_invoice uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select o.net_revenue-coalesce((select sum(-m.quantity*m.sale_price) from clinic_reception.movements m where m.workspace_id=i.workspace_id and m.source_id=o.id and m.kind='sale'),0) from clinic_reception.invoices i join clinic_reception.orders o on o.id=i.order_id where i.id=p_invoice$$;
create or replace function clinic_reception.doctor_reduction(p_invoice uuid,p_fee numeric,p_amount numeric) returns numeric language plpgsql stable security definer set search_path=pg_catalog,public as $$declare prior numeric;base numeric;begin
 base:=clinic_reception.service_value(p_invoice);if base<=0 then return 0;end if;
 select coalesce(sum(r.amount),0) into prior from clinic_reception.requests r where status='approved' and (r.kind='credit_note' and r.subject_id=p_invoice and coalesce(r.payload->>'scope','service')='service' or r.kind='claim_contractual' and r.subject_id in(select id from clinic_reception.claims where invoice_id=p_invoice));
 return greatest(0,least(p_fee,round(p_fee*least(base,prior+p_amount)/base,2))-least(p_fee,round(p_fee*least(base,prior)/base,2)));
end $$;
do $$declare def text;patched text;begin
 def:=pg_get_functiondef('clinic_reception.review_operation(uuid,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$fee:=round(o.doctor_fee*v_amount/i.amount,2);$s$,$s$fee:=case when r.kind='credit_note' and coalesce(r.payload->>'scope','service')='materials' then 0 else clinic_reception.doctor_reduction(i.id,o.doctor_fee,v_amount) end;$s$);
 if def=patched then raise exception 'Missing physician reduction patch';end if;
 patched:=replace(patched,$s$patient:=i.patient_id;dims:=jsonb_build_object('patient_id',patient,'invoice_id',i.id,'request_id',r.id);due:=clinic_reception.due(i.id);$s$,$s$
  if coalesce(r.payload->>'scope','service') not in ('service','materials') then raise exception 'حدد تخفيض الخدمة أو المستلزمات';end if;
  if coalesce(r.payload->>'scope','service')='materials' then
   if v_amount+coalesce((select sum(amount) from clinic_reception.requests where kind='credit_note' and status='approved' and subject_id=i.id and payload->>'scope'='materials'),0)>i.amount-clinic_reception.service_value(i.id) then raise exception 'تخفيض المستلزمات يتجاوز قيمتها';end if;
  elsif v_amount+coalesce((select sum(amount) from clinic_reception.requests where kind='credit_note' and status='approved' and subject_id=i.id and coalesce(payload->>'scope','service')='service'),0)>clinic_reception.service_value(i.id)-coalesce((select amount from clinic_reception.claims where invoice_id=i.id),0) then raise exception 'تخفيض الخدمة يتجاوز حصة المريض من الخدمة';end if;
  patient:=i.patient_id;dims:=jsonb_build_object('patient_id',patient,'invoice_id',i.id,'request_id',r.id,'scope',coalesce(r.payload->>'scope','service'));due:=clinic_reception.due(i.id);$s$);
 execute patched;
 def:=pg_get_functiondef('clinic_reception.post(uuid,text,uuid,text,text,text,numeric,jsonb)'::regprocedure);patched:=replace(def,$s$if p_debit='2120' then$s$,$s$if p_debit='2120' and p_source='doctor_payout' then$s$);if def=patched then raise exception 'Missing payout-only cap patch';end if;execute patched;
end $$;
do $$declare def text;begin def:=pg_get_functiondef('clinic_reception.post(uuid,text,uuid,text,text,text,numeric,jsonb)'::regprocedure);execute replace(def,'FUNCTION clinic_reception.post(','FUNCTION clinic_reception.event_post(');end $$;
create or replace function clinic_reception.post(p_workspace uuid,p_source text,p_id uuid,p_description text,p_debit text,p_credit text,p_amount numeric,p_dimensions jsonb default '{}') returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare v uuid;liability numeric;debt numeric;adjustment numeric;begin
 if p_debit='2120' or p_credit='2120' then liability:=-clinic_reception.balance(p_workspace,'2120','provider_id',p_dimensions->>'provider_id');debt:=clinic_reception.balance(p_workspace,'1194','provider_id',p_dimensions->>'provider_id');end if;
 v:=clinic_reception.event_post(p_workspace,p_source,p_id,p_description,p_debit,p_credit,p_amount,p_dimensions);
 if p_debit='2120' and p_source in ('doctor_credit_note','doctor_contractual') then
  adjustment:=greatest(0,p_amount-greatest(liability,0));if adjustment>0 then perform clinic_reception.event_post(p_workspace,'doctor_receivable_'||p_source,p_id,'مبلغ مستحق من الطبيب بعد تسوية أتعاب سبق صرفها','1194','2120',adjustment,p_dimensions);end if;
 elsif p_credit='2120' and p_source='doctor_fee' then
  adjustment:=least(p_amount,greatest(debt,0));if adjustment>0 then perform clinic_reception.event_post(p_workspace,'doctor_receivable_offset',p_id,'تسوية المبلغ المدين من أتعاب جديدة مستحقة','2120','1194',adjustment,p_dimensions);end if;
 end if;return v;
end $$;
create or replace function clinic_finance.doctor_balance(p_key text) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select clinic_finance.legacy_doctor_balance(p_key)+coalesce((select sum(l.credit-l.debit) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id join clinic_reception.workspaces w on w.id=j.workspace_id join clinic_reception.providers p on p.id=nullif(j.dimensions->>'provider_id','')::uuid and p.workspace_id=w.id where w.mode='live' and p.doctor_key=p_key and l.account in ('2120','1194')),0)$$;
alter table clinic_reception.transfers add column keeper_by uuid references public.admins(id),add column manager_by uuid references public.admins(id),add column received_quantity numeric(14,3) not null default 0 check(received_quantity>=0 and received_quantity<=quantity),add column discrepancy_note text;
update clinic_reception.transfers t set received_quantity=coalesce((select sum(quantity) from clinic_reception.movements where workspace_id=t.workspace_id and source_id=t.id and kind='transfer_in'),0);
alter table clinic_reception.transfers drop constraint transfers_status_check;
alter table clinic_reception.transfers add constraint transfers_status_check check(status in ('pending','approved','rejected','dispatched','received','discrepancy','resolved'));
alter table clinic_reception.requests drop constraint requests_kind_check;
alter table clinic_reception.requests add constraint requests_kind_check check(kind in ('claim_correction','claim_submit','claim_contractual','claim_loss','claim_payment','credit_note','package_cancel','refund','doctor_payout','supplier_payout','expense','fund','waste','transfer_loss'));
do $$declare def text;patched text;begin
 def:=pg_get_functiondef('clinic_reception.controls_operation(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$OLD$  if p_action='transfer_review' then
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
$OLD$,$NEW$  if p_action='transfer_review' then
   approve:=(p_payload->>'approve')::boolean;
   if tr.created_by=p_me or tr.status not in ('pending','approved') or approve is null then raise exception 'التحويل يحتاج مراجعة مستقلة قبل الإرسال';end if;
   if not approve then update clinic_reception.transfers set status='rejected',reviewed_by=p_me where id=tr.id;
   elsif coalesce(p_payload->>'stage','manager')='warehouse' then
    perform clinic_reception.access(p_workspace,'warehouse');
    if tr.keeper_by is not null or tr.manager_by=p_me then raise exception 'اعتماد المخزن مستقل عن اعتماد الإدارة ولا يتكرر';end if;
    update clinic_reception.transfers set keeper_by=p_me,status=case when manager_by is not null then 'approved' else 'pending' end where id=tr.id;
   elsif p_payload->>'stage'='manager' or p_payload->>'stage' is null then
    perform clinic_reception.access(p_workspace,'review');
    if tr.manager_by is not null or tr.keeper_by=p_me then raise exception 'اعتماد الإدارة لشخص آخر غير معتمد المخزن';end if;
    update clinic_reception.transfers set manager_by=p_me,reviewed_by=p_me,status=case when keeper_by is not null then 'approved' else 'pending' end where id=tr.id;
   else raise exception 'حدد مرحلة الاعتماد';end if;
  elsif p_action='transfer_dispatch' then
   if tr.status<>'approved' or tr.keeper_by is null or tr.manager_by is null or tr.keeper_by=tr.manager_by then raise exception 'يلزم اعتمادا المخزن والإدارة من شخصين مختلفين';end if;
   perform clinic_reception.consume(p_workspace,tr.item_id,tr.source_id,tr.quantity,'transfer_out',tr.id);
   update clinic_reception.transfers set status='dispatched',dispatched_by=p_me where id=tr.id;
  else
   if tr.status not in ('dispatched','discrepancy') or tr.dispatched_by=p_me then raise exception 'الاستلام لشخص آخر بعد الإرسال الفعلي';end if;
   qty:=clinic_reception.number(p_payload->>'quantity',3,true);delta:=qty;
   if tr.received_quantity+qty>tr.quantity or tr.received_quantity+qty<tr.quantity and length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'راجع كمية الاستلام وسجل سبب الفرق';end if;
   for movement in select m.*,coalesce((select sum(quantity) from clinic_reception.movements where source_id=tr.id and lot_id=m.lot_id and kind='transfer_in'),0) already_received from clinic_reception.movements m where m.workspace_id=p_workspace and m.source_id=tr.id and m.kind='transfer_out' order by m.created_at,m.id loop
    value:=least(qty,-movement.quantity-movement.already_received);
    if value>0 then insert into clinic_reception.movements(workspace_id,item_id,location_id,lot_id,kind,quantity,unit_cost,source_id,actor_id) values(p_workspace,tr.item_id,tr.destination_id,movement.lot_id,'transfer_in',value,movement.unit_cost,tr.id,p_me);qty:=qty-value;end if;
   end loop;
   if qty<>0 then raise exception 'راجع تشغيلات الكمية المرسلة';end if;
   update clinic_reception.transfers set received_quantity=received_quantity+delta,status=case when received_quantity+delta=quantity then 'received' else 'discrepancy' end,received_by=p_me,discrepancy_note=case when received_quantity+delta<quantity then p_payload->>'reason' else discrepancy_note end where id=tr.id;
  end if;v:=tr.id;
$NEW$);
 if def=patched then raise exception 'Missing transfer controls patch';end if;execute patched;
 def:=pg_get_functiondef('clinic_reception.controls_command(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$case when p_action in ('entity','entity_contract','task') then 'manage'$s$,$s$case when p_action='transfer_review' and p_payload->>'stage'='warehouse' or p_action='request' and p_payload->>'kind' in ('waste','transfer_loss') then 'warehouse' when p_action in ('entity','entity_contract','task') then 'manage'$s$);
 if def=patched then raise exception 'Missing warehouse review capability patch';end if;execute patched;
end $$;
do $$declare def text;begin def:=pg_get_functiondef('clinic_reception.review_operation(uuid,jsonb,uuid)'::regprocedure);execute replace(def,'FUNCTION clinic_reception.review_operation(','FUNCTION clinic_reception.financial_review_operation(');end $$;
create or replace function clinic_reception.review_operation(p_workspace uuid,p_payload jsonb,p_me uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare r clinic_reception.requests%rowtype;tr clinic_reception.transfers%rowtype;cost numeric;approve boolean;begin
 select * into r from clinic_reception.requests where id=(p_payload->>'id')::uuid and workspace_id=p_workspace for update;
 if not found or r.kind<>'transfer_loss' then return clinic_reception.financial_review_operation(p_workspace,p_payload,p_me);end if;
 approve:=(p_payload->>'approve')::boolean;
 if r.status<>'pending' or r.created_by=p_me or approve is null or length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'فرق التحويل يحتاج مراجعًا آخر ومستند القرار';end if;
 if approve then
  select * into tr from clinic_reception.transfers where id=r.subject_id and workspace_id=p_workspace and status='discrepancy' for update;
  if not found or p_me in(tr.dispatched_by,tr.received_by) then raise exception 'المراجع مستقل عن طرفي التحويل';end if;
  select coalesce(sum(case when kind='transfer_out' then round(-quantity*unit_cost,2) when kind='transfer_in' then -round(quantity*unit_cost,2) else 0 end),0) into cost from clinic_reception.movements where source_id=tr.id and workspace_id=p_workspace;
  if r.amount<>cost then raise exception 'راجع التكلفة الفعلية للتشغيلات غير المستلمة';end if;
  perform clinic_reception.post(p_workspace,'transfer_loss',r.id,'تسوية فقد تحويل معتمد دون تحميل موظف تلقائيًا','5217','1131',cost,jsonb_build_object('transfer_id',tr.id,'item_id',tr.item_id));
  update clinic_reception.transfers set status='resolved' where id=tr.id;
 end if;
 update clinic_reception.requests set status=case when approve then 'approved' else 'rejected' end,reviewed_by=p_me,review_note=p_payload->>'note' where id=r.id;return jsonb_build_object('id',r.id);
end $$;
alter table clinic_reception.tasks add column submission_due_at timestamptz;
create unique index reception_external_task on clinic_reception.tasks(external_task_id) where external_task_id is not null;
create or replace function clinic_reception.sync_team_task() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if tg_op='DELETE' then if exists(select 1 from clinic_reception.tasks where external_task_id=old.id) then raise exception 'المهمة مرتبطة بمتابعة استقبال؛ احتفظ بسجلها واستخدم أرشفة المشروع';end if;return old;end if;
 update clinic_reception.tasks set status=case new.status when 'review' then 'submitted' when 'done' then 'accepted' when 'revision' then 'returned' else 'open' end,assigned_to=new.assignee_id,due_at=new.due_at,
 submitted_at=case when new.status='review' then coalesce(submitted_at,nullif(to_jsonb(new)->>'first_submitted_at','')::timestamptz,now()) else submitted_at end,
 submission_due_at=case when new.status='review' then coalesce(submission_due_at,nullif(to_jsonb(new)->>'first_submission_due_at','')::timestamptz,new.due_at) else submission_due_at end,
 reviewed_by=case when new.status in ('done','revision') then public.my_admin_id() else reviewed_by end
 where external_task_id=new.id;return new;
end $$;
create trigger reception_team_task_sync after update on public.tasks for each row execute function clinic_reception.sync_team_task();
create trigger reception_team_task_delete_guard before delete on public.tasks for each row execute function clinic_reception.sync_team_task();
do $$declare def text;patched text;begin
 def:=pg_get_functiondef('clinic_reception.controls_operation(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$ if p_action='entity' then$s$,$s$
 if p_action in ('task_submit','task_review') then
  select * into task from clinic_reception.tasks where workspace_id=p_workspace and id=(p_payload->>'id')::uuid;
  if found and task.external_task_id is not null then
   if p_action='task_submit' then perform public.task_set_status(task.external_task_id,'review',p_payload->>'result');else
    if task.assigned_to=p_me then raise exception 'المهمة تحتاج مراجعة مستقلة';end if;
    perform public.task_review(task.external_task_id,(p_payload->>'approve')::boolean,coalesce(p_payload->>'note','مراجعة متابعة استقبال'));
   end if;return jsonb_build_object('id',task.id);
  end if;
 end if;
 if p_action='entity' then$s$);
 if def=patched then raise exception 'Missing team synchronization patch';end if;
 patched:=replace(patched,$s$submitted_at=now() where id=task.id;$s$,$s$submitted_at=coalesce(submitted_at,now()),submission_due_at=coalesce(submission_due_at,due_at) where id=task.id;$s$);execute patched;
 def:=pg_get_functiondef('public.clinic_reception_report(uuid,date,date)'::regprocedure);patched:=replace(def,'submitted_at>due_at','submitted_at>coalesce(submission_due_at,due_at)');if def=patched then raise exception 'Missing submission deadline patch';end if;execute patched;
end $$;
create or replace function clinic_reception.check_money_reference(p_workspace uuid,p_method text,p_reference text,p_direction text,p_exclude uuid default null) returns void language plpgsql stable security definer set search_path=pg_catalog,public as $$declare family text:=case when p_method in ('bank','instapay') then 'bank' else p_method end;ref text:=trim(coalesce(p_reference,''));live boolean;begin
 if p_method is null or ref='' then return;end if;
 select mode='live' into live from clinic_reception.workspaces where id=p_workspace;
 if exists(with candidates as(
 select p.id,p.method,p.reference,'in' direction from clinic_reception.payments p where p.workspace_id=p_workspace
 union all select r.id,case when r.kind='refund' then original.method else r.payload->>'method' end,r.payload->>'reference',case when r.kind='claim_payment' then 'in' else 'out' end from clinic_reception.requests r left join clinic_reception.payments original on original.id=r.subject_id and r.kind='refund' where r.workspace_id=p_workspace and r.status='approved' and r.kind in ('refund','doctor_payout','supplier_payout','expense','fund','claim_payment')
 union all select p.id,p.method,p.reference,'in' from clinic_finance.payments p where live
 union all select a.id,a.method,a.reference,'in' from clinic_finance.advances a where live and a.status='received'
 union all select d.id,d.method,d.reference,'out' from clinic_finance.doctor_payouts d where live and d.status='approved'
 union all select s.id,s.method,s.reference,case when s.kind='supplier_refund' then 'in' else 'out' end from clinic_finance.supplier_actions s where live and s.status='approved' and s.kind in ('supplier_payment','supplier_refund')
 union all select a.id,coalesce(a.payload->>'method','bank'),a.reference,'in' from clinic_finance.insurance_actions a where live and a.status='approved' and a.kind='payment'
 ) select 1 from candidates c where c.id is distinct from p_exclude and trim(c.reference)=ref and (case when c.method in ('bank','instapay') then 'bank' else c.method end)=family and (family<>'cash' or c.direction=p_direction)) then raise exception 'مرجع العملية مستخدم بالفعل لنفس وسيلة السداد؛ راجع الحركة الأصلية';end if;
end $$;
do $$declare def text;patched text;begin
 def:=pg_get_functiondef('clinic_reception.payment_operation(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$insert into clinic_reception.payments(workspace_id,patient_id,package_id,method,shift_id,amount,reference,created_by)$s$,$s$perform clinic_reception.check_money_reference(p_workspace,method,p_payload->>'reference','in');insert into clinic_reception.payments(workspace_id,patient_id,package_id,method,shift_id,amount,reference,created_by)$s$);
 if def=patched then raise exception 'Missing receipt reference patch';end if;execute patched;
 def:=pg_get_functiondef('clinic_reception.financial_review_operation(uuid,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$v_amount:=r.amount;$s$,$s$v_amount:=r.amount;
 if r.kind in ('refund','doctor_payout','supplier_payout','expense','fund','claim_payment') then
  if r.kind='refund' then select original.method into method from clinic_reception.payments original where original.id=r.subject_id and original.workspace_id=p_workspace;else method:=r.payload->>'method';end if;
  perform clinic_reception.check_money_reference(p_workspace,method,r.payload->>'reference',case when r.kind='claim_payment' then 'in' else 'out' end,r.id);
 end if;$s$);
 if def=patched then raise exception 'Missing payout reference patch';end if;execute patched;
end $$;
do $$declare fn regprocedure;def text;patched text;begin
 foreach fn in array array['public.clinic_reception_message_claim(integer)'::regprocedure,'public.clinic_reception_message_validate(uuid,uuid)'::regprocedure] loop
  def:=pg_get_functiondef(fn);patched:=replace(def,$s$and o.version=a.starts_at::text||':'||a.status$s$,$s$and ((o.kind in ('confirmation','reminder','reschedule') and a.status='booked' and a.starts_at>now()) or (o.kind='cancellation' and a.status='cancelled')) and o.version=a.starts_at::text||':'||a.status$s$);
  if def=patched then raise exception 'Missing current booking message guard';end if;execute patched;
 end loop;
end $$;
create index reception_journal_day on clinic_reception.journal(workspace_id,((created_at at time zone 'Africa/Cairo')::date));
create index reception_provider_ledger on clinic_reception.journal(workspace_id,(dimensions->>'provider_id'));
create index reception_supplier_ledger on clinic_reception.journal(workspace_id,(dimensions->>'supplier_id'));
create index reception_lot_location on clinic_reception.movements(workspace_id,lot_id,location_id);
create index reception_marketing_day on clinic_reception.marketing_daily(workspace_id,day) where is_current;
create index reception_marketing_queue on clinic_reception.marketing_requests(workspace_id,status,created_at);
create or replace function clinic_reception.balance(p_workspace uuid,p_account text,p_dimension text default null,p_value text default null) returns numeric language plpgsql stable security definer set search_path=pg_catalog,public as $$declare n numeric;begin
 if p_dimension='patient_id' then select coalesce(sum(l.debit-l.credit),0) into n from clinic_reception.journal_lines l join clinic_reception.journal j on j.id=l.entry_id where j.workspace_id=p_workspace and l.account=p_account and j.dimensions->>'patient_id'=p_value;
 elsif p_dimension='provider_id' then select coalesce(sum(l.debit-l.credit),0) into n from clinic_reception.journal_lines l join clinic_reception.journal j on j.id=l.entry_id where j.workspace_id=p_workspace and l.account=p_account and j.dimensions->>'provider_id'=p_value;
 elsif p_dimension='supplier_id' then select coalesce(sum(l.debit-l.credit),0) into n from clinic_reception.journal_lines l join clinic_reception.journal j on j.id=l.entry_id where j.workspace_id=p_workspace and l.account=p_account and j.dimensions->>'supplier_id'=p_value;
 else select coalesce(sum(l.debit-l.credit),0) into n from clinic_reception.journal_lines l join clinic_reception.journal j on j.id=l.entry_id where j.workspace_id=p_workspace and l.account=p_account and (p_dimension is null or j.dimensions->>p_dimension=p_value);end if;return n;
end $$;
create or replace function clinic_reception.today() returns date language sql stable set search_path=pg_catalog as $$select (now() at time zone 'Africa/Cairo')::date$$;
do $$declare r record;def text;patched text;begin
 for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_reception' or n.nspname='public' and p.proname like 'clinic_reception_%' loop
  def:=pg_get_functiondef(r.sig);patched:=regexp_replace(def,'\mcurrent_date\M','clinic_reception.today()','g');if def<>patched then execute patched;end if;
 end loop;
end $$;
do $$declare r record;begin for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_reception' loop execute format('revoke all on function %s from public,anon,authenticated',r.sig);end loop;end $$;
revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid),public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
revoke all on function public.clinic_reception_marketing(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_marketing(uuid,date,date) to authenticated;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid),public.clinic_reception_snapshot(uuid,date,date) to authenticated;
commit;
