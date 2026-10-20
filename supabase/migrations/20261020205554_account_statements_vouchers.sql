begin;
create table clinic_finance.cash_vouchers(
 id uuid primary key default gen_random_uuid(),voucher_no bigint generated always as identity unique,
 kind text not null check(kind in('receive','pay')),account text not null references clinic_finance.accounts(code),
 shift_id uuid not null references clinic_finance.shifts(id),gross numeric(14,2) not null check(gross>0),
 withheld numeric(14,2) not null default 0 check(withheld>=0 and withheld<gross),
 reference text not null unique check(length(trim(reference)) between 2 and 120),
 description text not null check(length(trim(description)) between 2 and 1000),
 recipient text not null check(length(trim(recipient)) between 2 and 200),branch text not null default '' check(length(branch)<=120),
 created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in('pending','approved','rejected')),
 reviewed_by uuid references public.admins(id),reviewed_at timestamptz,review_note text,
 check(kind='pay' or withheld=0));
alter table clinic_finance.cash_vouchers enable row level security;
revoke all on clinic_finance.cash_vouchers from public,anon,authenticated;
-- Read directly from the posted journal, independently of snapshot pagination.
create function public.clinic_finance_account_statement(p_code text,p_from date,p_to date,p_children boolean default true,p_register uuid default null,p_offset integer default 0,p_limit integer default 200,p_asof bigint default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;v_code text:=p_code;cutoff bigint;begin
 perform clinic_finance.require_access('review');
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 or p_offset<0 or p_limit<1 or p_limit>500 then raise exception 'راجع الفترة ورقم الصفحة';end if;
 if p_register is not null then select account_code into v_code from clinic_finance.registers where id=p_register;if not found or v_code is null then raise exception 'الخزينة غير مربوطة بحساب';end if;end if;
 if v_code is null or not exists(select 1 from clinic_finance.accounts where code=v_code) then raise exception 'اختر حسابًا موجودًا';end if;
 select coalesce(max(event_no),0) into cutoff from clinic_finance.entries;cutoff:=least(cutoff,coalesce(p_asof,cutoff));if cutoff<0 then raise exception 'نسخة الكشف غير صالحة';end if;
 with recursive codes(code) as (
 select v_code union select c.code from clinic_finance.account_config c join codes a on c.parent_code=a.code where p_children and p_register is null
 ), opening as (
 select coalesce(sum(l.debit-l.credit),0) amount from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where l.account in(select code from codes) and e.business_date<p_from and e.event_no<=cutoff
 ), movements as (
 select e.id entry_id,e.source_id,e.source,e.event_no,e.business_date,e.description,e.created_by,e.created_at,e.shift_id,l.account,sum(l.debit) debit,sum(l.credit) credit
 from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where l.account in(select code from codes) and e.business_date between p_from and p_to and e.event_no<=cutoff
 group by e.id,l.account
 ), ordered as (
 select m.*,row_number() over(order by business_date,event_no,entry_id,account) serial,
 (select amount from opening)+sum(debit-credit) over(order by business_date,event_no,entry_id,account rows unbounded preceding) balance from movements m
 ), page as (
 select o.*,a.name account_name,ad.name actor_name,r.name register_name,
 coalesce(v.reference,dp.reference,py.reference,inv.reference,req.evidence,mb.reference,tt.reference,o.description) reference,
 coalesce(dp.gross,v.gross) gross,coalesce(dp.withheld,v.withheld) withheld,v.branch,coalesce(v.recipient,dp.doctor_key) recipient,
 coalesce((select string_agg(distinct ac.code||' — '||ac.name,'، ') from clinic_finance.lines z join clinic_finance.accounts ac on ac.code=z.account where z.entry_id=o.entry_id and z.account<>o.account),'') counterpart
 from ordered o join clinic_finance.accounts a on a.code=o.account left join public.admins ad on ad.id=o.created_by
 left join clinic_finance.shifts s on s.id=o.shift_id left join clinic_finance.registers r on r.id=s.register_id
 left join clinic_finance.cash_vouchers v on v.id=o.source_id and o.source in('cash_voucher','cash_voucher_withholding')
 left join clinic_finance.doctor_payouts dp on dp.id=o.source_id and o.source in('doctor_payment','doctor_withholding')
 left join clinic_finance.payments py on py.id=o.source_id and o.source='collection'
 left join clinic_finance.invoices inv on inv.id=o.source_id and o.source='invoice'
 left join clinic_finance.requests req on req.id=o.source_id
 left join clinic_finance.manual_batches mb on mb.id=o.source_id
 left join clinic_finance.treasury_transfers tt on tt.id=o.source_id
 order by o.serial limit p_limit offset p_offset
 )
 select jsonb_build_object('code',v_code,'name',(select name from clinic_finance.accounts where code=v_code),'kind',(select kind from clinic_finance.accounts where code=v_code),'register_id',p_register,'register_name',(select name from clinic_finance.registers where id=p_register),'from',p_from,'to',p_to,'asof',cutoff,'offset',p_offset,'count',(select count(*) from movements),'opening',(select amount from opening),'debit',(select coalesce(sum(debit),0) from movements),'credit',(select coalesce(sum(credit),0) from movements),'closing',(select amount from opening)+(select coalesce(sum(debit-credit),0) from movements),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by serial) from page),'[]')) into result;
 return result;
end $$;
-- Operational subledgers continue through their existing guarded workflows.
create function clinic_finance.check_voucher_account(p_code text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if not exists(select 1 from clinic_finance.accounts a join clinic_finance.account_config c on c.code=a.code where a.code=p_code and c.active and not c.archived and c.is_postable) then raise exception 'اختر حساب حركة مفعّل';end if;
 if exists(select 1 from clinic_finance.account_config where code=p_code and is_system) then raise exception 'حساب ترحيل آلي؛ استخدم قسم العملية المرتبط به';end if;
 if exists(with recursive ancestors(code) as(select p_code union select c.parent_code from clinic_finance.account_config c join ancestors a on c.code=a.code where c.parent_code is not null) select 1 from ancestors a where a.code in('1111','1112','1114','1115','1119','1122','1121','1131','1142','1211','1291','1292','2111','2120','2131','2141','2144','2150','3199') or exists(select 1 from clinic_finance.cash_accounts c where c.code=a.code)) then raise exception 'هذا الحساب مرتبط بدورة تشغيلية؛ استخدم زر الطبيب أو المورد أو الرواتب أو البنك أو التحصيل أو الضرائب لحفظ ربط الرصيد';end if;
 perform clinic_finance.check_chart_lines(jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('account',p_code))));
end $$;
create function public.clinic_finance_cash_voucher_command(p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;op clinic_finance.journal_operations%rowtype;r clinic_finance.cash_vouchers%rowtype;v jsonb;net numeric;approved boolean;begin
 me:=clinic_finance.require_access(case when p_action='review' then 'review' else 'create' end);perform clinic_finance.lock_day();perform pg_advisory_xact_lock(927311);
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'طلب غير صالح';end if;
 select * into op from clinic_finance.journal_operations where actor=me and token=p_token;
 if found then if op.action<>'cash_voucher_'||p_action or op.payload<>p_payload then raise exception 'مفتاح مكرر لطلب مختلف';end if;return op.result;end if;
 if p_action='create' then
 perform clinic_finance.check_voucher_account(p_payload->>'account');perform clinic_finance.check_shift((p_payload->>'shift_id')::uuid,true);
 if not exists(select 1 from clinic_finance.shifts s join clinic_finance.registers reg on reg.id=s.register_id where s.id=(p_payload->>'shift_id')::uuid and reg.treasury_kind='main') then raise exception 'سندات الحسابات من الخزينة الرئيسية فقط';end if;
 if (p_payload->>'gross')::numeric::text in('NaN','Infinity','-Infinity') or (p_payload->>'gross')::numeric<>round((p_payload->>'gross')::numeric,2) or coalesce((p_payload->>'withheld')::numeric,0)::text in('NaN','Infinity','-Infinity') or coalesce((p_payload->>'withheld')::numeric,0)<>round(coalesce((p_payload->>'withheld')::numeric,0),2) then raise exception 'المبلغ يجب أن يكون رقمًا بمنزلتين عشريتين';end if;
 insert into clinic_finance.cash_vouchers(kind,account,shift_id,gross,withheld,reference,description,recipient,branch,created_by) values(p_payload->>'kind',p_payload->>'account',(p_payload->>'shift_id')::uuid,(p_payload->>'gross')::numeric,coalesce((p_payload->>'withheld')::numeric,0),trim(p_payload->>'reference'),trim(p_payload->>'description'),trim(p_payload->>'recipient'),trim(coalesce(p_payload->>'branch','')),me) returning * into r;
 elsif p_action='review' then
 select * into r from clinic_finance.cash_vouchers where id=(p_payload->>'id')::uuid for update;
 if not found or r.status<>'pending' or r.created_by=me then raise exception 'المراجعة لمستخدم آخر ولسند قيد المراجعة فقط';end if;
 approved:=(p_payload->>'approve')::boolean;if approved is null or length(trim(coalesce(p_payload->>'note','')))<2 then raise exception 'حدد القرار وسبب المراجعة';end if;
 if approved then
 perform clinic_finance.check_voucher_account(r.account);perform clinic_finance.check_shift(r.shift_id,false);net:=r.gross-r.withheld;
 perform clinic_finance.post('cash_voucher',r.id,case r.kind when 'receive' then 'قبض — ' else 'صرف — ' end||r.reference||' — '||r.description,r.shift_id,case r.kind when 'receive' then '1111' else r.account end,case r.kind when 'receive' then r.account else '1111' end,net);
 if r.withheld>0 then perform clinic_finance.post('cash_voucher_withholding',r.id,'استقطاع — '||r.reference,null,r.account,'2141',r.withheld);end if;
 end if;
 update clinic_finance.cash_vouchers set status=case when approved then 'approved' else 'rejected' end,reviewed_by=me,reviewed_at=now(),review_note=left(p_payload->>'note',1000) where id=r.id returning * into r;
 else raise exception 'إجراء غير معروف';end if;
 v:=to_jsonb(r);insert into clinic_finance.journal_operations(actor,token,action,payload,result) values(me,p_token,'cash_voucher_'||p_action,p_payload,v);
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'cash_voucher_'||p_action,r.id,jsonb_build_object('status',r.status,'reference',r.reference));return v;
end $$;
create function public.clinic_finance_cash_vouchers(p_from date,p_to date,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 perform clinic_finance.require_access('view');if p_from is null or p_to is null or p_to<p_from or p_offset<0 then raise exception 'راجع الفترة';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select v.*,a.name account_name,s.register_id,r.name register_name,ad.name creator_name,rev.name reviewer_name from clinic_finance.cash_vouchers v join clinic_finance.accounts a on a.code=v.account join clinic_finance.shifts s on s.id=v.shift_id join clinic_finance.registers r on r.id=s.register_id left join public.admins ad on ad.id=v.created_by left join public.admins rev on rev.id=v.reviewed_by where (clinic_finance.allowed('review') or v.created_by=public.my_admin_id()) and (v.created_at at time zone 'Africa/Cairo')::date between p_from and p_to order by v.created_at desc,v.id limit 200 offset p_offset)x),'[]');
end $$;
revoke all on function clinic_finance.check_voucher_account(text) from public,anon,authenticated;
revoke all on function public.clinic_finance_account_statement(text,date,date,boolean,uuid,integer,integer,bigint) from public,anon;
revoke all on function public.clinic_finance_cash_voucher_command(text,jsonb,uuid) from public,anon;
revoke all on function public.clinic_finance_cash_vouchers(date,date,integer) from public,anon;
grant execute on function public.clinic_finance_account_statement(text,date,date,boolean,uuid,integer,integer,bigint),public.clinic_finance_cash_voucher_command(text,jsonb,uuid),public.clinic_finance_cash_vouchers(date,date,integer) to authenticated;
alter function public.clinic_finance_entry_origin(uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_entry_origin(uuid) rename to statement_origin_base;
revoke all on function clinic_finance.statement_origin_base(uuid) from public,anon,authenticated;
create function public.clinic_finance_entry_origin(p_entry uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb;begin
 perform clinic_finance.require_access('review');
 select to_jsonb(c)||jsonb_build_object('register_name',r.name,'account_name',a.name,'creator_name',ad.name,'reviewer_name',rev.name) into v from clinic_finance.entries e join clinic_finance.cash_vouchers c on c.id=e.source_id join clinic_finance.accounts a on a.code=c.account join clinic_finance.shifts s on s.id=c.shift_id join clinic_finance.registers r on r.id=s.register_id left join public.admins ad on ad.id=c.created_by left join public.admins rev on rev.id=c.reviewed_by where e.id=p_entry and e.source in('cash_voucher','cash_voucher_withholding');
 if v is not null then return jsonb_build_object('entry_id',p_entry,'reference',v->>'reference','section','requests','note','سند حساب معتمد','voucher',v);end if;
 return clinic_finance.statement_origin_base(p_entry);
end $$;
revoke all on function public.clinic_finance_entry_origin(uuid) from public,anon;
grant execute on function public.clinic_finance_entry_origin(uuid) to authenticated;
commit;
