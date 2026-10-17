begin;
insert into clinic_finance.accounts values('3210','أرباح مرحلة معتمدة','equity') on conflict do nothing;
create table clinic_finance.manual_batches(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('opening','correction','reversal')),reference text not null unique,note text not null,payload jsonb not null,created_by uuid not null references public.admins(id),token uuid not null,created_at timestamptz not null default now(),status text not null default 'pending' check(status in ('pending','approved','rejected')),entry_id uuid unique references clinic_finance.entries(id),reviewed_by uuid references public.admins(id),review_note text,unique(created_by,token));
create unique index finance_one_opening on clinic_finance.manual_batches(kind) where kind='opening' and status in ('pending','approved');
create unique index finance_one_reversal on clinic_finance.manual_batches((payload->>'entry_id')) where kind='reversal' and status in ('pending','approved');
create table clinic_finance.opening_details(id uuid primary key default gen_random_uuid(),batch_id uuid not null references clinic_finance.manual_batches(id),account text not null references clinic_finance.accounts(code),subject text not null,debit numeric(14,2) not null,credit numeric(14,2) not null,metadata jsonb not null);
create or replace function clinic_finance.doctor_balance(p_key text) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select coalesce((select sum(delta) from clinic_finance.doctor_accruals where doctor_key=p_key),0)-coalesce((select sum(gross) from clinic_finance.doctor_payouts where doctor_key=p_key and status='approved'),0)+coalesce((select sum(credit-debit) from clinic_finance.opening_details where account='2120' and subject=p_key),0)$$;
create or replace function clinic_finance.employee_advance(p_subject text) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select coalesce((select sum(case when kind='advance' then amount when kind='payroll' then -coalesce((payload->>'recovery')::numeric,0) else 0 end) from clinic_finance.business_requests where subject=p_subject and status='approved'),0)+coalesce((select sum(debit-credit) from clinic_finance.opening_details where account='1142' and subject=p_subject),0)$$;
create or replace function clinic_finance.employee_due(p_subject text) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select coalesce((select sum(case when kind='payroll' then amount-coalesce((payload->>'tax')::numeric,0)-coalesce((payload->>'insurance')::numeric,0)-coalesce((payload->>'recovery')::numeric,0) when kind='salary_payment' then -amount else 0 end) from clinic_finance.business_requests where subject=p_subject and status='approved'),0)+coalesce((select sum(credit-debit) from clinic_finance.opening_details where account='2131' and subject=p_subject),0)$$;
create or replace function public.clinic_finance_manual_command(p_action text,p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_variable
declare me uuid:=clinic_finance.require_access('review');r clinic_finance.manual_batches%rowtype;v uuid;e uuid;j jsonb;lines jsonb;k text:=p_payload->>'kind';code text;sub text;debit numeric;credit numeric;td numeric:=0;tc numeric:=0;acct clinic_finance.accounts%rowtype;i uuid;claim uuid;n integer:=0;meta jsonb;stock_value numeric;stock_book numeric;
begin perform clinic_finance.lock_day();
if p_action='request' then
 select * into r from clinic_finance.manual_batches where created_by=me and token=p_token;if found then if (r.payload-'lines')<>(p_payload-'lines') or (k<>'reversal' and r.payload->'lines' is distinct from p_payload->'lines') then raise exception 'مفتاح مستخدم لبيانات أخرى';end if;return r.id;end if;
 if coalesce(length(trim(p_payload->>'reference')),0)<2 or coalesce(length(trim(p_payload->>'note')),0)<3 then raise exception 'المرجع وشرح المستند مطلوبان';end if;
 lines:=p_payload->'lines';if k='reversal' then select jsonb_agg(jsonb_build_object('account',l.account,'debit',l.credit,'credit',l.debit)) into lines from clinic_finance.lines l join clinic_finance.manual_batches b on b.entry_id=l.entry_id where b.entry_id=(p_payload->>'entry_id')::uuid and b.kind='correction' and b.status='approved';if lines is null then raise exception 'العكس هنا لقيد تصحيح يدوي معتمد فقط؛ المعاملات التشغيلية تُعالج من قسمها';end if;end if;
 if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) not between 2 and 200 then raise exception 'القيد يحتاج من سطرين إلى 200 سطر';end if;
 for j in select value from jsonb_array_elements(lines) loop
 code:=j->>'account';sub:=trim(coalesce(j->>'subject',''));debit:=(j->>'debit')::numeric;credit:=(j->>'credit')::numeric;select * into acct from clinic_finance.accounts where accounts.code=code;
 if not found or debit is null or credit is null or debit::text in ('NaN','Infinity','-Infinity') or credit::text in ('NaN','Infinity','-Infinity') or debit<0 or credit<0 or debit<>round(debit,2) or credit<>round(credit,2) or (debit>0)=(credit>0) then raise exception 'راجع حساب ومبالغ سطر القيد';end if;
 if code='1111' then raise exception 'الرصيد النقدي يُسجل من الوردية برصيد افتتاحي وجرد فعلي';end if;
 if k='opening' then
 if acct.kind in ('income','expense') then raise exception 'الأرصدة الافتتاحية لحسابات الميزانية فقط؛ استخدم الأرباح المرحلة للنتائج السابقة';end if;
 if code in ('1211','1291','1292','2150') then raise exception 'هذا الحساب يحتاج سجلًا تشغيليًا متخصصًا؛ استخدم تسجيل الأصل أو المطالبة أو مقدم الحجز من قسمه قبل اعتماد الافتتاح';end if;
 if code in ('1122','1121','1142','2111','2120','2131','2144') and length(sub)<2 then raise exception 'يلزم معرف صاحب الرصيد في سطر الحساب %',code;end if;
 if code in ('1122','1121','1142') and credit>0 or code in ('2120','2131','2144') and debit>0 then raise exception 'جهة الرصيد غير مدعومة لهذا الحساب';end if;
 if code='2111' and not exists(select 1 from public.inventory_suppliers where id=sub::uuid and active) then raise exception 'المورد غير موجود أو غير نشط';end if;
 if code='2120' and not exists(select 1 from clinic_finance.doctor_contracts where doctor_key=sub and status='active') then raise exception 'سجل عقد الطبيب قبل رصيده الافتتاحي';end if;
 if code in ('1142','2131') and not exists(select 1 from clinic_finance.business_requests where subject=sub and kind='employment' and status='approved') then raise exception 'سجل عقد الموظف قبل رصيده الافتتاحي';end if;
 if code='1121' and coalesce(length(j->'metadata'->>'insurer'),0)<2 then raise exception 'اسم شركة التأمين مطلوب';end if;
 else
 if code in ('1122','1121','1131','1142','1211','1291','1292','2111','2120','2131','2144','1114','2150') then raise exception 'الحساب التشغيلي % يُصحح من قسمه للحفاظ على تفاصيل الرصيد',code;end if;
 end if;td:=td+debit;tc:=tc+credit;
 end loop;if td<>tc or td<=0 then raise exception 'القيد غير متوازن';end if;
 insert into clinic_finance.manual_batches(kind,reference,note,payload,created_by,token) values(k,trim(p_payload->>'reference'),trim(p_payload->>'note'),p_payload||jsonb_build_object('lines',lines),me,p_token) returning id into v;
elsif p_action='review' then
 select * into r from clinic_finance.manual_batches where id=(p_payload->>'id')::uuid for update;if not found or r.status<>'pending' or r.created_by=me or coalesce(length(trim(p_payload->>'note')),0)<3 then raise exception 'يلزم قيد معلق ومراجع آخر وسبب القرار';end if;v:=r.id;
 if (p_payload->>'approve')::boolean then
 if r.kind='reversal' and exists(select 1 from clinic_finance.bank_rows br join clinic_finance.lines l on l.id=br.line_id where l.entry_id=(r.payload->>'entry_id')::uuid) then raise exception 'القيد مرتبط بمطابقة بنكية؛ راجع المطابقة أولًا';end if;
 if r.kind='opening' then
 select coalesce(sum(quantity_delta*unit_cost),0) into stock_value from public.inventory_movements;
 -- Current valuation uses current on-hand lots and weighted cost, not a sum of historical moving costs.
 select coalesce(sum(public.inventory_location_balance(location_id,item_id,lot_id,false)*public.inventory_location_cost(location_id,item_id,lot_id,false)),0) into stock_value from(select distinct location_id,item_id,lot_id from public.inventory_movements)x;
 select coalesce(sum(l.debit-l.credit),0) into stock_book from clinic_finance.lines l where account='1131';
 select coalesce(sum((x->>'debit')::numeric-(x->>'credit')::numeric),0) into debit from jsonb_array_elements(r.payload->'lines')x where x->>'account'='1131';
 if round(stock_value,2)<>round(stock_book+debit,2) then raise exception 'رصيد المخزون الافتتاحي لا يطابق قيمة المخزون الفعلية الحالية';end if;end if;
 insert into clinic_finance.entries(source,source_id,description,created_by) values('manual_'||r.kind,v,r.reference||' — '||r.note,me) returning id into e;
 for j in select value from jsonb_array_elements(r.payload->'lines') loop
 n:=n+1;code:=j->>'account';sub:=trim(coalesce(j->>'subject',''));debit:=(j->>'debit')::numeric;credit:=(j->>'credit')::numeric;meta:=coalesce(j->'metadata','{}'::jsonb);
 insert into clinic_finance.lines(entry_id,account,debit,credit) values(e,code,debit,credit);
 if r.kind='opening' then
 insert into clinic_finance.opening_details(batch_id,account,subject,debit,credit,metadata) values(v,code,sub,debit,credit,meta);
 if code='2111' then insert into clinic_finance.supplier_events(supplier_id,amount,description) values(sub::uuid,credit-debit,'رصيد افتتاحي '||r.reference);
 elsif code in ('1122','1121') then
 insert into clinic_finance.invoices(reference,patient_ref,description,amount,created_by,token) values('OPEN-'||v||'-'||n,sub,'رصيد مديونية افتتاحي — '||r.reference,debit,me,gen_random_uuid()) returning id into i;
 if code='1121' then insert into clinic_finance.insurance_claims(invoice_id,reference,insurer,amount,created_by,token) values(i,'OPEN-CLAIM-'||v||'-'||n,meta->>'insurer',debit,me,gen_random_uuid()) returning id into claim;insert into clinic_finance.claim_followups(claim_id,due_date,batch,note,created_by) values(claim,coalesce((meta->>'due_date')::date,current_date),r.reference,'مطالبة افتتاحية — '||r.note,me);end if;
 elsif code='2144' then insert into clinic_finance.business_requests(kind,subject,reference,amount,payload,created_by,token,status,reviewed_by,review_note) values('tax',sub,'OPEN-TAX-'||v||'-'||n,credit,jsonb_build_object('direction','payable','note','رصيد ضريبي افتتاحي '||r.reference),r.created_by,gen_random_uuid(),'approved',me,p_payload->>'note');
 end if;end if;
 end loop;
 update clinic_finance.manual_batches set entry_id=e where id=v;end if;
 update clinic_finance.manual_batches set status=case when (p_payload->>'approve')::boolean then 'approved' else 'rejected' end,reviewed_by=me,review_note=p_payload->>'note' where id=v;
else raise exception 'إجراء غير معروف';end if;
insert into clinic_finance.audit(actor,action,entity_id) values(me,'manual_'||p_action,v);return v;end $$;
create or replace function public.clinic_finance_reports(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('review');v jsonb;profit numeric;cf numeric;begin
if p_from is null or p_to is null or p_to<p_from then raise exception 'الفترة غير صالحة';end if;
select coalesce(sum(l.credit-l.debit),0) into profit from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id join clinic_finance.accounts a on a.code=l.account where e.business_date<=p_to and a.kind in ('income','expense');
v:=jsonb_build_object('from',p_from,'to',p_to,'opening_approved',exists(select 1 from clinic_finance.manual_batches where kind='opening' and status='approved'),'cumulative_result',profit,
'profit_loss',(select coalesce(jsonb_agg(x order by code),'[]') from(select a.code,a.name,a.kind,coalesce(sum(l.credit-l.debit),0) amount from clinic_finance.accounts a left join clinic_finance.lines l on l.account=a.code and exists(select 1 from clinic_finance.entries where id=l.entry_id and business_date between p_from and p_to) where a.kind in ('income','expense') group by a.code)x),
'balance_sheet',(select coalesce(jsonb_agg(x order by code),'[]') from(select a.code,a.name,a.kind,coalesce(sum(case when a.kind='asset' then l.debit-l.credit else l.credit-l.debit end),0) amount from clinic_finance.accounts a left join clinic_finance.lines l on l.account=a.code and exists(select 1 from clinic_finance.entries where id=l.entry_id and business_date<=p_to) where a.kind in ('asset','liability','equity') group by a.code)x),
'cash_opening',(select coalesce(sum(l.debit-l.credit),0) from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where l.account in ('1111','1112','1115') and e.business_date<p_from),
'cash_closing',(select coalesce(sum(l.debit-l.credit),0) from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where l.account in ('1111','1112','1115') and e.business_date<=p_to),
'cash_flows',(select coalesce(jsonb_agg(x),'[]') from(select case when e.source='manual_opening' or e.source='opening' then 'opening' when exists(select 1 from clinic_finance.lines z where z.entry_id=e.id and z.account='1211') then 'investing' when exists(select 1 from clinic_finance.lines z join clinic_finance.accounts a on a.code=z.account where z.entry_id=e.id and a.kind='equity') then 'financing' else 'operating' end category,sum(l.debit-l.credit) amount from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where l.account in ('1111','1112','1115') and e.business_date between p_from and p_to group by category)x));
return v;end $$;
alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance;
alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to manual_snapshot_base;
create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb:=clinic_finance.manual_snapshot_base(p_from,p_to,p_offset);begin if clinic_finance.allowed('review') then v:=v||jsonb_build_object('manual_batches',(select coalesce(jsonb_agg(x),'[]') from(select * from clinic_finance.manual_batches order by created_at desc limit 200 offset p_offset)x),'finance_accounts',(select jsonb_agg(a order by code) from clinic_finance.accounts a),'financial_reports',public.clinic_finance_reports(p_from,p_to));end if;return v;end $$;
alter table clinic_finance.manual_batches enable row level security;
alter table clinic_finance.opening_details enable row level security;
revoke all on all tables in schema clinic_finance from public,anon,authenticated;
revoke all on all functions in schema clinic_finance from public,anon,authenticated;
revoke all on function public.clinic_finance_manual_command(text,jsonb,uuid),public.clinic_finance_reports(date,date),public.clinic_finance_snapshot(date,date,integer) from public,anon;
grant execute on function public.clinic_finance_manual_command(text,jsonb,uuid),public.clinic_finance_reports(date,date),public.clinic_finance_snapshot(date,date,integer) to authenticated;
commit;
