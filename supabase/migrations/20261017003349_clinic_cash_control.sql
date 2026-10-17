-- Stage 1: append-only clinic cash control. No historical import or assumed balances.
begin;
create schema if not exists clinic_finance;
revoke all on schema clinic_finance from public,anon,authenticated;
create table if not exists clinic_finance.accounts(code text primary key,name text not null,kind text not null check(kind in ('asset','liability','equity','income','expense')));
insert into clinic_finance.accounts values
 ('1111','الخزينة','asset'),('1112','البنك','asset'),('1114','وسيط البطاقات','asset'),('1115','المحافظ والتحويلات','asset'),('1122','مديونيات الخدمات','asset'),
 ('3199','أرصدة افتتاحية تحت التسوية','equity'),('4110','إيراد الخدمات المسجلة بالدورة المالية','income'),('4152','مردودات الخدمات','income'),('5216','مصروفات نثرية','expense') on conflict do nothing;
create table if not exists clinic_finance.registers(id uuid primary key default gen_random_uuid(),name text not null unique check(length(trim(name)) between 2 and 100),petty_limit numeric(14,2) not null check(petty_limit>=0),created_by uuid not null references public.admins(id),created_at timestamptz not null default now());
create table if not exists clinic_finance.shifts(id uuid primary key default gen_random_uuid(),register_id uuid not null references clinic_finance.registers(id),cashier_id uuid not null references public.admins(id),token uuid not null,opened_at timestamptz not null default now(),closed_at timestamptz,status text not null default 'open' check(status in ('open','submitted','reviewed')),opening_book numeric(14,2) not null,counted numeric(14,2),denominations jsonb,note text not null default '',review_note text,reviewed_by uuid references public.admins(id),reviewed_at timestamptz,unique(cashier_id,token));
create unique index if not exists fin_register_active on clinic_finance.shifts(register_id) where status<>'reviewed';
create unique index if not exists fin_cashier_active on clinic_finance.shifts(cashier_id) where status<>'reviewed';
create table if not exists clinic_finance.invoices(id uuid primary key default gen_random_uuid(),reference text not null unique check(length(trim(reference)) between 2 and 120),patient_ref text not null default '' check(length(patient_ref)<=120),description text not null check(length(trim(description)) between 2 and 500),amount numeric(14,2) not null check(amount>0),created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),token uuid not null,voided boolean not null default false,unique(created_by,token));
create table if not exists clinic_finance.payments(id uuid primary key default gen_random_uuid(),invoice_id uuid not null references clinic_finance.invoices(id),shift_id uuid references clinic_finance.shifts(id),method text not null check(method in ('cash','pos','bank','wallet')),amount numeric(14,2) not null check(amount>0),reference text not null check(length(trim(reference)) between 2 and 120),created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),token uuid not null,unique(created_by,token),unique(method,reference));
create table if not exists clinic_finance.requests(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('refund','expense','fund','deposit','opening','void')),shift_id uuid references clinic_finance.shifts(id),payment_id uuid references clinic_finance.payments(id),invoice_id uuid references clinic_finance.invoices(id),amount numeric(14,2) not null check(amount>0),reason text not null check(length(trim(reason)) between 3 and 1000),evidence text not null check(length(trim(evidence)) between 2 and 200),payload jsonb not null,created_by uuid not null references public.admins(id),token uuid not null,created_at timestamptz not null default now(),status text not null default 'pending' check(status in ('pending','approved','rejected')),reviewed_by uuid references public.admins(id),reviewed_at timestamptz,review_note text,unique(created_by,token));
create table if not exists clinic_finance.entries(id uuid primary key default gen_random_uuid(),source text not null,source_id uuid not null,description text not null,shift_id uuid references clinic_finance.shifts(id),business_date date not null default (now() at time zone 'Africa/Cairo')::date,created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),unique(source,source_id));
create table if not exists clinic_finance.lines(id uuid primary key default gen_random_uuid(),entry_id uuid not null references clinic_finance.entries(id),account text not null references clinic_finance.accounts(code),debit numeric(14,2) not null default 0,credit numeric(14,2) not null default 0,check((debit>0 and credit=0) or (credit>0 and debit=0)));
create index if not exists fin_lines_entry on clinic_finance.lines(entry_id);
create index if not exists fin_entries_date on clinic_finance.entries(business_date);
create table if not exists clinic_finance.periods(closed_through date primary key,created_by uuid not null references public.admins(id),created_at timestamptz not null default now());
create table if not exists clinic_finance.audit(id bigint generated always as identity primary key,actor uuid not null references public.admins(id),action text not null,entity_id uuid,detail jsonb not null default '{}',created_at timestamptz not null default now());
do $$ declare t text;begin foreach t in array array['accounts','registers','shifts','invoices','payments','requests','entries','lines','periods','audit'] loop execute format('alter table clinic_finance.%I enable row level security',t);execute format('revoke all on clinic_finance.%I from public,anon,authenticated',t);end loop;end $$;

create or replace function clinic_finance.allowed(p_action text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.my_admin_id() is not null and (public.has_role('super_admin') or public.has_role('general_manager') or
 ((public.has_role('accountant') or public.has_role('financial_manager')) and public.finance_module_allowed('accounting',case when p_action='review' then 'update' else p_action end) and (p_action<>'review' or public.has_role('financial_manager'))));
$$;
create or replace function clinic_finance.require_access(p_action text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
begin if not clinic_finance.allowed(p_action) then raise exception 'ليس لديك صلاحية لهذه العملية المالية' using errcode='42501';end if;return public.my_admin_id();end $$;
create or replace function clinic_finance.lock_day() returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin perform pg_advisory_xact_lock(927311);if exists(select 1 from clinic_finance.periods where closed_through>=(now() at time zone 'Africa/Cairo')::date) then raise exception 'الفترة المالية مقفلة';end if;end $$;
create or replace function clinic_finance.post(p_source text,p_source_id uuid,p_description text,p_shift uuid,p_debit text,p_credit text,p_amount numeric) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
 if p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) then raise exception 'المبلغ غير صالح';end if;
 insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values(p_source,p_source_id,p_description,p_shift,public.my_admin_id()) returning id into v_id;
 insert into clinic_finance.lines(entry_id,account,debit,credit) values(v_id,p_debit,p_amount,0),(v_id,p_credit,0,p_amount);return v_id;
end $$;
create or replace function clinic_finance.shift_cash(p_shift uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$
 select s.opening_book+coalesce((select sum(l.debit-l.credit) from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where e.shift_id=s.id and l.account='1111'),0) from clinic_finance.shifts s where s.id=p_shift;
$$;
create or replace function clinic_finance.check_shift(p_shift uuid,p_own boolean default true) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin if not exists(select 1 from clinic_finance.shifts where id=p_shift and status='open' and (not p_own or cashier_id=public.my_admin_id())) then raise exception 'اختر وردية مفتوحة تخصك';end if;end $$;

create or replace function public.clinic_finance_register(p_name text,p_limit numeric) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('review');v_id uuid;
begin perform clinic_finance.lock_day();if p_limit is null or p_limit<0 or p_limit>100000 or p_limit<>round(p_limit,2) then raise exception 'حد النثريات غير صالح';end if;
 insert into clinic_finance.registers(name,petty_limit,created_by) values(trim(p_name),p_limit,me) returning id into v_id;insert into clinic_finance.audit(actor,action,entity_id) values(me,'register_created',v_id);return v_id;end $$;
create or replace function public.clinic_finance_open_shift(p_register uuid,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');r clinic_finance.shifts%rowtype;v_id uuid;opening numeric;
begin perform clinic_finance.lock_day();select * into r from clinic_finance.shifts where cashier_id=me and token=p_token;if found then if r.register_id is distinct from p_register then raise exception 'مفتاح الطلب مستخدم لعملية مختلفة';end if;return r.id;end if;
 perform 1 from clinic_finance.registers where id=p_register;if not found then raise exception 'الخزينة غير موجودة';end if;
 select coalesce(sum(l.debit-l.credit),0) into opening from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id join clinic_finance.shifts s on s.id=e.shift_id where s.register_id=p_register and l.account='1111';
 insert into clinic_finance.shifts(register_id,cashier_id,token,opening_book) values(p_register,me,p_token,opening) returning id into v_id;insert into clinic_finance.audit(actor,action,entity_id) values(me,'shift_opened',v_id);return v_id;end $$;

create or replace function public.clinic_finance_invoice(p_reference text,p_patient_ref text,p_description text,p_amount numeric,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');r clinic_finance.invoices%rowtype;v_id uuid;
begin perform clinic_finance.lock_day();select * into r from clinic_finance.invoices where created_by=me and token=p_token;
 if found then if r.reference is distinct from trim(p_reference) or r.patient_ref is distinct from trim(coalesce(p_patient_ref,'')) or r.description is distinct from trim(p_description) or r.amount is distinct from p_amount then raise exception 'مفتاح الطلب مستخدم لعملية مختلفة';end if;return r.id;end if;
 if p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) then raise exception 'أدخل مبلغ الخدمة بالجنيه والقرش';end if;
 insert into clinic_finance.invoices(reference,patient_ref,description,amount,created_by,token) values(trim(p_reference),trim(coalesce(p_patient_ref,'')),trim(p_description),p_amount,me,p_token) returning id into v_id;
 perform clinic_finance.post('invoice',v_id,'إثبات خدمة منفذة '||p_reference,null,'1122','4110',p_amount);insert into clinic_finance.audit(actor,action,entity_id) values(me,'invoice_recorded',v_id);return v_id;end $$;
create or replace function public.clinic_finance_collect(p_invoice uuid,p_shift uuid,p_method text,p_amount numeric,p_reference text,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');r clinic_finance.payments%rowtype;i clinic_finance.invoices%rowtype;v_id uuid;paid numeric;account_code text;
begin perform clinic_finance.lock_day();select * into r from clinic_finance.payments where created_by=me and token=p_token;
 if found then if r.invoice_id is distinct from p_invoice or r.shift_id is distinct from p_shift or r.method is distinct from p_method or r.amount is distinct from p_amount or r.reference is distinct from trim(p_reference) then raise exception 'مفتاح الطلب مستخدم لعملية مختلفة';end if;return r.id;end if;
 perform clinic_finance.check_shift(p_shift);select * into i from clinic_finance.invoices where id=p_invoice for update;if not found or i.voided then raise exception 'الخدمة غير موجودة أو ملغاة';end if;if i.created_by<>me and not clinic_finance.allowed('review') then raise exception 'الخدمة خارج نطاقك' using errcode='42501';end if;
 if p_method not in ('cash','pos','bank','wallet') or p_method is null or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) then raise exception 'طريقة السداد أو المبلغ غير صالح';end if;
 select coalesce(sum(amount),0) into paid from clinic_finance.payments where invoice_id=p_invoice;if paid+p_amount>i.amount then raise exception 'التحصيل يتجاوز المستحق';end if;
 account_code:=case p_method when 'cash' then '1111' when 'pos' then '1114' when 'bank' then '1112' else '1115' end;
 insert into clinic_finance.payments(invoice_id,shift_id,method,amount,reference,created_by,token) values(p_invoice,p_shift,p_method,p_amount,trim(p_reference),me,p_token) returning id into v_id;
 perform clinic_finance.post('collection',v_id,'تحصيل '||i.reference,p_shift,account_code,'1122',p_amount);insert into clinic_finance.audit(actor,action,entity_id) values(me,'payment_recorded',v_id);return v_id;end $$;

create or replace function public.clinic_finance_request(p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');r clinic_finance.requests%rowtype;k text:=p_payload->>'kind';s uuid:=nullif(p_payload->>'shift_id','')::uuid;pid uuid:=nullif(p_payload->>'payment_id','')::uuid;iid uuid:=nullif(p_payload->>'invoice_id','')::uuid;a numeric:=(p_payload->>'amount')::numeric;pay clinic_finance.payments%rowtype;inv clinic_finance.invoices%rowtype;v_id uuid;used numeric;lim numeric;
begin perform clinic_finance.lock_day();select * into r from clinic_finance.requests where created_by=me and token=p_token;if found then if r.payload is distinct from p_payload then raise exception 'مفتاح الطلب مستخدم لعملية مختلفة';end if;return r.id;end if;
 if k is null or k not in ('refund','expense','fund','deposit','opening','void') or a is null or a<=0 or a::text in ('NaN','Infinity','-Infinity') or a<>round(a,2) then raise exception 'نوع الطلب أو المبلغ غير صالح';end if;
 if k='void' then
  select * into inv from clinic_finance.invoices where id=iid for update;
  if inv.created_by<>me and not clinic_finance.allowed('review') then raise exception 'الخدمة خارج نطاقك' using errcode='42501';end if;
  if not found or inv.voided or a<>inv.amount or exists(select 1 from clinic_finance.payments where invoice_id=iid) then raise exception 'الإلغاء للخدمة غير المحصلة فقط وبكامل قيمتها';end if;
  if exists(select 1 from clinic_finance.requests where invoice_id=iid and kind='void' and status='pending') then raise exception 'يوجد طلب إلغاء قيد المراجعة';end if;s:=null;
 elsif k='refund' then
  select * into pay from clinic_finance.payments where id=pid for update;if not found then raise exception 'التحصيل غير موجود';end if;if pay.created_by<>me and not clinic_finance.allowed('review') then raise exception 'التحصيل خارج نطاقك' using errcode='42501';end if;
  iid:=pay.invoice_id;select coalesce(sum(amount),0) into used from clinic_finance.requests where payment_id=pid and kind='refund' and status in ('pending','approved');if used+a>pay.amount then raise exception 'الاسترداد يتجاوز التحصيل المتاح';end if;
  if pay.method='cash' then perform clinic_finance.check_shift(s);else s:=null;end if;
 else
  perform clinic_finance.check_shift(s);
  if k='expense' then select x.petty_limit into lim from clinic_finance.registers x join clinic_finance.shifts sh on sh.register_id=x.id where sh.id=s;if a>lim then raise exception 'المبلغ يتجاوز حد النثريات للخزينة';end if;end if;
  if k='opening' and exists(select 1 from clinic_finance.entries e join clinic_finance.shifts sh on sh.id=e.shift_id where sh.register_id=(select register_id from clinic_finance.shifts where id=s)) then raise exception 'الرصيد الافتتاحي مسموح قبل أول حركة للخزينة فقط';end if;
 end if;
 insert into clinic_finance.requests(kind,shift_id,payment_id,invoice_id,amount,reason,evidence,payload,created_by,token) values(k,s,pid,iid,a,trim(p_payload->>'reason'),trim(p_payload->>'evidence'),p_payload,me,p_token) returning id into v_id;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'request_created',v_id,jsonb_build_object('kind',k));return v_id;end $$;

create or replace function public.clinic_finance_review_request(p_id uuid,p_approve boolean,p_note text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('review');r clinic_finance.requests%rowtype;p clinic_finance.payments%rowtype;dc text;cc text;used numeric;
begin perform clinic_finance.lock_day();select * into r from clinic_finance.requests where id=p_id for update;if not found then raise exception 'الطلب غير موجود';end if;
 if r.created_by=me then raise exception 'لا يمكن اعتماد أو رفض طلبك بنفسك';end if;
 if p_approve is null or length(trim(coalesce(p_note,'')))<3 then raise exception 'أدخل نتيجة المراجعة وسبب القرار';end if;
 if r.status<>'pending' then if r.reviewed_by=me and r.status=(case when p_approve then 'approved' else 'rejected' end) then return r.id;end if;raise exception 'سبق اتخاذ قرار في الطلب';end if;
 if p_approve then
  if r.shift_id is not null then perform clinic_finance.check_shift(r.shift_id,false);end if;
  case r.kind
  when 'refund' then
   select * into p from clinic_finance.payments where id=r.payment_id for update;
   select coalesce(sum(amount),0) into used from clinic_finance.requests where payment_id=p.id and kind='refund' and status='approved';if used+r.amount>p.amount then raise exception 'الاسترداد يتجاوز المحصل';end if;
   dc:='4152';cc:=case p.method when 'cash' then '1111' when 'pos' then '1114' when 'bank' then '1112' else '1115' end;
  when 'expense' then dc:='5216';cc:='1111';
  when 'fund' then dc:='1111';cc:='1112';
  when 'deposit' then dc:='1112';cc:='1111';
  when 'opening' then
   if exists(select 1 from clinic_finance.entries e join clinic_finance.shifts sh on sh.id=e.shift_id where sh.register_id=(select register_id from clinic_finance.shifts where id=r.shift_id)) then raise exception 'سبق تسجيل حركات بالخزينة';end if;dc:='1111';cc:='3199';
  when 'void' then
   perform 1 from clinic_finance.invoices where id=r.invoice_id and not voided for update;if not found or exists(select 1 from clinic_finance.payments where invoice_id=r.invoice_id) then raise exception 'لا يمكن إلغاء خدمة محصلة أو ملغاة';end if;
   update clinic_finance.invoices set voided=true where id=r.invoice_id;dc:='4110';cc:='1122';
  end case;
  if cc='1111' and clinic_finance.shift_cash(r.shift_id)<r.amount then raise exception 'رصيد الخزينة لا يكفي للصرف';end if;
  perform clinic_finance.post(r.kind,r.id,r.reason,r.shift_id,dc,cc,r.amount);
 end if;
 update clinic_finance.requests set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=me,reviewed_at=now(),review_note=trim(p_note) where id=r.id;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'request_reviewed',r.id,jsonb_build_object('approved',p_approve,'note',trim(p_note)));return r.id;end $$;

create or replace function public.clinic_finance_close_shift(p_shift uuid,p_counts jsonb,p_note text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('create');c record;total numeric:=0;s clinic_finance.shifts%rowtype;
begin perform clinic_finance.lock_day();select * into s from clinic_finance.shifts where id=p_shift;
 if s.cashier_id=me and s.status in ('submitted','reviewed') and s.denominations=p_counts and s.note=left(coalesce(p_note,''),1000) then return p_shift;end if;
 perform clinic_finance.check_shift(p_shift);
 if exists(select 1 from clinic_finance.requests where shift_id=p_shift and status='pending') then raise exception 'راجع طلبات الوردية المعلقة قبل الإغلاق';end if;
 if p_counts is null or jsonb_typeof(p_counts)<>'object' or p_counts='{}'::jsonb then raise exception 'أدخل جرد الفئات النقدية';end if;
 for c in select key,value from jsonb_each_text(p_counts) loop
  if c.key not in ('200','100','50','20','10','5','1','0.5','0.25') or c.value is null or c.value!~'^[0-9]{1,7}$' then raise exception 'الفئات أو أعداد الأوراق غير صالحة';end if;total:=total+c.key::numeric*c.value::numeric;
 end loop;
 update clinic_finance.shifts set counted=total,denominations=p_counts,note=left(coalesce(p_note,''),1000),status='submitted',closed_at=now() where id=p_shift;
 insert into clinic_finance.audit(actor,action,entity_id) values(me,'shift_submitted',p_shift);return p_shift;end $$;
create or replace function public.clinic_finance_review_shift(p_shift uuid,p_note text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('review');s clinic_finance.shifts%rowtype;
begin perform clinic_finance.lock_day();select * into s from clinic_finance.shifts where id=p_shift for update;
 if found and s.status='reviewed' and s.reviewed_by=me and s.review_note=trim(p_note) then return p_shift;end if;
 if not found or s.status<>'submitted' then raise exception 'الوردية غير جاهزة للمراجعة';end if;if s.cashier_id=me then raise exception 'لا يمكن مراجعة ورديتك بنفسك';end if;
 if length(trim(coalesce(p_note,'')))<3 then raise exception 'سجل نتيجة المراجعة حتى عند وجود فرق';end if;
 update clinic_finance.shifts set status='reviewed',review_note=trim(p_note),reviewed_by=me,reviewed_at=now() where id=p_shift;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'shift_reviewed',p_shift,jsonb_build_object('difference',s.counted-clinic_finance.shift_cash(p_shift),'note',trim(p_note)));return p_shift;end $$;
create or replace function public.clinic_finance_close_period(p_through date) returns date language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('review');
begin perform pg_advisory_xact_lock(927311);
 if p_through is null or p_through>=(now() at time zone 'Africa/Cairo')::date or p_through<=coalesce((select max(closed_through) from clinic_finance.periods),'-infinity'::date) then raise exception 'اختر تاريخا سابقا لليوم وبعد آخر إقفال';end if;
 if exists(select 1 from clinic_finance.shifts where status<>'reviewed' and (opened_at at time zone 'Africa/Cairo')::date<=p_through) or exists(select 1 from clinic_finance.requests where status='pending' and (created_at at time zone 'Africa/Cairo')::date<=p_through) then raise exception 'توجد ورديات أو طلبات لم تراجع';end if;
 insert into clinic_finance.periods values(p_through,me,now());insert into clinic_finance.audit(actor,action,detail) values(me,'period_closed',jsonb_build_object('through',p_through));return p_through;end $$;

create or replace function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('view');reviewer boolean:=clinic_finance.allowed('review');v jsonb;
begin
 if p_offset is null or p_offset<0 or p_offset>1000000 or p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'اختر فترة لا تتجاوز سنة';end if;
 select jsonb_build_object('can_create',clinic_finance.allowed('create'),'can_review',reviewer,'registers',(select coalesce(jsonb_agg(to_jsonb(r) order by name),'[]') from clinic_finance.registers r),
 'shifts',(select coalesce(jsonb_agg(x),'[]') from(select (to_jsonb(s)-'opening_book'-'counted'-'denominations')||jsonb_build_object('cashier_name',a.name,'register_name',r.name)||case when (reviewer and s.cashier_id<>me) or s.status<>'open' then jsonb_build_object('opening_book',s.opening_book,'counted',s.counted,'expected',clinic_finance.shift_cash(s.id),'difference',s.counted-clinic_finance.shift_cash(s.id),'denominations',s.denominations) else '{}'::jsonb end x from clinic_finance.shifts s join public.admins a on a.id=s.cashier_id join clinic_finance.registers r on r.id=s.register_id where (reviewer or s.cashier_id=me) and (s.status<>'reviewed' or (s.opened_at at time zone 'Africa/Cairo')::date between p_from and p_to) order by s.opened_at desc,s.id desc limit 200 offset p_offset)t),
 'invoices',(select coalesce(jsonb_agg(x),'[]') from(select to_jsonb(i)||jsonb_build_object('collected',(select coalesce(sum(amount),0) from clinic_finance.payments where invoice_id=i.id),'refunded',(select coalesce(sum(amount),0) from clinic_finance.requests where invoice_id=i.id and kind='refund' and status='approved')) x from clinic_finance.invoices i where (reviewer or i.created_by=me) and (i.created_at at time zone 'Africa/Cairo')::date between p_from and p_to order by i.created_at desc,i.id desc limit 200 offset p_offset)t),
 'payments',(select coalesce(jsonb_agg(x),'[]') from(select to_jsonb(p)||jsonb_build_object('invoice_reference',i.reference,'refund_reserved',(select coalesce(sum(amount),0) from clinic_finance.requests where payment_id=p.id and kind='refund' and status in ('pending','approved'))) x from clinic_finance.payments p join clinic_finance.invoices i on i.id=p.invoice_id where (reviewer or p.created_by=me) and (p.created_at at time zone 'Africa/Cairo')::date between p_from and p_to order by p.created_at desc,p.id desc limit 200 offset p_offset)t),
 'requests',(select coalesce(jsonb_agg(x),'[]') from(select to_jsonb(r)||jsonb_build_object('creator_name',a.name) x from clinic_finance.requests r join public.admins a on a.id=r.created_by where (reviewer or r.created_by=me) and (r.status='pending' or (r.created_at at time zone 'Africa/Cairo')::date between p_from and p_to) order by r.created_at desc,r.id desc limit 200 offset p_offset)t),
 'accounts',case when reviewer then(select jsonb_agg(to_jsonb(a) order by code) from clinic_finance.accounts a) else '[]'::jsonb end,
 'trial',case when reviewer then(select coalesce(jsonb_agg(x),'[]') from(select a.code,a.name,a.kind,coalesce(sum(l.debit) filter(where e.business_date between p_from and p_to),0) as debit,coalesce(sum(l.credit) filter(where e.business_date between p_from and p_to),0) as credit,coalesce(sum(l.debit-l.credit) filter(where e.business_date<p_from),0) as opening,coalesce(sum(l.debit-l.credit) filter(where e.business_date<=p_to),0) as balance from clinic_finance.accounts a left join clinic_finance.lines l on l.account=a.code left join clinic_finance.entries e on e.id=l.entry_id group by a.code,a.name,a.kind order by a.code)x) else '[]'::jsonb end,
 'entries',case when reviewer then(select coalesce(jsonb_agg(x),'[]') from(select to_jsonb(e)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(l)||jsonb_build_object('account_name',a.name) order by l.debit desc) from clinic_finance.lines l join clinic_finance.accounts a on a.code=l.account where l.entry_id=e.id)) x from clinic_finance.entries e where e.business_date between p_from and p_to order by e.created_at desc,e.id desc limit 200 offset p_offset)t) else '[]'::jsonb end,
 'audit',case when reviewer then(select coalesce(jsonb_agg(x),'[]') from(select to_jsonb(a)||jsonb_build_object('actor_name',u.name) x from clinic_finance.audit a join public.admins u on u.id=a.actor where (a.created_at at time zone 'Africa/Cairo')::date between p_from and p_to order by a.id desc limit 200 offset p_offset)t) else '[]'::jsonb end,
 'active_shifts',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'cashier_id',s.cashier_id,'status',s.status,'register_name',r.name,'opened_at',s.opened_at)),'[]') from clinic_finance.shifts s join clinic_finance.registers r on r.id=s.register_id where s.cashier_id=me and s.status='open'),
 'offset',p_offset,'closed_through',(select max(closed_through) from clinic_finance.periods),'me',me,'today',(now() at time zone 'Africa/Cairo')::date,'row_limit',200) into v;return v;
end $$;
-- Private helpers and tables cannot be called/read directly by clients.
revoke all on all functions in schema clinic_finance from public,anon,authenticated;
do $$ declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'clinic_finance_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to authenticated',f.sig);end loop;end $$;
commit;
