begin;
alter table clinic_finance.registers add column operation_mode text not null default 'both' check(operation_mode in ('receive','pay','both'));
alter table clinic_finance.payments drop constraint payments_method_check;
alter table clinic_finance.payments add constraint payments_method_check check(method in ('cash','pos','bank','wallet','instapay'));
alter table clinic_finance.advances drop constraint advances_method_check;
alter table clinic_finance.advances add constraint advances_method_check check(method in ('cash','pos','bank','wallet','instapay'));
alter table clinic_finance.requests drop constraint requests_kind_check;
alter table clinic_finance.requests add constraint requests_kind_check check(kind in ('refund','expense','general_expense','fund','deposit','opening','void'));
insert into clinic_finance.accounts values('5219','مصروف الكهرباء','expense'),('5220','مصروف المياه','expense'),('5222','مصروف الغاز','expense'),('5223','مصروف النفايات','expense'),('5224','مصروفات عمومية أخرى','expense'),('5225','مصروف الإيجار','expense') on conflict do nothing;
create function clinic_finance.overhead_account(p_category text) returns text language sql immutable set search_path=pg_catalog as $$select case p_category when 'electricity' then '5219' when 'water' then '5220' when 'gas' then '5222' when 'waste' then '5223' when 'other' then '5224' when 'rent' then '5225' end$$;
create function clinic_finance.register_direction(p_shift uuid,p_direction text) returns void language plpgsql stable security definer set search_path=pg_catalog,public as $$declare mode text;begin
select r.operation_mode into mode from clinic_finance.shifts s join clinic_finance.registers r on r.id=s.register_id where s.id=p_shift;
if mode is null then raise exception 'الوردية أو الخزينة غير موجودة';end if;
if p_direction='receive' and mode='pay' then raise exception 'الخزينة للصرف فقط ولا تقبل تحصيلًا';elsif p_direction='pay' and mode='receive' then raise exception 'الخزينة للاستلام فقط ولا تسمح بالصرف';elsif p_direction not in ('receive','pay') then raise exception 'اتجاه حركة الخزينة غير صالح';end if;end $$;
create function public.clinic_finance_save_register(p_id uuid,p_name text,p_limit numeric,p_mode text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare me uuid:=clinic_finance.require_access('review');r clinic_finance.registers%rowtype;v uuid;begin
perform clinic_finance.lock_day();if p_mode is null or p_mode not in ('receive','pay','both') or p_limit is null or p_limit<0 or p_limit>100000 or p_limit<>round(p_limit,2) or p_limit::text in ('NaN','Infinity','-Infinity') then raise exception 'نوع الخزينة أو حد النثريات غير صالح';end if;
if p_id is null then insert into clinic_finance.registers(name,petty_limit,operation_mode,created_by) values(trim(p_name),p_limit,p_mode,me) returning id into v;
else select * into r from clinic_finance.registers where id=p_id for update;if not found then raise exception 'الخزينة غير موجودة';end if;
if r.operation_mode<>p_mode and exists(select 1 from clinic_finance.shifts where register_id=p_id and status<>'reviewed') then raise exception 'سلّم وراجع الوردية الحالية قبل تغيير نوع الخزينة';end if;
update clinic_finance.registers set name=trim(p_name),petty_limit=p_limit,operation_mode=p_mode where id=p_id;v:=p_id;end if;
insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,case when p_id is null then 'register_created' else 'register_updated' end,v,jsonb_build_object('mode',p_mode,'previous_mode',r.operation_mode,'name',trim(p_name),'petty_limit',p_limit));return v;end $$;
create or replace function clinic_finance.post(p_source text,p_source_id uuid,p_description text,p_shift uuid,p_debit text,p_credit text,p_amount numeric) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare v_id uuid;begin
perform clinic_finance.lock_day();if public.my_admin_id() is null or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) then raise exception 'المبلغ أو المستخدم غير صالح';end if;
if p_debit='1111' or p_credit='1111' then perform clinic_finance.check_shift(p_shift,false);end if;
-- Opening/funding and bank deposits move custody, while operational receipts/payouts follow the register direction.
if p_shift is not null then
if p_source in ('collection','advance_receipt') or p_debit='1111' and p_source not in ('opening','fund') then perform clinic_finance.register_direction(p_shift,'receive');end if;
if p_credit='1111' and p_source<>'deposit' then perform clinic_finance.register_direction(p_shift,'pay');end if;end if;
if p_credit='1111' and p_amount>clinic_finance.cash_limit(p_shift) then raise exception 'الكاش المتاح لا يكفي للصرف؛ الخزينة لا تقبل رصيدا سالبا';end if;
insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values(p_source,p_source_id,p_description,p_shift,public.my_admin_id()) returning id into v_id;
insert into clinic_finance.lines(entry_id,account,debit,credit) values(v_id,p_debit,p_amount,0),(v_id,p_credit,0,p_amount);return v_id;end $$;
-- Add InstaPay to stored receipt methods and route both collection and refunds through bank account 1112.
do $$declare fn regprocedure;def text;patched text;begin foreach fn in array array['clinic_finance.collect_base(uuid,uuid,text,numeric,text,uuid)'::regprocedure,'clinic_finance.review_request_base(uuid,boolean,text)'::regprocedure,'public.clinic_booking_command(text,jsonb,uuid)'::regprocedure] loop
 def:=pg_get_functiondef(fn);patched:=replace(def,$s$('cash','pos','bank','wallet')$s$,$s$('cash','pos','bank','wallet','instapay')$s$);patched:=replace(patched,$s$('bank','wallet')$s$,$s$('bank','wallet','instapay')$s$);patched:=replace(patched,$s$when 'bank' then '1112'$s$,$s$when 'bank' then '1112' when 'instapay' then '1112'$s$);patched:=replace(patched,$s$a.method='bank'$s$,$s$a.method in ('bank','instapay')$s$);if patched=def then raise exception 'Missing payment patch target: %',fn;end if;execute patched;
end loop;end $$;
alter table clinic_finance.doctor_payouts drop constraint doctor_payouts_method_check;
alter table clinic_finance.doctor_payouts add constraint doctor_payouts_method_check check(method in ('cash','bank','instapay'));
alter table clinic_finance.supplier_actions drop constraint supplier_actions_method_check;
alter table clinic_finance.supplier_actions add constraint supplier_actions_method_check check(method in ('cash','bank','instapay'));
create unique index finance_doctor_bank_reference on clinic_finance.doctor_payouts((case when method='instapay' then 'bank' else method end),reference) where status='approved';
create unique index finance_supplier_bank_reference on clinic_finance.supplier_actions(kind,(case when method='instapay' then 'bank' else method end),reference) where status='approved' and kind in ('supplier_payment','supplier_refund');
create unique index finance_receipt_bank_reference on clinic_finance.payments((case when method='instapay' then 'bank' else method end),reference);
create unique index finance_advance_bank_reference on clinic_finance.advances((case when method='instapay' then 'bank' else method end),reference);
do $$declare fn regprocedure;def text;patched text;begin foreach fn in array array['public.clinic_booking_command(text,jsonb,uuid)'::regprocedure,'public.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid)'::regprocedure] loop def:=pg_get_functiondef(fn);patched:=replace(def,$s$method=p_payload->>'method'$s$,$s$(method=p_payload->>'method' or method in ('bank','instapay') and p_payload->>'method' in ('bank','instapay'))$s$);patched:=replace(patched,'method=p_method',$s$(method=p_method or method in ('bank','instapay') and p_method in ('bank','instapay'))$s$);if patched=def then raise exception 'Missing receipt reference guard';end if;execute patched;end loop;end $$;
-- General expenses keep the existing request/review/idempotency pipeline, with a documented expense account and channel.
do $$declare def text;patched text;begin
 def:=pg_get_functiondef('clinic_finance.request_base(jsonb,uuid)'::regprocedure);
 patched:=replace(def,$s$('refund','expense','fund','deposit','opening','void')$s$,$s$('refund','expense','general_expense','fund','deposit','opening','void')$s$);
 patched:=replace(patched,$s$ else
  perform clinic_finance.check_shift(s);$s$,$s$ elsif k='general_expense' then
  if clinic_finance.overhead_account(p_payload->>'category') is null or coalesce(p_payload->>'method','') not in ('cash','bank','instapay') then raise exception 'حدد بند المصروف وطريقة السداد';end if;
  if p_payload->>'method'='cash' then perform clinic_finance.check_shift(s);else s:=null;end if;
 else
  perform clinic_finance.check_shift(s);$s$);
 patched:=replace(patched,$s$ insert into clinic_finance.requests(kind,$s$,$s$ if s is not null and k in ('expense','refund','general_expense') then perform clinic_finance.register_direction(s,'pay');end if;
 insert into clinic_finance.requests(kind,$s$);
 if patched=def or position('overhead_account' in patched)=0 then raise exception 'Missing general expense request target';end if;execute patched;
 def:=pg_get_functiondef('clinic_finance.review_request_base(uuid,boolean,text)'::regprocedure);
 patched:=replace(def,$s$when 'expense' then dc:='5216';cc:='1111';$s$,$s$when 'expense' then dc:='5216';cc:='1111';
  when 'general_expense' then dc:=clinic_finance.overhead_account(r.payload->>'category');cc:=case when r.payload->>'method'='cash' then '1111' else '1112' end;if dc is null or coalesce(r.payload->>'method','') not in ('cash','bank','instapay') then raise exception 'بيانات المصروف العمومي غير صالحة';end if;$s$);
 if patched=def then raise exception 'Missing expense review target';end if;execute patched;
end $$;
-- Validate the cash direction when salary, doctor or supplier payment requests are created, too.
do $$declare fn regprocedure;def text;patched text;begin foreach fn in array array['public.clinic_finance_doctor_command(text,jsonb,uuid)'::regprocedure,'public.clinic_finance_supplier_command(text,jsonb,uuid)'::regprocedure,'public.clinic_finance_business_command(text,jsonb,uuid)'::regprocedure] loop
 def:=pg_get_functiondef(fn);def:=replace(def,$s$('cash','bank')$s$,$s$('cash','bank','instapay')$s$);patched:=replace(def,$s$perform clinic_finance.check_shift((p_payload->>'shift_id')::uuid);$s$,$s$perform clinic_finance.check_shift((p_payload->>'shift_id')::uuid);perform clinic_finance.register_direction((p_payload->>'shift_id')::uuid,'pay');$s$);if patched=def then raise exception 'Missing cash request direction target: %',fn;end if;if fn='public.clinic_finance_supplier_command(text,jsonb,uuid)'::regprocedure then patched:=replace(patched,$s$register_direction((p_payload->>'shift_id')::uuid,'pay')$s$,$s$register_direction((p_payload->>'shift_id')::uuid,case when k='supplier_refund' then 'receive' else 'pay' end)$s$);patched:=replace(patched,$s$if k in ('supplier_payment','supplier_refund') then$s$,$s$if k in ('supplier_payment','supplier_refund') then if coalesce(p_payload->>'method','') not in ('cash','bank','instapay') then raise exception 'حدد طريقة السداد';end if;$s$);end if;execute patched;end loop;end $$;
-- Unified review list does not duplicate or move the original liabilities/payments.
alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance;
alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to directions_snapshot_base;
create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb:=clinic_finance.directions_snapshot_base(p_from,p_to,p_offset);me uuid:=clinic_finance.require_access('view');reviewer boolean:=clinic_finance.allowed('review');begin
return v||jsonb_build_object('disbursements',(select coalesce(jsonb_agg(x order by created_at desc,id desc),'[]') from(
select q.*,a.name creator_name from (
 select r.id,r.kind,r.amount,r.evidence reference,r.reason,r.created_by,r.created_at,r.status,r.review_note,'review-request'::text review_action,coalesce(r.payload->>'category','') category,r.payload||jsonb_build_object('method',coalesce(r.payload->>'method',(select method from clinic_finance.payments where id=r.payment_id),case when r.shift_id is not null then 'cash' end)) details from clinic_finance.requests r
 union all select p.id,'doctor_payment',p.gross-p.withheld,p.reference,'أتعاب الطبيب '||coalesce((select max(doctor_name) from clinic_finance.doctor_contracts where doctor_key=p.doctor_key),p.doctor_key),p.created_by,p.created_at,p.status,p.review_note,'doctor-payout-review','',p.payload from clinic_finance.doctor_payouts p
 union all select b.id,'salary_payment',b.amount,b.reference,'راتب '||coalesce((select max(payload->>'employee_name') from clinic_finance.business_requests where subject=b.subject and kind='employment' and status='approved'),b.subject)||' — '||(b.payload->>'note'),b.created_by,b.created_at,b.status,b.review_note,'business-review','',b.payload from clinic_finance.business_requests b where b.kind='salary_payment'
 union all select s.id,'supplier_payment',s.amount,s.reference,'مورد '||coalesce((select name from public.inventory_suppliers where id=s.supplier_id),'')||' — '||s.note,s.created_by,s.created_at,s.status,s.review_note,'supplier-review','',s.payload from clinic_finance.supplier_actions s where s.kind='supplier_payment'
)q join public.admins a on a.id=q.created_by where (reviewer or q.created_by=me) and (q.status='pending' or (q.created_at at time zone 'Africa/Cairo')::date between p_from and p_to) order by q.created_at desc,q.id desc limit 200 offset p_offset)x));end $$;
-- Reception sees each register's mode without gaining general accounting access.
do $$declare def text;patched text;begin def:=pg_get_functiondef('public.clinic_booking_snapshot(date,date)'::regprocedure);patched:=replace(def,'select id,name from clinic_finance.registers','select id,name,operation_mode from clinic_finance.registers');patched:=replace(patched,'r.name register_name from clinic_finance.shifts','r.name register_name,r.operation_mode from clinic_finance.shifts');if patched=def then raise exception 'Missing reception register mode target';end if;execute patched;end $$;
revoke all on all functions in schema clinic_finance from public,anon,authenticated;
revoke all on function public.clinic_finance_save_register(uuid,text,numeric,text),public.clinic_finance_snapshot(date,date,integer) from public,anon;
grant execute on function public.clinic_finance_save_register(uuid,text,numeric,text),public.clinic_finance_snapshot(date,date,integer) to authenticated;
commit;
