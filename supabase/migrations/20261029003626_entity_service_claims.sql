-- One performed service per invoice. All monetary and inventory writes are atomic.
begin;
create table if not exists clinic_finance.entity_billing_terms(
 contract_id uuid primary key references public.contracting_entity_contracts(id),
 medicine_payer text not null default 'unset' check(medicine_payer in ('unset','patient','entity','plan')),
 supply_payer text not null default 'unset' check(supply_payer in ('unset','patient','entity','plan')),
 settlement_days integer not null default 30 check(settlement_days between 0 and 365),
 requirements text not null default '',invoice_note text not null default '',
 revision integer not null default 1,updated_by uuid not null references public.admins(id),updated_at timestamptz not null default now());
create table if not exists clinic_finance.entity_service_invoices(
 invoice_id uuid primary key references clinic_finance.invoices(id),
 visit_id uuid not null references public.patient_visits(id),service_id uuid not null references public.pricing_services(id),
 contract_id uuid not null references public.contracting_entity_contracts(id),entity_id uuid not null references public.contracting_entities(id),
 service_date date not null,snapshot jsonb not null,request_payload jsonb not null,
 created_by uuid not null references public.admins(id),token uuid not null,created_at timestamptz not null default now(),
 unique(created_by,token));
create index if not exists entity_service_invoice_period on clinic_finance.entity_service_invoices(entity_id,service_date);
create index if not exists entity_service_invoice_visit on clinic_finance.entity_service_invoices(visit_id,service_id);
create table if not exists clinic_finance.entity_claim_batches(
 id uuid primary key default gen_random_uuid(),entity_id uuid not null references public.contracting_entities(id),
 reference text not null unique,period_from date not null,period_to date not null,
 status text not null default 'draft' check(status in ('draft','review','approved','submitted','returned','cancelled')),
 revision integer not null default 1,note text not null default '',attachments jsonb not null default '[]',
 created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),request_payload jsonb not null,
 submitted_at timestamptz,due_date date,created_at timestamptz not null default now(),token uuid not null,
 unique(created_by,token),check(period_to>=period_from));
create table if not exists clinic_finance.entity_claim_batch_lines(
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references clinic_finance.entity_claim_batches(id),
 claim_id uuid not null references clinic_finance.insurance_claims(id),invoice_id uuid not null references clinic_finance.invoices(id),
 snapshot jsonb not null,released boolean not null default false,unique(batch_id,claim_id));
create unique index if not exists entity_claim_single_batch on clinic_finance.entity_claim_batch_lines(claim_id) where not released;
create index if not exists entity_claim_batch_lookup on clinic_finance.entity_claim_batch_lines(batch_id);
create index if not exists entity_terms_actor on clinic_finance.entity_billing_terms(updated_by);
create index if not exists entity_invoice_service on clinic_finance.entity_service_invoices(service_id);
create index if not exists entity_invoice_contract on clinic_finance.entity_service_invoices(contract_id);
create index if not exists entity_batch_period on clinic_finance.entity_claim_batches(entity_id,period_from,period_to);
create index if not exists entity_batch_reviewer on clinic_finance.entity_claim_batches(reviewed_by);
create index if not exists entity_batch_claim on clinic_finance.entity_claim_batch_lines(claim_id);
create index if not exists entity_batch_invoice on clinic_finance.entity_claim_batch_lines(invoice_id);
alter table clinic_finance.insurance_claim_receipts add column if not exists released_allowance numeric(14,2) not null default 0;
do $$declare t text;begin foreach t in array array['entity_billing_terms','entity_service_invoices','entity_claim_batches','entity_claim_batch_lines'] loop
 execute format('alter table clinic_finance.%I enable row level security',t);
 execute format('revoke all on clinic_finance.%I from public,anon,authenticated',t);
end loop;end $$;

create or replace function public.entity_billing_terms_save(p_contract uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();t clinic_finance.entity_billing_terms%rowtype;previous jsonb;begin
 if me is null or not(public.can_manage_contracting_entities() or clinic_finance.allowed('review')) then raise exception 'تعديل شروط التعاقد يحتاج مسؤول تعاقدات أو مديرًا ماليًا';end if;
 perform 1 from public.contracting_entity_contracts where id=p_contract for update;if not found then raise exception 'العقد غير موجود';end if;
 select * into t from clinic_finance.entity_billing_terms where contract_id=p_contract;previous:=to_jsonb(t);
 if coalesce(t.revision,0)<>coalesce((p_payload->>'revision')::int,0) then raise exception 'الشروط تغيرت؛ حدّث البيانات';end if;
 if coalesce(length(p_payload->>'requirements'),0)>5000 or coalesce(length(p_payload->>'invoice_note'),0)>2000 then raise exception 'النص أطول من الحد المسموح';end if;
 insert into clinic_finance.entity_billing_terms(contract_id,medicine_payer,supply_payer,settlement_days,requirements,invoice_note,updated_by)
 values(p_contract,p_payload->>'medicine_payer',p_payload->>'supply_payer',(p_payload->>'settlement_days')::int,coalesce(p_payload->>'requirements',''),coalesce(p_payload->>'invoice_note',''),me)
 on conflict(contract_id) do update set medicine_payer=excluded.medicine_payer,supply_payer=excluded.supply_payer,settlement_days=excluded.settlement_days,requirements=excluded.requirements,invoice_note=excluded.invoice_note,revision=clinic_finance.entity_billing_terms.revision+1,updated_by=me,updated_at=now() returning * into t;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'entity_billing_terms',p_contract,jsonb_build_object('before',previous-'updated_by','after',p_payload));
 return to_jsonb(t);
end $$;

create or replace function clinic_finance.entity_service_quote(p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v public.patient_visits%rowtype;p public.patients%rowtype;c public.contracting_entity_contracts%rowtype;
 e public.contracting_entities%rowtype;s public.pricing_services%rowtype;sp public.pricing_supplies%rowtype;
 pl public.insurance_plans%rowtype;r public.insurance_plan_service_rules%rowtype;t clinic_finance.entity_billing_terms%rowtype;
 item public.inventory_items%rowtype;line jsonb;lines jsonb:='[]';center jsonb;quote jsonb;base numeric;gross numeric;net numeric;
 cp_type text:='none';cp_value numeric:=0;copay numeric:=0;entity_net numeric:=0;total numeric;patient_total numeric;entity_total numeric;
 qty numeric;amount numeric;share numeric;payer text;kind text;included boolean;line_id uuid;link public.contract_patient_links%rowtype;
begin
 perform clinic_finance.require_access('view');
 select * into v from public.patient_visits where id=(p_payload->>'visit_id')::uuid;
 if not found or v.contract_id is null then raise exception 'اختر زيارة مرتبطة بجهة تعاقد';end if;
 if v.visit_date is null or v.visit_date>(now() at time zone 'Africa/Cairo')::date then raise exception 'الفوترة للخدمات المنفذة حتى اليوم فقط';end if;
 select * into p from public.patients where id=v.patient_id;
 select * into c from public.contracting_entity_contracts where id=v.contract_id and status='active' and v.visit_date between start_date and coalesce(end_date,'9999-12-31');
 if not found then raise exception 'العقد غير ساري في تاريخ الخدمة';end if;
 select * into e from public.contracting_entities where id=c.entity_id;
 select * into s from public.pricing_services where id=(p_payload->>'service_id')::uuid and active;
 if not found or not coalesce(s.id=any(c.booking_service_ids),false) then raise exception 'الخدمة غير مشمولة بالعقد';end if;
 select * into t from clinic_finance.entity_billing_terms where contract_id=c.id;
 select * into link from public.contract_patient_links where patient_id=p.id and contract_id=c.id;
 base:=s.base_price;
 for line in select value from jsonb_array_elements(coalesce(s.supplies_used,'[]')) loop
  select * into sp from public.pricing_supplies where id=(line->>'supply_id')::uuid and active;
  if not found or sp.units_per_package<=0 then raise exception 'أكمل مستلزمات تسعير الخدمة';end if;
  base:=base+(line->>'quantity')::numeric*sp.package_price/sp.units_per_package;
 end loop;
 base:=round(base*(1+s.profit_margin_percent/100),2);center:=clinic_prices.resolve(s.id,base,v.visit_date);
 if v.insurance_plan_id is not null then
  select * into pl from public.insurance_plans where id=v.insurance_plan_id and contract_id=c.id and active and v.visit_date between valid_from and coalesce(valid_to,'9999-12-31');
  if not found then raise exception 'فئة الكارنيه غير سارية في تاريخ الخدمة';end if;
 end if;
 if pl.price_list_id is not null then
  if not exists(select 1 from clinic_prices.lists where id=pl.price_list_id and contract_id=c.id) then raise exception 'لائحة الفئة لا تخص العقد';end if;
  quote:=clinic_prices.resolve_explicit_list(s.id,(center->>'price')::numeric,v.visit_date,pl.price_list_id);
 else quote:=clinic_prices.resolve(s.id,(center->>'price')::numeric,v.visit_date,c.id);end if;
 net:=(quote->>'price')::numeric;gross:=greatest((center->>'price')::numeric,net);
 if net is null or net<=0 or net::text in ('NaN','Infinity','-Infinity') then raise exception 'سعر الخدمة غير صالح';end if;
 if c.booking_billing_kind='insurer' or e.category='insurance' then
  if pl.id is null then raise exception 'اختر فئة الكارنيه للزيارة قبل فوترة التأمين';end if;
  select * into r from public.insurance_plan_service_rules where plan_id=pl.id and service_id=s.id;
  if found and r.copay_type<>'inherit' then cp_type:=r.copay_type;cp_value:=r.copay_value;else cp_type:=pl.copay_type;cp_value:=pl.copay_value;end if;
  copay:=case cp_type when 'percentage' then round(net*cp_value/100,2) when 'fixed' then least(net,cp_value) else 0 end;
 else copay:=net;cp_type:='percentage';cp_value:=100;end if;
 entity_net:=net-copay;total:=net;patient_total:=copay;entity_total:=entity_net;
 lines:=jsonb_build_array(jsonb_build_object('kind','service','name',s.name,'category',s.category,'quantity',1,'unit','خدمة','gross',gross,'discount',gross-net,'net',net,'copay_type',cp_type,'copay_value',cp_value,'patient',copay,'entity',entity_net));
 if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items')>50 then raise exception 'راجع بنود الأدوية والمستلزمات';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'items') x group by x->>'item_id',x->>'location_id' having count(*)>1) then raise exception 'اجمع كميات نفس الصنف والمخزن في بند واحد';end if;
 for line in select value from jsonb_array_elements(p_payload->'items') order by value->>'item_id',value->>'location_id' loop
  qty:=(line->>'quantity')::numeric;included:=false;kind:=line->>'kind';
  if coalesce((line->>'included')::boolean,false) then raise exception 'لا يجوز تسجيل دواء أو مستلزم بغير سعر البيع؛ كل بند يسجل بسعره دون خصم';end if;
  if qty is null or qty<=0 or qty<>round(qty,3) or qty::text in ('NaN','Infinity','-Infinity') or kind not in ('medicine','supply') or kind is null then raise exception 'راجع نوع وكمية الصنف';end if;
  if not(public.inventory_location_can((line->>'location_id')::uuid,'receive') or public.inventory_location_can((line->>'location_id')::uuid,'manage')) then raise exception 'لا تملك الصرف من هذا المخزن';end if;
  select * into item from public.inventory_items where id=(line->>'item_id')::uuid and active;
  if not found or item.current_sale_price<=0 or item.current_sale_price is distinct from (line->>'sale_price')::numeric then raise exception 'سعر الصنف تغير؛ حدّث المعاينة';end if;
  if item.category ~* '(دواء|أدوي|ادوي|medicine|drug)' and kind<>'medicine' then raise exception 'نوع الصنف دواء بحسب دليل المخزون';end if;
  amount:=round(qty*item.current_sale_price,2);
  payer:=case kind when 'medicine' then t.medicine_payer else t.supply_payer end;
  if not included and coalesce(payer,'unset')='unset' then raise exception 'حدد في شروط العقد من يتحمل الأدوية والمستلزمات قبل إضافتها بسعر منفصل';end if;
  if payer='entity' then share:=0;
  elsif payer='plan' then
   if pl.id is null then raise exception 'تحمل الأصناف حسب الفئة يحتاج فئة كارنيه';end if;
   share:=case pl.copay_type when 'percentage' then round(amount*pl.copay_value/100,2) when 'fixed' then least(amount,pl.copay_value) else 0 end;
  else share:=amount;end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('kind',kind,'name',item.name,'item_id',item.id,'location_id',line->>'location_id','quantity',qty,'unit',item.base_unit,'sale_price',item.current_sale_price,'included',included,'gross',amount,'discount',0,'net',amount,'patient',share,'entity',amount-share,'payer',payer));
  total:=total+amount;patient_total:=patient_total+share;entity_total:=entity_total+amount-share;
 end loop;
 return jsonb_build_object('visit_id',v.id,'visit_number',v.visit_number,'patient_id',p.id,'patient_name',p.full_name,'medical_record_no',coalesce(p.medical_record_no,p.patient_code),'member_reference',coalesce(nullif(p_payload->>'member_reference',''),link.member_reference),'doctor_name',v.doctor_name,'specialty',v.specialty,'service_id',s.id,'service_name',s.name,'service_category',s.category,'service_date',v.visit_date,'contract_id',c.id,'entity_id',e.id,'entity_name',e.name,'contract_number',c.contract_number,'plan_name',pl.name,'plan_id',pl.id,'price_terms',quote,'billing_terms_revision',coalesce(t.revision,0),'invoice_note',t.invoice_note,'requirements',t.requirements,'settlement_days',coalesce(t.settlement_days,30),'account_code',coalesce(e.receivable_account_code,'1121'),'currency','EGP','lines',lines,'total',total,'patient_total',patient_total,'entity_total',entity_total,'service_net',net);
end $$;
revoke all on function clinic_finance.entity_service_quote(jsonb) from public,anon,authenticated;
create or replace function public.entity_service_quote(p_payload jsonb) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$select clinic_finance.entity_service_quote(p_payload)$$;

create or replace function public.entity_service_bill(p_payload jsonb,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');old clinic_finance.entity_service_invoices%rowtype;q jsonb;line jsonb;items jsonb:='[]';
 inv uuid;claim uuid;payment uuid;v_visit uuid:=(p_payload->>'visit_id')::uuid;v_service uuid:=(p_payload->>'service_id')::uuid;
 ref text:=trim(p_payload->>'reference');file_ref text;v_visit_ref text;v_payload jsonb;alloc record;cost numeric;stock_id uuid;
begin
 perform clinic_finance.lock_day();
 if p_token is null then raise exception 'مفتاح الطلب مطلوب';end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text||p_token::text,0));
 select * into old from clinic_finance.entity_service_invoices where created_by=me and token=p_token;
 if found then if old.request_payload is distinct from p_payload then raise exception 'مفتاح الطلب مستخدم لبيانات مختلفة';end if;return old.snapshot||jsonb_build_object('invoice_id',old.invoice_id,'replayed',true);end if;
 if ref is null or length(ref) not between 2 and 120 then raise exception 'أدخل مرجع فاتورة من حرفين إلى 120 حرفًا';end if;
 perform 1 from public.patient_visits where id=v_visit for update;
 if exists(select 1 from clinic_finance.entity_service_invoices x join clinic_finance.invoices i on i.id=x.invoice_id where x.visit_id=v_visit and x.service_id=v_service and not i.voided) and length(trim(coalesce(p_payload->>'repeat_reason','')))<5 then raise exception 'سبق فوترة هذه الخدمة في الزيارة؛ راجع الفاتورة أو اكتب سبب تكرار التنفيذ';end if;
 -- Lock pricing and item rows before calculating, preventing price changes between preview and posting.
 lock table clinic_prices.lists,clinic_prices.items in share mode;
 perform 1 from public.pricing_services where id=v_service for share;
 perform 1 from public.contracting_entity_contracts where id=(select contract_id from public.patient_visits where id=v_visit) for share;
 perform 1 from clinic_finance.entity_billing_terms where contract_id=(select contract_id from public.patient_visits where id=v_visit) for share;
 perform 1 from public.inventory_items where id in(select (x->>'item_id')::uuid from jsonb_array_elements(p_payload->'items') x) order by id for update;
 q:=clinic_finance.entity_service_quote(p_payload);
 if p_payload->'expected_quote' is distinct from q then raise exception 'تغيرت الأسعار أو الشروط؛ أعد المعاينة قبل الحفظ';end if;
 file_ref:=q->>'medical_record_no';v_visit_ref:=coalesce(nullif(q->>'visit_number',''),v_visit::text);
 if coalesce(file_ref,'')='' then raise exception 'أكمل الرقم الطبي للمريض';end if;
 if (q->>'entity_total')::numeric>0 and length(trim(coalesce(q->>'member_reference','')))=0 then raise exception 'أدخل رقم البطاقة أو العضوية للمطالبة';end if;
 for line in select value from jsonb_array_elements(q->'lines') where value->>'kind'<>'service' and not(value->>'included')::boolean loop
  items:=items||jsonb_build_array(jsonb_build_object('item_id',line->>'item_id','location_id',line->>'location_id','quantity',(line->>'quantity')::numeric,'sale_price',(line->>'sale_price')::numeric));
 end loop;
 v_payload:=jsonb_build_object('reference',ref,'patient_ref',file_ref,'description',(q->>'service_name')||' — '||(q->>'entity_name'),'service_amount',(q->>'service_net')::numeric,'items',items);
 inv:=public.clinic_finance_bill(v_payload,p_token);
 if (q->>'entity_total')::numeric>0 then
  insert into clinic_finance.insurance_claims(invoice_id,reference,insurer,amount,created_by,token,contract_id,insurance_plan_id,service_id,center_price,contracted_price,contractual_discount,patient_copay,receivable_account_code)
  values(inv,ref,q->>'entity_name',(q->>'entity_total')::numeric,me,p_token,(q->>'contract_id')::uuid,(q->>'plan_id')::uuid,v_service,(q->'lines'->0->>'gross')::numeric,(q->>'total')::numeric,(q->'lines'->0->>'discount')::numeric,(q->>'patient_total')::numeric,q->>'account_code') returning id into claim;
  perform clinic_finance.post('insurance_claim',claim,'مستحق جهة عن فاتورة '||ref,null,q->>'account_code','1122',(q->>'entity_total')::numeric);
 end if;
 update clinic_finance.invoices set visit_ref=v_visit_ref,bill_payload=coalesce(bill_payload,'{}')||jsonb_build_object('entity_service',q,'visit_id',v_visit,'patient_id',q->>'patient_id','service_id',v_service,'claim_id',claim) where id=inv;
 if (q->>'patient_total')::numeric>0 then
  payment:=public.clinic_finance_collect_linked(inv,nullif(p_payload->>'shift_id','')::uuid,p_payload->>'payment_method',(q->>'patient_total')::numeric,p_payload->>'payment_reference',p_token,file_ref,v_visit_ref);
 end if;
 q:=q||jsonb_build_object('reference',ref,'claim_id',claim,'payment_id',payment,'invoice_id',inv);
 insert into clinic_finance.entity_service_invoices(invoice_id,visit_id,service_id,contract_id,entity_id,service_date,snapshot,request_payload,created_by,token)
 values(inv,v_visit,v_service,(q->>'contract_id')::uuid,(q->>'entity_id')::uuid,(q->>'service_date')::date,q,p_payload,me,p_token);
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'entity_service_billed',inv,jsonb_build_object('claim_id',claim,'service_id',v_service));
 return q;
end $$;

-- Both collection paths share the same outstanding balance, including approved adjustments.
create or replace function clinic_finance.claim_due(p_id uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$
 select c.amount-coalesce((select sum(amount) from clinic_finance.insurance_actions where claim_id=c.id and status='approved' and kind in ('contractual','payment')),0)-coalesce((select sum(amount) from clinic_finance.insurance_claim_receipts where claim_id=c.id),0) from clinic_finance.insurance_claims c where c.id=p_id;
$$;
create or replace function clinic_finance.claim_allowance(p_id uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select sum(case when kind='credit_loss' then amount else -released_allowance end) from clinic_finance.insurance_actions where claim_id=p_id and status='approved'),0)-coalesce((select sum(released_allowance) from clinic_finance.insurance_claim_receipts where claim_id=p_id),0);
$$;

create or replace function public.entity_claim_collect(p_claim uuid,p_amount numeric,p_method text,p_reference text,p_shift uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');c clinic_finance.insurance_claims%rowtype;r clinic_finance.insurance_claim_receipts%rowtype;remaining numeric;acct text;released numeric;begin
 perform clinic_finance.lock_day();
 if p_token is null then raise exception 'مفتاح الطلب مطلوب';end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text||p_token::text,0));
 select * into r from clinic_finance.insurance_claim_receipts where created_by=me and token=p_token;
 if found then if (r.claim_id,r.amount,r.method,r.reference,r.shift_id) is distinct from (p_claim,p_amount,p_method,trim(p_reference),p_shift) then raise exception 'مفتاح الطلب مستخدم لتحصيل مختلف';end if;return to_jsonb(r);end if;
 select * into c from clinic_finance.insurance_claims where id=p_claim for update;
 if not found or c.status='cancelled' or (c.created_by<>me and not clinic_finance.allowed('review')) then raise exception 'المطالبة غير متاحة';end if;
 remaining:=clinic_finance.claim_due(c.id);
 if exists(select 1 from clinic_finance.insurance_claim_receipts where claim_id=c.id and reference=trim(p_reference)) then raise exception 'سبق تسجيل نفس مرجع التحصيل لهذه المطالبة';end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount>remaining then raise exception 'التحصيل يتجاوز المتبقي أو المبلغ غير صالح';end if;
 if p_method is null or p_method not in ('cash','pos','bank','wallet','instapay') or length(trim(coalesce(p_reference,'')))<2 then raise exception 'راجع طريقة ومرجع التحصيل';end if;
 if p_method in ('cash','pos') then perform clinic_finance.check_shift(p_shift);elsif p_shift is not null then raise exception 'الوردية مخصصة للكاش أو POS';end if;
 acct:=case p_method when 'cash' then '1111' when 'pos' then '1114' when 'wallet' then '1115' else '1112' end;
 insert into clinic_finance.insurance_claim_receipts(claim_id,amount,method,shift_id,reference,created_by,token) values(c.id,p_amount,p_method,p_shift,trim(p_reference),me,p_token) returning * into r;
 perform clinic_finance.post('insurance_collection',r.id,'تحصيل مطالبة '||trim(p_reference),p_shift,acct,coalesce(c.receivable_account_code,'1121'),p_amount);
 released:=least(clinic_finance.claim_allowance(c.id),p_amount);if released>0 then perform clinic_finance.post('insurance_allowance_release',r.id,'رد مخصص بعد التحصيل',null,'1292','5230',released);update clinic_finance.insurance_claim_receipts set released_allowance=released where id=r.id;end if;
 update clinic_finance.insurance_claims set collected_amount=collected_amount+p_amount,status=case when remaining=p_amount then 'collected' else 'partially_collected' end,updated_at=now() where id=c.id;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'entity_claim_collected',c.id,jsonb_build_object('receipt_id',r.id,'amount',p_amount));
 return jsonb_build_object('receipt_id',r.id,'remaining',remaining-p_amount,'claim_id',c.id);
end $$;

-- Keep the previous collection entry point on the same guarded balance calculation.
create or replace function public.clinic_finance_insurance_collect(p_claim uuid,p_amount numeric,p_method text,p_reference text,p_shift uuid,p_token uuid) returns jsonb
language sql security definer set search_path=pg_catalog,public as $$select public.entity_claim_collect(p_claim,p_amount,p_method,p_reference,p_shift,p_token)$$;

create or replace function public.entity_claim_adjust(p_action text,p_payload jsonb,p_token uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();r clinic_finance.insurance_actions%rowtype;c clinic_finance.insurance_claims%rowtype;due numeric;allowance numeric;released numeric:=0;approve boolean;
begin
 if p_action='request' then
  if p_payload->>'kind' is null or p_payload->>'kind' not in ('correction','resubmit','contractual','credit_loss') then raise exception 'اختر نوع معالجة المطالبة';end if;
  return public.clinic_finance_insurance_action(p_payload||jsonb_build_object('_entity_claims_v1',true),p_token);
 end if;
 perform clinic_finance.require_access('review');perform clinic_finance.lock_day();
 select * into r from clinic_finance.insurance_actions where id=(p_payload->>'id')::uuid for update;
 if not found or r.created_by=me or r.kind not in ('correction','resubmit','contractual','credit_loss') then raise exception 'الطلب غير متاح أو يحتاج مراجعًا آخر';end if;
 approve:=(p_payload->>'approve')::boolean;
 if approve is null or length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'سجل قرار المراجعة وسببه';end if;
 if r.status<>'pending' then if r.reviewed_by=me and r.status=(case when approve then 'approved' else 'rejected' end) then return r.id;end if;raise exception 'سبق مراجعة الطلب';end if;
 select * into c from clinic_finance.insurance_claims where id=r.claim_id for update;
 due:=clinic_finance.claim_due(c.id);allowance:=clinic_finance.claim_allowance(c.id);
 if approve then
  if r.amount>due or (r.kind='credit_loss' and r.amount>due-allowance) then raise exception 'المبلغ يتجاوز المستحق الحالي';end if;
  if r.kind='contractual' then perform clinic_finance.post('insurance_contractual',r.id,r.reason,null,'4153',coalesce(c.receivable_account_code,'1121'),r.amount);released:=greatest(0,allowance-(due-r.amount));
  elsif r.kind='credit_loss' then perform clinic_finance.post('insurance_credit_loss',r.id,r.reason,null,'5230','1292',r.amount);end if;
  if released>0 then perform clinic_finance.post('insurance_allowance_release',r.id,'رد مخصص بعد التسوية',null,'1292','5230',released);end if;
 end if;
 update clinic_finance.insurance_actions set status=case when approve then 'approved' else 'rejected' end,reviewed_by=me,reviewed_at=now(),review_note=p_payload->>'note',released_allowance=released where id=r.id;
 if to_regprocedure('clinic_finance.doctor_sync(uuid)') is not null then perform clinic_finance.doctor_sync(c.invoice_id);end if;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'entity_claim_adjustment_reviewed',r.id,jsonb_build_object('approved',approve,'note',p_payload->>'note'));
 return r.id;
end $$;

-- Reviews started in the new workspace remain correct when opened through the existing finance screen.
create or replace function public.clinic_finance_insurance_review(p_id uuid,p_approve boolean,p_note text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v uuid;i uuid;begin
 if exists(select 1 from clinic_finance.insurance_actions where id=p_id and payload->>'_entity_claims_v1'='true') then
  return public.entity_claim_adjust('review',jsonb_build_object('id',p_id,'approve',p_approve,'note',p_note),gen_random_uuid());
 end if;
 v:=clinic_finance.doctor_insurance_review_base(p_id,p_approve,p_note);
 select c.invoice_id into i from clinic_finance.insurance_actions a join clinic_finance.insurance_claims c on c.id=a.claim_id where a.id=v;
 perform clinic_finance.doctor_sync(i);return v;
end $$;

create or replace function public.entity_claim_batch_command(p_action text,p_payload jsonb,p_token uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');b clinic_finance.entity_claim_batches%rowtype;v uuid:=nullif(p_payload->>'id','')::uuid;
 ids uuid[];cid uuid;c clinic_finance.insurance_claims%rowtype;doc jsonb;att jsonb;begin
 if p_action='create' then
  perform pg_advisory_xact_lock(hashtextextended(me::text||p_token::text,0));
  select * into b from clinic_finance.entity_claim_batches where created_by=me and token=p_token;
  if found then if b.request_payload is distinct from p_payload then raise exception 'مفتاح الطلب مستخدم لمطالبة مختلفة';end if;return b.id;end if;
  if length(trim(coalesce(p_payload->>'reference',''))) not between 2 and 120 or p_token is null then raise exception 'مرجع المطالبة ومفتاح الطلب مطلوبان';end if;
  ids:=array(select jsonb_array_elements_text(p_payload->'claim_ids')::uuid);
  if (p_payload->>'to')::date-(p_payload->>'from')::date>366 then raise exception 'اختر فترة لا تتجاوز سنة';end if;
  if coalesce(array_length(ids,1),0) not between 1 and 5000 then raise exception 'اختر من فاتورة إلى 5000 فاتورة';end if;
  insert into clinic_finance.entity_claim_batches(entity_id,reference,period_from,period_to,created_by,token,note,request_payload)
  values((p_payload->>'entity_id')::uuid,trim(p_payload->>'reference'),(p_payload->>'from')::date,(p_payload->>'to')::date,me,p_token,coalesce(p_payload->>'note',''),p_payload) returning * into b;v:=b.id;
  for cid in select distinct unnest(ids) order by 1 loop
   select * into c from clinic_finance.insurance_claims where id=cid for update;
   if not found or c.status='cancelled' or (c.created_by<>me and not clinic_finance.allowed('review')) then raise exception 'فاتورة غير متاحة للمطالبة';end if;
   select x.snapshot into doc from clinic_finance.entity_service_invoices x join clinic_finance.invoices i on i.id=x.invoice_id where x.invoice_id=c.invoice_id and not i.voided and x.entity_id=b.entity_id and x.service_date between b.period_from and b.period_to;
   if doc is null then raise exception 'الفاتورة خارج الجهة أو الفترة أو ينقصها بيان الخدمة';end if;
   if clinic_finance.claim_due(c.id)<=0 then raise exception 'الفاتورة محصلة بالكامل';end if;
   if (select count(*) from clinic_finance.insurance_claims where invoice_id=c.invoice_id and status<>'cancelled')<>1 then raise exception 'راجع توزيع المطالبات على الفاتورة';end if;
   insert into clinic_finance.entity_claim_batch_lines(batch_id,claim_id,invoice_id,snapshot) values(v,c.id,c.invoice_id,doc||jsonb_build_object('claim_id',c.id,'claimed_amount',clinic_finance.claim_due(c.id)));
  end loop;
 else
  select * into b from clinic_finance.entity_claim_batches where id=v for update;
  if not found or (b.created_by<>me and not clinic_finance.allowed('review')) or b.revision<>coalesce((p_payload->>'revision')::int,0) then raise exception 'المطالبة تغيرت أو خارج صلاحيتك؛ حدّث البيانات';end if;
  if p_action='submit_review' and b.status in ('draft','returned') then update clinic_finance.entity_claim_batches set status='review',reviewed_by=null where id=v;
  elsif p_action='approve' and b.status='review' then
   perform clinic_finance.require_access('review');if me=b.created_by then raise exception 'اعتماد المطالبة يحتاج مراجعًا آخر';end if;
   if exists(select 1 from clinic_finance.entity_claim_batch_lines l join clinic_finance.invoices i on i.id=l.invoice_id join clinic_finance.insurance_claims ic on ic.id=l.claim_id where l.batch_id=v and (i.voided or ic.status='cancelled' or clinic_finance.claim_due(ic.id)<>(l.snapshot->>'claimed_amount')::numeric)) then raise exception 'تغير رصيد إحدى الفواتير؛ ألغِ المسودة وجهز كشفًا محدثًا';end if;
   update clinic_finance.entity_claim_batches set status='approved',reviewed_by=me where id=v;
  elsif p_action='sent' and b.status='approved' then update clinic_finance.entity_claim_batches set status='submitted',submitted_at=now(),due_date=(now() at time zone 'Africa/Cairo')::date+coalesce((select min((snapshot->>'settlement_days')::int) from clinic_finance.entity_claim_batch_lines where batch_id=v),30) where id=v;
  elsif p_action='return' and b.status in ('review','submitted','approved') then
   if b.status='review' then perform clinic_finance.require_access('review');end if;
   if length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'اكتب سبب الإرجاع';end if;
   update clinic_finance.entity_claim_batches set status='returned',reviewed_by=null where id=v;
  elsif p_action='cancel' and b.status in ('draft','review','returned','approved') then
   if me<>b.created_by and not clinic_finance.allowed('review') then raise exception 'الإلغاء لمنشئ المطالبة أو المراجع';end if;
   if length(trim(coalesce(p_payload->>'note','')))<3 then raise exception 'اكتب سبب الإلغاء';end if;
   update clinic_finance.entity_claim_batches set status='cancelled' where id=v;
   update clinic_finance.entity_claim_batch_lines set released=true where batch_id=v;
  elsif p_action='attachments' and b.status in ('draft','returned') then
   if jsonb_typeof(p_payload->'attachments') is distinct from 'array' or jsonb_array_length(p_payload->'attachments')>30 then raise exception 'راجع المرفقات';end if;
   for att in select value from jsonb_array_elements(p_payload->'attachments') loop
    if coalesce(att->>'url','') !~ '^https://(drive[.]google[.]com|docs[.]google[.]com)/' or length(coalesce(att->>'name','')) not between 1 and 250 then raise exception 'أرفق رابط Google Drive واسم المستند';end if;
   end loop;
   update clinic_finance.entity_claim_batches set attachments=p_payload->'attachments' where id=v;
  else raise exception 'الإجراء لا يطابق حالة المطالبة';end if;
  update clinic_finance.entity_claim_batches set revision=revision+1,note=case when p_payload ? 'note' then p_payload->>'note' else note end where id=v;
 end if;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'entity_batch_'||p_action,v,jsonb_build_object('note',p_payload->>'note'));
 return v;
end $$;

create or replace function public.entity_claims_workspace(p_entity uuid default null,p_from date default current_date-31,p_to date default current_date,p_term text default '') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();fin boolean:=clinic_finance.allowed('view');manage boolean:=public.can_manage_contracting_entities();totals jsonb;begin
 if me is null or not(fin or manage) then raise exception 'لا تملك عرض مطالبات الجهات';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'اختر فترة لا تتجاوز سنة';end if;
 if fin then
 select jsonb_build_object('count',count(*),'patient',coalesce(sum((x.snapshot->>'patient_total')::numeric) filter(where not i.voided),0),'remaining',coalesce(sum(case when i.voided or ic.id is null then 0 else clinic_finance.claim_due(ic.id) end),0)) into totals
 from clinic_finance.entity_service_invoices x join clinic_finance.invoices i on i.id=x.invoice_id left join clinic_finance.insurance_claims ic on ic.invoice_id=i.id and ic.status<>'cancelled'
 where (clinic_finance.allowed('review') or x.created_by=me) and (p_entity is null or x.entity_id=p_entity) and x.service_date between p_from and p_to and (coalesce(p_term,'')='' or concat(x.snapshot->>'patient_name',' ',i.reference,' ',x.snapshot->>'medical_record_no') ilike '%'||p_term||'%');
 end if;
 return jsonb_build_object('totals',totals,'can_view',fin,'can_create',clinic_finance.allowed('create'),'can_review',clinic_finance.allowed('review'),'can_terms',manage or clinic_finance.allowed('review'),'me',me,
 'entities',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'category',category) order by name),'[]') from public.contracting_entities),
 'contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'entity_id',c.entity_id,'contract_number',c.contract_number,'status',c.status,'billing_kind',c.booking_billing_kind,'terms',to_jsonb(t)) order by c.created_at desc),'[]') from public.contracting_entity_contracts c left join clinic_finance.entity_billing_terms t on t.contract_id=c.id where p_entity is null or c.entity_id=p_entity),
 'invoices',case when fin then(select coalesce(jsonb_agg(x order by s.service_date desc,s.reference),'[]') from(select jsonb_build_object('invoice_id',i.id,'reference',i.reference,'service_date',x.service_date,'snapshot',x.snapshot,'claim_id',c.id,'remaining',case when c.id is null then 0 else clinic_finance.claim_due(c.id) end,'batch_id',l.batch_id,'voided',i.voided) x,x.service_date,i.reference from clinic_finance.entity_service_invoices x join clinic_finance.invoices i on i.id=x.invoice_id left join clinic_finance.insurance_claims c on c.invoice_id=i.id and c.status<>'cancelled' left join clinic_finance.entity_claim_batch_lines l on l.claim_id=c.id and not l.released where (clinic_finance.allowed('review') or x.created_by=me) and (p_entity is null or x.entity_id=p_entity) and x.service_date between p_from and p_to and (coalesce(p_term,'')='' or concat(x.snapshot->>'patient_name',' ',i.reference,' ',x.snapshot->>'medical_record_no') ilike '%'||p_term||'%') order by x.service_date desc,i.reference limit 5001)s) else '[]'::jsonb end,
 'batches',case when fin then(select coalesce(jsonb_agg(x order by s.created_at desc),'[]') from(select to_jsonb(b)||jsonb_build_object('entity_name',e.name,'invoice_count',(select count(distinct invoice_id) from clinic_finance.entity_claim_batch_lines where batch_id=b.id),'amount',(select sum((snapshot->>'claimed_amount')::numeric) from clinic_finance.entity_claim_batch_lines where batch_id=b.id),'remaining',(select sum(clinic_finance.claim_due(claim_id)) from clinic_finance.entity_claim_batch_lines where batch_id=b.id)) x,b.created_at from clinic_finance.entity_claim_batches b join public.contracting_entities e on e.id=b.entity_id where (clinic_finance.allowed('review') or b.created_by=me) and (p_entity is null or b.entity_id=p_entity) and b.period_from<=p_to and b.period_to>=p_from order by b.created_at desc limit 500)s) else '[]'::jsonb end);
end $$;

create or replace function public.entity_claim_document(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare doc jsonb;begin
 perform clinic_finance.require_access('view');
 if p_kind='invoice' then select snapshot into doc from clinic_finance.entity_service_invoices where invoice_id=p_id and (created_by=public.my_admin_id() or clinic_finance.allowed('review'));
 elsif p_kind='batch' then
  select to_jsonb(b)||jsonb_build_object('entity_name',e.name,'lines',(select coalesce(jsonb_agg(l.snapshot||jsonb_build_object('current_remaining',clinic_finance.claim_due(l.claim_id)) order by l.snapshot->>'patient_name',l.snapshot->>'service_date',l.snapshot->>'reference'),'[]') from clinic_finance.entity_claim_batch_lines l where l.batch_id=b.id),'remaining',(select sum(clinic_finance.claim_due(claim_id)) from clinic_finance.entity_claim_batch_lines where batch_id=b.id),'adjustments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]') from clinic_finance.insurance_actions a join clinic_finance.entity_claim_batch_lines l on l.claim_id=a.claim_id where l.batch_id=b.id)) into doc from clinic_finance.entity_claim_batches b join public.contracting_entities e on e.id=b.entity_id where b.id=p_id and (b.created_by=public.my_admin_id() or clinic_finance.allowed('review'));
 else raise exception 'نوع مستند غير متاح';end if;
 if doc is null then raise exception 'المستند غير موجود';end if;
 return doc||jsonb_build_object('access',jsonb_build_object('can_create',clinic_finance.allowed('create'),'can_review',clinic_finance.allowed('review'),'me',public.my_admin_id()));
end $$;

create or replace function public.entity_billing_visits(p_term text default '',p_entity uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 perform clinic_finance.require_access('view');
 return(select coalesce(jsonb_agg(x order by s.visit_date desc),'[]') from(select jsonb_build_object('id',v.id,'visit_number',v.visit_number,'visit_date',v.visit_date,'patient_name',p.full_name,'medical_record_no',coalesce(p.medical_record_no,p.patient_code),'entity_name',e.name,'entity_id',e.id) x,v.visit_date from public.patient_visits v join public.patients p on p.id=v.patient_id join public.contracting_entity_contracts c on c.id=v.contract_id join public.contracting_entities e on e.id=c.entity_id where (p_entity is null or e.id=p_entity) and (coalesce(p_term,'')='' or concat(p.full_name,' ',p.medical_record_no,' ',p.patient_code,' ',v.visit_number) ilike '%'||p_term||'%') order by v.visit_date desc limit 50)s);
end $$;
create or replace function public.entity_billing_context(p_visit uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v public.patient_visits%rowtype;begin
 perform clinic_finance.require_access('view');select * into v from public.patient_visits where id=p_visit;
 if not found or v.contract_id is null then raise exception 'الزيارة غير مرتبطة بجهة';end if;
 return jsonb_build_object('visit',(select jsonb_build_object('id',v.id,'visit_number',v.visit_number,'visit_date',v.visit_date,'patient_name',p.full_name,'medical_record_no',coalesce(p.medical_record_no,p.patient_code),'doctor_name',v.doctor_name,'specialty',v.specialty,'entity_name',e.name,'member_reference',(select member_reference from public.contract_patient_links where patient_id=v.patient_id and contract_id=v.contract_id)) from public.patients p join public.contracting_entity_contracts c on c.id=v.contract_id join public.contracting_entities e on e.id=c.entity_id where p.id=v.patient_id),
 'services',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'category',s.category) order by s.category,s.name),'[]') from public.pricing_services s join public.contracting_entity_contracts c on c.id=v.contract_id where s.active and s.id=any(c.booking_service_ids)),
 'stock',(select coalesce(jsonb_agg(jsonb_build_object('item_id',i.id,'location_id',l.id,'name',i.name,'category',i.category,'unit',i.base_unit,'sale_price',i.current_sale_price,'location_name',l.name) order by l.name,i.name),'[]') from public.inventory_items i cross join public.inventory_locations l where i.active and l.active and i.current_sale_price>0 and (public.inventory_location_can(l.id,'receive') or public.inventory_location_can(l.id,'manage'))),
 'shifts',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',r.name)),'[]') from clinic_finance.shifts s join clinic_finance.registers r on r.id=s.register_id where s.cashier_id=public.my_admin_id() and s.status='open' and s.ended_at is null),
 'previous',(select coalesce(jsonb_agg(jsonb_build_object('invoice_id',x.invoice_id,'reference',i.reference,'service_id',x.service_id)),'[]') from clinic_finance.entity_service_invoices x join clinic_finance.invoices i on i.id=x.invoice_id where x.visit_id=v.id and not i.voided));
end $$;

do $$declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('entity_billing_terms_save','entity_service_quote','entity_service_bill','clinic_finance_insurance_collect','clinic_finance_insurance_review','entity_claim_collect','entity_claim_adjust','entity_claim_batch_command','entity_claims_workspace','entity_claim_document','entity_billing_visits','entity_billing_context') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to authenticated',f.sig);
end loop;end $$;
notify pgrst,'reload schema';
commit;
