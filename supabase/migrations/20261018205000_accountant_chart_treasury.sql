begin;
alter table clinic_finance.account_config add column is_postable boolean not null default true;
create function clinic_finance.account_level(p_code text) returns integer language sql stable security definer set search_path=pg_catalog,public as $$
 with recursive parents(code,parent_code,depth) as(select code,parent_code,1 from clinic_finance.account_config where code=p_code union all select a.code,a.parent_code,p.depth+1 from clinic_finance.account_config a join parents p on a.code=p.parent_code where p.depth<7) select coalesce(max(depth),0) from parents
$$;
create function clinic_finance.account_in_use(p_code text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from clinic_finance.lines where account=p_code) or exists(select 1 from clinic_finance.manual_batches b cross join lateral jsonb_array_elements(b.payload->'lines') x where b.status='pending' and x->>'account'=p_code) or exists(select 1 from clinic_finance.journal_drafts d cross join lateral jsonb_array_elements(d.payload->'lines') x where d.state='draft' and x->>'account'=p_code)$$;
create function clinic_finance.account_hierarchy_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare p clinic_finance.account_config%rowtype;level integer;subdepth integer;
begin
 if new.is_system and not new.is_postable then raise exception 'حساب النظام التشغيلي لا يتحول إلى تجميع؛ أضف حساب تجميع مستقلًا';end if;
 if new.parent_code is not null then
 select * into p from clinic_finance.account_config where code=new.parent_code;
 if not found or p.archived or not p.active or p.is_postable then raise exception 'الحساب الأب يجب أن يكون حساب تجميع مفعّلًا';end if;
 if (select kind from clinic_finance.accounts where code=new.code)<>(select kind from clinic_finance.accounts where code=new.parent_code) then raise exception 'نوع الحساب يجب أن يطابق الأب';end if;
 if new.parent_code=new.code or exists(with recursive chain(code,parent_code) as(select code,parent_code from clinic_finance.account_config where code=new.parent_code union select a.code,a.parent_code from clinic_finance.account_config a join chain on a.code=chain.parent_code)select 1 from chain where code=new.code) then raise exception 'الربط يصنع دائرة في الشجرة';end if;
 end if;
 level:=case when new.parent_code is null then 1 else clinic_finance.account_level(new.parent_code)+1 end;
 with recursive children(code,d) as(select code,0 from clinic_finance.account_config where code=new.code union all select a.code,c.d+1 from clinic_finance.account_config a join children c on a.parent_code=c.code where c.d<6)select coalesce(max(d),0) into subdepth from children;
 if level+subdepth>5 then raise exception 'الشجرة لا تتجاوز خمسة مستويات، بما فيها الحسابات التابعة';end if;
 if new.is_postable and exists(select 1 from clinic_finance.account_config where parent_code=new.code and not archived) then raise exception 'الحساب الذي له أبناء هو حساب تجميع وليس حساب حركة';end if;
 if not new.is_postable and clinic_finance.account_in_use(new.code) then raise exception 'الحساب مستخدم في حركات أو مسودات؛ لا يتحول إلى تجميع';end if;
 return new;
end $$;
create trigger account_hierarchy_guard before insert or update on clinic_finance.account_config for each row execute function clinic_finance.account_hierarchy_guard();
-- Retain the established concurrency, audit, deletion and protected-system rules.
do $$declare d text;begin
 d:=pg_get_functiondef('public.clinic_finance_ledger_command(text,jsonb,uuid)'::regprocedure);
 if position('^[1-9][0-9]{2,11}$' in d)=0 then raise exception 'Account code validation target changed';end if;
 d:=replace(d,'^[1-9][0-9]{2,11}$','^[0-9]{1,12}$');
 d:=replace(d,'set parent_code=parent,revision=ac.revision+1','set parent_code=parent,is_postable=coalesce((p_payload->>''is_postable'')::boolean,ac.is_postable),active=coalesce((p_payload->>''active'')::boolean,ac.active),revision=ac.revision+1');
 d:=replace(d,'update clinic_finance.accounts a set name=trim(p_payload->>''name''),kind=kind where a.code=code;', 'if not coalesce((p_payload->>''active'')::boolean,true) and (c.is_system or exists(select 1 from clinic_finance.account_config where parent_code=code and active and not archived)) then raise exception ''لا يمكن إيقاف حساب نظام أو حساب له أبناء مفعّلون'';end if; update clinic_finance.accounts a set name=trim(p_payload->>''name''),kind=kind where a.code=code;');
 execute d;
end $$;
alter table clinic_finance.registers add column treasury_kind text not null default 'unconfigured' check(treasury_kind in ('unconfigured','main','collection'));
alter table clinic_finance.registers add column account_code text references clinic_finance.accounts(code);
alter table clinic_finance.registers add column assigned_to uuid references public.admins(id);
alter table clinic_finance.registers add column parent_register_id uuid references clinic_finance.registers(id);
alter table clinic_finance.registers add column revision integer not null default 1;
create unique index treasury_one_main on clinic_finance.registers(treasury_kind) where treasury_kind='main';
create unique index treasury_unique_account on clinic_finance.registers(account_code) where account_code is not null;
create table clinic_finance.cash_accounts(code text primary key references clinic_finance.accounts(code));
insert into clinic_finance.cash_accounts values('1111');
create function clinic_finance.is_cash_account(p_code text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from clinic_finance.cash_accounts where code=p_code)$$;
create function clinic_finance.treasury_balance(p_register uuid) returns numeric language sql stable security definer set search_path=pg_catalog,public as $$select coalesce(sum(l.debit-l.credit),0) from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id join clinic_finance.shifts s on s.id=e.shift_id where s.register_id=p_register and clinic_finance.is_cash_account(l.account)$$;
create function clinic_finance.register_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if new.treasury_kind<>'unconfigured' then
 if new.account_code is null or not exists(select 1 from clinic_finance.accounts a join clinic_finance.account_config c on c.code=a.code where a.code=new.account_code and a.kind='asset' and c.active and not c.archived and c.is_postable) then raise exception 'اربط الخزينة بحساب أصل مفعّل يقبل الحركات';end if;
 if new.account_code='1111' then raise exception 'اختر حسابًا مستقلًا للخزينة؛ 1111 يحتفظ بالحركات السابقة';end if;
 if new.assigned_to is null or not exists(select 1 from public.admins where id=new.assigned_to and active) then raise exception 'اختر موظفًا مفعّلًا مسؤولًا عن الخزينة';end if;
 if new.treasury_kind='main' then new.parent_register_id:=null;new.operation_mode:='both';
 else
 if not exists(select 1 from clinic_finance.registers where id=new.parent_register_id and treasury_kind='main' and id<>new.id) then raise exception 'اختر الخزينة الرئيسية التي تستلم التحصيل';end if;
 new.operation_mode:='receive';new.petty_limit:=0;
 end if;
 if tg_op='UPDATE' and (new.account_code,new.treasury_kind,new.assigned_to,new.parent_register_id) is distinct from (old.account_code,old.treasury_kind,old.assigned_to,old.parent_register_id) then
 if exists(select 1 from clinic_finance.shifts where register_id=new.id and status<>'reviewed') then raise exception 'سلّم وراجع الوردية الحالية قبل تغيير ربط الخزينة';end if;
 if new.account_code is distinct from old.account_code and (clinic_finance.treasury_balance(new.id)<>0 or exists(select 1 from clinic_finance.lines where account=old.account_code)) then raise exception 'تغيير حساب خزينة لها رصيد أو حركات يحتاج تسوية مراجعة؛ لا نغيّر تاريخ القيود';end if;
 end if;
 insert into clinic_finance.cash_accounts values(new.account_code) on conflict do nothing;
 end if;
 if tg_op='UPDATE' and old.treasury_kind='main' and new.treasury_kind<>'main' and exists(select 1 from clinic_finance.registers where parent_register_id=old.id) then raise exception 'الرئيسية مرتبطة بخزن فرعية؛ انقل الربط أولًا';end if;
 if tg_op='UPDATE' then new.revision:=old.revision+1;end if;
 return new;
end $$;
create trigger treasury_register_guard before insert or update on clinic_finance.registers for each row execute function clinic_finance.register_guard();
create table clinic_finance.treasury_transfers(id uuid primary key default gen_random_uuid(),from_shift uuid not null references clinic_finance.shifts(id),to_register uuid not null references clinic_finance.registers(id),amount numeric(14,2) not null check(amount>0),reference text not null unique,reason text not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),reviewed_by uuid references public.admins(id),reviewed_at timestamptz,review_note text,to_shift uuid references clinic_finance.shifts(id));
insert into clinic_finance.accounts values('1119','وسيط تسليم الخزن الداخلي','asset') on conflict do nothing;
insert into clinic_finance.account_config(code,is_system) values('1119',true);
create or replace function clinic_finance.overhead_account(p_category text) returns text language sql stable security definer set search_path=pg_catalog,public as $$select coalesce(case p_category when 'electricity' then '5219' when 'water' then '5220' when 'gas' then '5222' when 'waste' then '5223' when 'other' then '5224' when 'rent' then '5225' end,(select a.code from clinic_finance.accounts a join clinic_finance.account_config c on c.code=a.code where p_category='account:'||a.code and a.kind='expense' and c.is_postable and c.active and not c.archived and not c.is_system))$$;
create function clinic_finance.shift_assignment_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$declare r clinic_finance.registers%rowtype;begin
 select * into r from clinic_finance.registers where id=new.register_id;
 if tg_op='INSERT' and r.treasury_kind='unconfigured' and exists(select 1 from clinic_finance.registers where treasury_kind='main') then raise exception 'راجع إعداد الخزينة واربط مسؤولها وحسابها قبل فتح وردية جديدة';end if;
 if tg_op='INSERT' and r.treasury_kind<>'unconfigured' and r.assigned_to<>new.cashier_id then raise exception 'الخزينة مخصصة لموظف آخر';end if;
 if tg_op='UPDATE' and new.status<>old.status and exists(select 1 from clinic_finance.treasury_transfers where from_shift=new.id and status='pending') then raise exception 'استكمل تسليم الخزينة أو ارفض الطلب قبل إغلاق الوردية';end if;
 return new;
end $$;
create trigger treasury_shift_assignment before insert or update on clinic_finance.shifts for each row execute function clinic_finance.shift_assignment_guard();
create function clinic_finance.cash_line_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$declare e clinic_finance.entries%rowtype;r clinic_finance.registers%rowtype;begin
 select * into e from clinic_finance.entries where id=new.entry_id;
 if clinic_finance.is_cash_account(new.account) and e.shift_id is not null then
 select x.* into r from clinic_finance.registers x join clinic_finance.shifts s on s.register_id=x.id where s.id=e.shift_id;
 if new.account='1111' and r.account_code is not null then new.account:=r.account_code;end if;
 if new.credit>0 and r.treasury_kind<>'main' and exists(select 1 from clinic_finance.registers where treasury_kind='main') and e.source<>'treasury_transfer_out' then raise exception 'الصرف من الخزينة الرئيسية فقط؛ خزينة الاستقبال للتحصيل والتسليم';end if;
 end if;
 if exists(select 1 from clinic_finance.account_config where code=new.account and (not is_postable or ((not active or archived) and e.source<>'manual_reversal'))) then raise exception 'الحساب موقوف أو تجميعي ولا يقبل حركات';end if;
 return new;
end $$;
create trigger treasury_cash_line before insert on clinic_finance.lines for each row execute function clinic_finance.cash_line_guard();
-- Every cash calculation must include both preserved legacy cash and assigned accounts.
do $$declare f record;d text;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('clinic_finance','public','clinic_reception') and p.prokind='f' and p.proname in ('cash_limit','shift_cash','clinic_finance_open_shift','clinic_booking_shift','clinic_finance_reports','register_cash') loop
 d:=pg_get_functiondef(f.oid);d:=replace(d,'l.account=''1111''','clinic_finance.is_cash_account(l.account)');d:=replace(d,'l.account in (''1111'',''1112'',''1115'')','(clinic_finance.is_cash_account(l.account) or l.account in (''1112'',''1115''))');execute d;
 end loop;
end $$;
alter function clinic_finance.check_chart_lines(jsonb,boolean) rename to hierarchy_check_lines_base;
create function clinic_finance.check_chart_lines(p_payload jsonb,p_reversal boolean default false) returns void language plpgsql security definer set search_path=pg_catalog,public as $$declare j jsonb;begin
 perform clinic_finance.hierarchy_check_lines_base(p_payload,p_reversal);
 for j in select value from jsonb_array_elements(coalesce(p_payload->'lines','[]')) loop
 if not p_reversal and exists(select 1 from clinic_finance.account_config where code=j->>'account' and not is_postable) then raise exception 'حساب التجميع لا يقبل قيدًا؛ اختر حساب حركة';end if;
 if exists(select 1 from clinic_finance.cash_accounts where code=j->>'account' and code<>'1111') or j->>'account'='1119' then raise exception 'حساب خزينة تشغيلي؛ استخدم التحصيل أو الصرف أو التسليم من مصدر العملية';end if;
 end loop;
end $$;
create function clinic_finance.bound_account_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if exists(select 1 from clinic_finance.registers where account_code=new.code) and (new.archived or not new.active or not new.is_postable) then raise exception 'الحساب مربوط بخزينة؛ لا يمكن إيقافه أو تحويله لتجميع';end if;return new;
end $$;
create trigger treasury_account_guard before update on clinic_finance.account_config for each row execute function clinic_finance.bound_account_guard();
create function clinic_finance.bound_account_kind_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin if new.kind<>'asset' and exists(select 1 from clinic_finance.registers where account_code=old.code) then raise exception 'حساب الخزينة يبقى من نوع الأصول';end if;return new;end $$;
create trigger treasury_account_kind before update on clinic_finance.accounts for each row execute function clinic_finance.bound_account_kind_guard();
create function public.clinic_finance_treasury_command(p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.booking_access('create');op clinic_finance.journal_operations%rowtype;r clinic_finance.registers%rowtype;t clinic_finance.treasury_transfers%rowtype;s clinic_finance.shifts%rowtype;target clinic_finance.shifts%rowtype;v uuid;entry uuid;result jsonb;amount numeric;reserved numeric;j jsonb;idx integer;
begin
 if p_token is null then raise exception 'مفتاح العملية مطلوب';end if;if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>400000 then raise exception 'بيانات الطلب غير صالحة';end if;perform clinic_finance.lock_day();
 select * into op from clinic_finance.journal_operations where actor=me and token=p_token;
 if found then if op.action<>'treasury_'||p_action or op.payload<>p_payload then raise exception 'مفتاح مستخدم لبيانات أخرى';end if;return op.result;end if;
 if p_action='register_save' then
 amount:=coalesce((p_payload->>'limit')::numeric,0);if amount<0 or amount>100000 or amount<>round(amount,2) or amount::text in ('NaN','Infinity','-Infinity') then raise exception 'حد النثريات غير صالح';end if;
 perform clinic_finance.require_access('review');
 if nullif(p_payload->>'id','') is null then
 insert into clinic_finance.registers(name,petty_limit,created_by,treasury_kind,account_code,assigned_to,parent_register_id) values(trim(p_payload->>'name'),coalesce((p_payload->>'limit')::numeric,0),me,p_payload->>'treasury_kind',p_payload->>'account_code',(p_payload->>'assigned_to')::uuid,nullif(p_payload->>'parent_register_id','')::uuid) returning * into r;
 else
 select * into r from clinic_finance.registers where id=(p_payload->>'id')::uuid for update;
 if not found or r.revision is distinct from (p_payload->>'revision')::integer then raise exception 'إعدادات الخزينة تغيرت؛ حدّث الشاشة';end if;
 update clinic_finance.registers set name=trim(p_payload->>'name'),petty_limit=coalesce((p_payload->>'limit')::numeric,0),treasury_kind=p_payload->>'treasury_kind',account_code=p_payload->>'account_code',assigned_to=(p_payload->>'assigned_to')::uuid,parent_register_id=nullif(p_payload->>'parent_register_id','')::uuid where id=r.id returning * into r;
 end if;result:=to_jsonb(r);
 elsif p_action='transfer_request' then
 select * into s from clinic_finance.shifts where id=(p_payload->>'from_shift')::uuid for update;
 if not found or s.cashier_id<>me or s.status<>'open' then raise exception 'اختر ورديتك المفتوحة للتسليم';end if;
 select * into r from clinic_finance.registers where id=(p_payload->>'to_register')::uuid and treasury_kind='main' and id<>s.register_id;
 if not found then raise exception 'التسليم إلى الخزينة الرئيسية فقط';end if;
 amount:=(p_payload->>'amount')::numeric;
 select coalesce(sum(x.amount),0) into reserved from clinic_finance.treasury_transfers x where x.from_shift=s.id and x.status='pending';
 if amount is null or amount<=0 or amount<>round(amount,2) or amount::text in ('NaN','Infinity','-Infinity') or amount+reserved>clinic_finance.cash_limit(s.id) then raise exception 'المبلغ يتجاوز النقد المتاح بعد حجوزات التسليم';end if;
 if length(trim(coalesce(p_payload->>'reason','')))<3 or length(trim(coalesce(p_payload->>'reference','')))<2 then raise exception 'اكتب سبب التسليم ورقم مستنده';end if;
 insert into clinic_finance.treasury_transfers(from_shift,to_register,amount,reference,reason,created_by) values(s.id,r.id,amount,trim(p_payload->>'reference'),trim(p_payload->>'reason'),me) returning * into t;result:=to_jsonb(t);
 elsif p_action='transfer_review' then
 perform clinic_finance.require_access('review');
 select * into t from clinic_finance.treasury_transfers where id=(p_payload->>'id')::uuid for update;
 if not found or t.status<>'pending' or t.created_by=me then raise exception 'طلب التسليم يحتاج مراجعًا آخر ولم يراجع سابقًا';end if;
 if length(trim(coalesce(p_payload->>'note','')))<3 or p_payload->>'approve' not in ('true','false') then raise exception 'حدد القرار وسجل ملاحظة الاستلام';end if;
 if (p_payload->>'approve')::boolean then
 select * into s from clinic_finance.shifts where id=t.from_shift and status='open' for update;
 if not found or t.amount>clinic_finance.cash_limit(s.id) then raise exception 'الوردية أغلقت أو النقد المتاح تغير';end if;
 select * into target from clinic_finance.shifts where register_id=t.to_register and status='open' and cashier_id=me for update;
 if not found then raise exception 'افتح وردية الخزينة الرئيسية باسم المستلم قبل الاعتماد';end if;
 insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('treasury_transfer_out',t.id,'تسليم خزينة '||t.reference,s.id,me) returning id into entry;
 insert into clinic_finance.lines(entry_id,account,debit,credit) values(entry,'1119',t.amount,0),(entry,'1111',0,t.amount);
 insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('treasury_transfer_in',t.id,'استلام خزينة '||t.reference,target.id,me) returning id into entry;
 insert into clinic_finance.lines(entry_id,account,debit,credit) values(entry,'1111',t.amount,0),(entry,'1119',0,t.amount);
 end if;
 update clinic_finance.treasury_transfers set status=case when (p_payload->>'approve')::boolean then 'approved' else 'rejected' end,reviewed_by=me,reviewed_at=now(),review_note=trim(p_payload->>'note'),to_shift=target.id where id=t.id returning * into t;result:=to_jsonb(t);
 elsif p_action='chart_import' then
 perform clinic_finance.require_access('review');
 if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 500 or octet_length(p_payload::text)>400000 then raise exception 'اختر شجرة من 1 إلى 500 حساب';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'rows')x group by x->>'code' having count(*)>1) then raise exception 'يوجد كود حساب مكرر في الملف';end if;
 for j in select value from jsonb_array_elements(p_payload->'rows') order by (value->>'level')::integer loop
 if coalesce(j->>'code','')!~'^[0-9]{1,12}$' or coalesce((j->>'level')::integer,0) not between 1 and 5 or length(trim(coalesce(j->>'name',''))) not between 2 and 120 or coalesce(j->>'kind','') not in ('asset','liability','equity','income','expense') or coalesce(j->>'is_postable','') not in ('true','false') then raise exception 'بيانات حساب غير صالحة: %',j->>'code';end if;
 if exists(select 1 from clinic_finance.accounts where code=j->>'code') then raise exception 'الحساب % موجود بالفعل؛ الاستيراد لا يستبدل الحسابات الحالية',j->>'code';end if;
 if (j->>'level')::integer<>(case when nullif(j->>'parent_code','') is null then 1 else clinic_finance.account_level(j->>'parent_code')+1 end) then raise exception 'راجع مستوى الحساب والأب: %',j->>'code';end if;
 if nullif(j->>'parent_code','') is not null and left(j->>'code',length(j->>'parent_code'))<>j->>'parent_code' then raise exception 'كود الحساب % لا يتبع كود أبيه %؛ صحح المعاينة قبل الحفظ',j->>'code',j->>'parent_code';end if;
 insert into clinic_finance.accounts values(j->>'code',trim(j->>'name'),j->>'kind');
 insert into clinic_finance.account_config(code,parent_code,is_postable) values(j->>'code',nullif(j->>'parent_code',''),(j->>'is_postable')::boolean);
 end loop;result:=jsonb_build_object('imported',jsonb_array_length(p_payload->'rows'));
 else raise exception 'إجراء غير معروف';end if;
 insert into clinic_finance.journal_operations values(me,p_token,'treasury_'||p_action,p_payload,result,now());
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'treasury_'||p_action,t.id,jsonb_build_object('payload',p_payload,'result',result));return result;
end $$;
-- Filter source snapshots as well as the outer snapshot. Reception remains scoped to its cashier.
alter function public.clinic_booking_snapshot(date,date) set schema clinic_finance;
alter function clinic_finance.clinic_booking_snapshot(date,date) rename to treasury_booking_snapshot_base;
create function public.clinic_booking_snapshot(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb:=clinic_finance.treasury_booking_snapshot_base(p_from,p_to);begin
 v:=v||jsonb_build_object('treasury_main',(select jsonb_build_object('id',id,'name',name) from clinic_finance.registers where treasury_kind='main'),'treasury_transfers',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('from_register',r.name,'to_register_name',rt.name) order by t.created_at desc),'[]') from clinic_finance.treasury_transfers t join clinic_finance.shifts sh on sh.id=t.from_shift join clinic_finance.registers r on r.id=sh.register_id join clinic_finance.registers rt on rt.id=t.to_register where t.created_by=public.my_admin_id() and (t.status='pending' or (t.created_at at time zone 'Africa/Cairo')::date between p_from and p_to)));
 v:=jsonb_set(v,'{shifts}',(select coalesce(jsonb_agg(x||jsonb_build_object('cashier_id',sh.cashier_id,'register_id',sh.register_id)),'[]') from jsonb_array_elements(v->'shifts') x join clinic_finance.shifts sh on sh.id=(x->>'id')::uuid));
 return jsonb_set(v,'{registers}',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(v->'registers')x join clinic_finance.registers r on r.id=(x->>'id')::uuid where clinic_finance.allowed('review') or r.assigned_to=public.my_admin_id() or (r.treasury_kind='unconfigured' and not exists(select 1 from clinic_finance.registers where treasury_kind='main')) or exists(select 1 from clinic_finance.shifts sh where sh.register_id=r.id and sh.cashier_id=public.my_admin_id() and sh.status<>'reviewed')));
end $$;
alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance;
alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to treasury_snapshot_base;
create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb:=clinic_finance.treasury_snapshot_base(p_from,p_to,p_offset);reviewer boolean:=clinic_finance.allowed('review');begin
 v:=jsonb_set(v,'{registers}',(select coalesce(jsonb_agg(to_jsonb(r)||case when reviewer then jsonb_build_object('balance',clinic_finance.treasury_balance(r.id)) else '{}'::jsonb end order by r.name),'[]') from clinic_finance.registers r where reviewer or r.assigned_to=public.my_admin_id() or (r.treasury_kind='unconfigured' and not exists(select 1 from clinic_finance.registers where treasury_kind='main')) or exists(select 1 from clinic_finance.shifts sh where sh.register_id=r.id and sh.cashier_id=public.my_admin_id() and sh.status<>'reviewed')));
 if reviewer then v:=jsonb_set(v,'{finance_accounts}',(select coalesce(jsonb_agg(to_jsonb(a)||to_jsonb(c)||jsonb_build_object('level',clinic_finance.account_level(a.code),'used',clinic_finance.account_in_use(a.code)) order by a.code),'[]') from clinic_finance.accounts a join clinic_finance.account_config c on c.code=a.code));end if;
 return v||jsonb_build_object('treasury_staff',case when reviewer then(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.admins where active) else '[]'::jsonb end,'treasury_main',(select jsonb_build_object('id',id,'name',name) from clinic_finance.registers where treasury_kind='main'),'treasury_transfers',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('from_register',r.name,'to_register_name',rt.name) order by t.created_at desc),'[]') from clinic_finance.treasury_transfers t join clinic_finance.shifts s on s.id=t.from_shift join clinic_finance.registers r on r.id=s.register_id join clinic_finance.registers rt on rt.id=t.to_register where (reviewer or t.created_by=public.my_admin_id()) and (t.status='pending' or (t.created_at at time zone 'Africa/Cairo')::date between p_from and p_to)));
end $$;
do $patch$begin
 if to_regprocedure('public.clinic_reception_snapshot(uuid,date,date)') is not null then
 execute 'alter function public.clinic_reception_snapshot(uuid,date,date) set schema clinic_finance';
 execute 'alter function clinic_finance.clinic_reception_snapshot(uuid,date,date) rename to treasury_reception_snapshot_base';
 execute $def$create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare v jsonb:=clinic_finance.treasury_reception_snapshot_base(p_workspace,p_from,p_to);begin
 if v->'workspace'->>'mode'='live' and not coalesce((v->>'can_manage')::boolean,false) then
 v:=jsonb_set(v,'{registers}',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(v->'registers')x join clinic_reception.registers rx on rx.id=(x->>'id')::uuid join clinic_finance.registers r on r.id=rx.finance_register_id where r.assigned_to=public.my_admin_id() or (r.treasury_kind='unconfigured' and not exists(select 1 from clinic_finance.registers where treasury_kind='main'))));
 end if;return v;end $$;$def$;
 execute 'revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon';execute 'grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated';
 end if;
end $patch$;
alter table clinic_finance.cash_accounts enable row level security;
alter table clinic_finance.treasury_transfers enable row level security;
revoke all on clinic_finance.cash_accounts,clinic_finance.treasury_transfers from public,anon,authenticated;
revoke all on all functions in schema clinic_finance from public,anon,authenticated;
revoke all on function public.clinic_finance_treasury_command(text,jsonb,uuid),public.clinic_booking_snapshot(date,date),public.clinic_finance_snapshot(date,date,integer) from public,anon;
grant execute on function public.clinic_finance_treasury_command(text,jsonb,uuid),public.clinic_booking_snapshot(date,date),public.clinic_finance_snapshot(date,date,integer) to authenticated;
commit;
