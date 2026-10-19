begin;
alter table clinic_finance.registers add column responsible_role text check(responsible_role is null or responsible_role='financial_manager');
alter table clinic_finance.registers add column notes text not null default '' check(length(notes)<=1000);
alter table clinic_finance.shifts add column is_main boolean not null default false;
alter table clinic_finance.shifts add column ended_at timestamptz;
alter table clinic_finance.shifts add column end_counted numeric(14,2);
alter table clinic_finance.shifts add column end_expected numeric(14,2);
alter table clinic_finance.shifts add column end_counts jsonb;
update clinic_finance.shifts s set is_main=true from clinic_finance.registers r where r.id=s.register_id and r.treasury_kind='main';
drop index clinic_finance.fin_cashier_active;
create unique index fin_cashier_collection_active on clinic_finance.shifts(cashier_id) where status<>'reviewed' and not is_main;
create unique index fin_cashier_main_active on clinic_finance.shifts(cashier_id) where status<>'reviewed' and is_main;
create function clinic_finance.main_custodian() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select clinic_finance.allowed('review') and (public.has_role('financial_manager') or public.has_role('super_admin') or public.has_role('general_manager'))$$;
-- Preserve all chart checks, but never infer the hierarchy from account-code prefixes.
do $patch$declare d text;begin
 d:=pg_get_functiondef('public.clinic_finance_treasury_command(text,jsonb,uuid)'::regprocedure);
 d:=replace(d,$old$if nullif(j->>'parent_code','') is not null and left(j->>'code',length(j->>'parent_code'))<>j->>'parent_code' then raise exception 'كود الحساب % لا يتبع كود أبيه %؛ صحح المعاينة قبل الحفظ',j->>'code',j->>'parent_code';end if;$old$,'');
 -- Role-owned main treasury deliberately has no fixed employee owner.
 d:=replace(d,$old$(p_payload->>'assigned_to')::uuid$old$,$new$case when p_payload->>'treasury_kind'='main' then null else (p_payload->>'assigned_to')::uuid end$new$);
 d:=replace(d,$old$if not found or t.amount>clinic_finance.cash_limit(s.id) then$old$,$new$if not found or (s.ended_at is null and t.amount>clinic_finance.cash_limit(s.id)) or (s.ended_at is not null and t.amount<>s.end_counted) then$new$);
 execute d;
 d:=pg_get_functiondef('clinic_finance.register_guard()'::regprocedure);
 d:=replace(d,$old$if new.assigned_to is null or not exists(select 1 from public.admins where id=new.assigned_to and active) then$old$,$new$if new.treasury_kind<>'main' and (new.assigned_to is null or not exists(select 1 from public.admins where id=new.assigned_to and active)) then$new$);
 d:=replace(d,$old$if new.treasury_kind='main' then new.parent_register_id:=null;new.operation_mode:='both';$old$,$new$if new.treasury_kind='main' then new.responsible_role:='financial_manager';new.assigned_to:=null;new.parent_register_id:=null;new.operation_mode:='both';$new$);
 execute d;
 d:=pg_get_functiondef('clinic_finance.register_guard()'::regprocedure);
 d:=replace(d,$old$if exists(select 1 from clinic_finance.shifts where register_id=new.id and status<>'reviewed') then$old$,$new$if exists(select 1 from clinic_finance.shifts where register_id=new.id and status<>'reviewed') and not (old.treasury_kind='unconfigured' and old.account_code is null and new.treasury_kind='collection' and not exists(select 1 from clinic_finance.shifts where register_id=new.id and status<>'reviewed' and cashier_id<>new.assigned_to)) then$new$);
 d:=replace(d,$old$if new.account_code is distinct from old.account_code and (clinic_finance.treasury_balance(new.id)<>0 or exists(select 1 from clinic_finance.lines where account=old.account_code)) then$old$,$new$if new.account_code is distinct from old.account_code and not (old.treasury_kind='unconfigured' and old.account_code is null) and (clinic_finance.treasury_balance(new.id)<>0 or exists(select 1 from clinic_finance.lines where account=old.account_code)) then$new$);
 execute d;
end $patch$;
create function clinic_finance.initial_treasury_binding() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$declare balance numeric;eid uuid;begin
 if old.treasury_kind='unconfigured' and old.account_code is null and new.account_code is not null then
 perform clinic_finance.require_access('review');
 if exists(select 1 from clinic_finance.cash_accounts where code=new.account_code) or exists(select 1 from clinic_finance.lines where account=new.account_code) then raise exception 'حساب الربط الأول يجب أن يكون مستقلًا بلا حركات سابقة';end if;
 balance:=clinic_finance.treasury_balance(old.id);
 if balance<>0 then
 insert into clinic_finance.entries(source,source_id,description,created_by) values('treasury_binding',old.id,'ربط عهدة الخزينة بحساب مستقل مع حفظ التاريخ: '||new.name,public.my_admin_id()) returning id into eid;
 if balance>0 then insert into clinic_finance.lines(entry_id,account,debit,credit) values(eid,new.account_code,balance,0),(eid,'1111',0,balance);
 else insert into clinic_finance.lines(entry_id,account,debit,credit) values(eid,'1111',-balance,0),(eid,new.account_code,0,-balance);end if;
 end if;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(public.my_admin_id(),'treasury_first_binding',old.id,jsonb_build_object('old_account','1111','new_account',new.account_code,'balance',balance,'entry_id',eid));
 end if;return new;end $$;
create trigger a_treasury_first_binding before update on clinic_finance.registers for each row execute function clinic_finance.initial_treasury_binding();
create or replace function clinic_finance.shift_assignment_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$declare r clinic_finance.registers%rowtype;begin
 select * into r from clinic_finance.registers where id=new.register_id;
 if tg_op='INSERT' then
 new.is_main:=r.treasury_kind='main';
 if r.treasury_kind='main' then
 if new.cashier_id<>public.my_admin_id() or not clinic_finance.main_custodian() then raise exception 'الخزينة الرئيسية للمدير المالي أو الإدارة المخولة فقط' using errcode='42501';end if;
 elsif r.treasury_kind='unconfigured' and exists(select 1 from clinic_finance.registers where treasury_kind='main') then raise exception 'استكمل ربط خزينة التحصيل أولًا';
 elsif r.treasury_kind='collection' and r.assigned_to<>new.cashier_id then raise exception 'الخزينة مخصصة لموظف آخر' using errcode='42501';end if;
 end if;
 if tg_op='UPDATE' and new.status<>old.status and exists(select 1 from clinic_finance.treasury_transfers where from_shift=new.id and status='pending') then raise exception 'الوردية بانتظار تسليم واستلام الرئيسية';end if;
 if tg_op='UPDATE' and new.status='submitted' and old.status='open' and r.treasury_kind='collection' and clinic_finance.treasury_balance(r.id)<>0 and new.ended_at is null then raise exception 'أنهِ الوردية وسلّم النقد للرئيسية قبل الإغلاق';end if;
 return new;
end $$;
-- Freeze the ended shift against all new business events, including reception bridge events.
create function clinic_finance.ended_shift_entry_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if new.shift_id is not null and exists(select 1 from clinic_finance.shifts where id=new.shift_id and ended_at is not null) and new.source not in('treasury_transfer_out','treasury_binding') then raise exception 'انتهت الوردية وهي بانتظار التسليم؛ لا تسجل تحصيلًا جديدًا';end if;return new;end $$;
create trigger treasury_ended_entry before insert on clinic_finance.entries for each row execute function clinic_finance.ended_shift_entry_guard();
-- Wrap commands rather than bypassing the existing review, locking and idempotency rules.
alter function public.clinic_finance_treasury_command(text,jsonb,uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_treasury_command(text,jsonb,uuid) rename to handover_command_base;
create function public.clinic_finance_treasury_command(p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.booking_access('create');s clinic_finance.shifts%rowtype;t clinic_finance.treasury_transfers%rowtype;op clinic_finance.journal_operations%rowtype;j record;total numeric:=0;v jsonb;target uuid;expected numeric;begin
 perform clinic_finance.lock_day();
 if p_action='reopen_end' then
 if p_token is null then raise exception 'مفتاح العملية مطلوب';end if;
 select * into s from clinic_finance.shifts where id=(p_payload->>'shift_id')::uuid for update;
 if not found or s.cashier_id<>me or s.status<>'open' or s.ended_at is null or exists(select 1 from clinic_finance.treasury_transfers where from_shift=s.id and status='pending') or exists(select 1 from clinic_finance.treasury_transfers where from_shift=s.id and status='approved') then raise exception 'إعادة الجرد متاحة لصاحب الوردية بعد رفض التسليم فقط';end if;
 update clinic_finance.shifts set ended_at=null,end_counted=null,end_expected=null,end_counts=null where id=s.id;
 insert into clinic_finance.audit(actor,action,entity_id) values(me,'shift_recount_after_rejection',s.id);return jsonb_build_object('shift_id',s.id);
 end if;
 if p_action='transfer_request' and exists(select 1 from clinic_finance.shifts where id=(p_payload->>'from_shift')::uuid and ended_at is not null) then raise exception 'تسليم نهاية الوردية مسجل بالفعل';end if;
 if p_action<>'end_shift' then
 if exists(select 1 from clinic_finance.journal_operations where actor=me and token=p_token) then return clinic_finance.handover_command_base(p_action,p_payload,p_token);end if;
 v:=clinic_finance.handover_command_base(p_action,p_payload,p_token);
 if p_action='register_save' and p_payload ? 'notes' then update clinic_finance.registers set notes=left(coalesce(p_payload->>'notes',''),1000) where id=(v->>'id')::uuid;select to_jsonb(r) into v from clinic_finance.registers r where id=(v->>'id')::uuid;end if;
 if p_action='transfer_review' and (p_payload->>'approve')::boolean then
 select * into t from clinic_finance.treasury_transfers where id=(p_payload->>'id')::uuid;
 select * into s from clinic_finance.shifts where id=t.from_shift for update;
 if s.ended_at is not null and s.status='open' then
 update clinic_finance.shifts set status='submitted',closed_at=now(),counted=0,denominations='{"1":0}',close_event_no=(select coalesce(max(event_no),0) from clinic_finance.entries) where id=s.id;
 if s.end_counted<>s.end_expected then insert into clinic_finance.cash_cases(shift_id,difference) values(s.id,s.end_counted-s.end_expected) on conflict(shift_id) do nothing;end if;
 end if;
 end if;return v;
 end if;
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'طلب غير صالح';end if;
 select * into op from clinic_finance.journal_operations where actor=me and token=p_token;
 if found then if op.action<>'treasury_end_shift' or op.payload<>p_payload then raise exception 'مفتاح مكرر لبيانات مختلفة';end if;return op.result;end if;
 select * into s from clinic_finance.shifts where id=(p_payload->>'shift_id')::uuid for update;
 if not found or s.cashier_id<>me or s.status<>'open' or s.ended_at is not null or s.is_main then raise exception 'اختر وردية تحصيل مفتوحة تخصك';end if;
 if clinic_finance.has_pending_shift(s.id) or exists(select 1 from clinic_finance.treasury_transfers where from_shift=s.id and status='pending') then raise exception 'راجع طلبات الوردية المعلقة أولًا';end if;
 if jsonb_typeof(p_payload->'counts') is distinct from 'object' or p_payload->'counts'='{}'::jsonb then raise exception 'أدخل جرد الفئات النقدية';end if;
 for j in select key,value from jsonb_each_text(p_payload->'counts') loop
 if j.key not in('200','100','50','20','10','5','1','0.5','0.25') or j.value is null or j.value!~'^[0-9]{1,7}$' then raise exception 'فئات أو أعداد غير صالحة';end if;total:=total+j.key::numeric*j.value::numeric;
 end loop;
 select id into target from clinic_finance.registers where treasury_kind='main' and id<>s.register_id;
 if target is null then raise exception 'جهّز الخزينة الرئيسية أولًا';end if;
 expected:=clinic_finance.shift_cash(s.id);

 update clinic_finance.shifts set ended_at=now(),end_counted=total,end_expected=expected,end_counts=p_payload->'counts',note=left(coalesce(p_payload->>'note',''),1000) where id=s.id;
 if total>0 then
 insert into clinic_finance.treasury_transfers(from_shift,to_register,amount,reference,reason,created_by) values(s.id,target,total,'SHIFT-'||s.id::text||'-'||p_token::text,'تسليم نهاية الوردية',me) returning * into t;
 else
 update clinic_finance.shifts set status='submitted',closed_at=now(),counted=0,denominations='{"1":0}',close_event_no=(select coalesce(max(event_no),0) from clinic_finance.entries) where id=s.id;
 if expected<>0 then insert into clinic_finance.cash_cases(shift_id,difference) values(s.id,-expected) on conflict(shift_id) do nothing;end if;
 end if;
 v:=jsonb_build_object('shift_id',s.id,'transfer_id',t.id,'counted',total,'expected',expected,'difference',total-expected,'status',case when total>0 then 'awaiting_receipt' else 'submitted' end);
 insert into clinic_finance.journal_operations values(me,p_token,'treasury_end_shift',p_payload,v,now());
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'shift_ended_for_handover',s.id,v);return v;
end $$;
-- Add ending-count details to snapshots without changing original visibility.
alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance;
alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to handover_snapshot_base;
create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb:=clinic_finance.handover_snapshot_base(p_from,p_to,p_offset);begin
 v:=jsonb_set(v,'{shifts}',(select coalesce(jsonb_agg(x||jsonb_build_object('ended_at',s.ended_at,'end_counted',s.end_counted,'end_expected',s.end_expected,'is_main',s.is_main)),'[]') from jsonb_array_elements(v->'shifts')x join clinic_finance.shifts s on s.id=(x->>'id')::uuid));
 v:=jsonb_set(v,'{active_shifts}',(select coalesce(jsonb_agg(x||jsonb_build_object('ended_at',s.ended_at,'is_main',s.is_main)),'[]') from jsonb_array_elements(coalesce(v->'active_shifts','[]'))x join clinic_finance.shifts s on s.id=(x->>'id')::uuid));
 v:=jsonb_set(v,'{treasury_transfers}',(select coalesce(jsonb_agg(x||jsonb_build_object('end_difference',s.end_counted-s.end_expected)),'[]') from jsonb_array_elements(v->'treasury_transfers')x join clinic_finance.treasury_transfers t on t.id=(x->>'id')::uuid join clinic_finance.shifts s on s.id=t.from_shift));
 return v||jsonb_build_object('can_main',clinic_finance.main_custodian());end $$;
alter function public.clinic_booking_snapshot(date,date) set schema clinic_finance;
alter function clinic_finance.clinic_booking_snapshot(date,date) rename to handover_booking_base;
create function public.clinic_booking_snapshot(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb:=clinic_finance.handover_booking_base(p_from,p_to);begin
 v:=jsonb_set(v,'{shifts}',(select coalesce(jsonb_agg(x||jsonb_build_object('ended_at',s.ended_at,'end_counted',s.end_counted,'end_expected',s.end_expected,'is_main',s.is_main)),'[]') from jsonb_array_elements(v->'shifts')x join clinic_finance.shifts s on s.id=(x->>'id')::uuid));return v;end $$;
revoke all on all functions in schema clinic_finance from public,anon,authenticated;
revoke all on function public.clinic_finance_treasury_command(text,jsonb,uuid),public.clinic_finance_snapshot(date,date,integer),public.clinic_booking_snapshot(date,date) from public,anon;
grant execute on function public.clinic_finance_treasury_command(text,jsonb,uuid),public.clinic_finance_snapshot(date,date,integer),public.clinic_booking_snapshot(date,date) to authenticated;
commit;
