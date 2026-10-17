begin;
create table clinic_finance.account_config(
 code text primary key references clinic_finance.accounts(code),
 parent_code text references clinic_finance.accounts(code),
 is_system boolean not null default false,active boolean not null default true,
 archived boolean not null default false,revision integer not null default 1,
 check(code is distinct from parent_code));
insert into clinic_finance.account_config(code,is_system) select code,true from clinic_finance.accounts;
create table clinic_finance.journal_drafts(
 id uuid primary key default gen_random_uuid(),created_by uuid not null references public.admins(id),
 payload jsonb not null,revision integer not null default 1,
 state text not null default 'draft' check(state in ('draft','deleted','submitted')),
 batch_id uuid references clinic_finance.manual_batches(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table clinic_finance.journal_corrections(
 id uuid primary key default gen_random_uuid(),entry_id uuid not null references clinic_finance.entries(id),
 reverse_batch uuid not null unique references clinic_finance.manual_batches(id),
 replacement_batch uuid not null unique references clinic_finance.manual_batches(id),
 created_by uuid not null references public.admins(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now());
create unique index journal_one_correction on clinic_finance.journal_corrections(entry_id) where status in ('pending','approved');
create table clinic_finance.journal_operations(
 actor uuid not null references public.admins(id),token uuid not null,action text not null,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor,token));
create function clinic_finance.check_chart_lines(p_payload jsonb,p_reversal boolean default false) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare j jsonb;c text;
begin
 for j in select value from jsonb_array_elements(coalesce(p_payload->'lines','[]')) loop
 c:=j->>'account';
 if exists(select 1 from clinic_finance.account_config where code=c and (archived or not active)) and not p_reversal then raise exception 'الحساب % موقوف أو محذوف؛ اختر حسابًا متاحًا',c;end if;
 if exists(with recursive parents(code) as(select parent_code from clinic_finance.account_config where code=c union select a.parent_code from clinic_finance.account_config a join parents p on a.code=p.code) select 1 from parents where code in ('1111','1122','1121','1131','1142','1211','1291','1292','2111','2120','2131','2144','1114','2150')) then raise exception 'الحساب % تابع لحساب تشغيلي؛ صحح من قسم العملية الأصلية',c;end if;
 end loop;
end $$;
-- Preserve every existing validator, period lock and opening-subledger rule.
alter function public.clinic_finance_manual_command(text,jsonb,uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_manual_command(text,jsonb,uuid) rename to journal_manual_base;
create function public.clinic_finance_manual_command(p_action text,p_payload jsonb,p_token uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r clinic_finance.manual_batches%rowtype;
begin
 perform clinic_finance.require_access('review');perform clinic_finance.lock_day();
 if p_action='review' then
 select * into r from clinic_finance.manual_batches where id=(p_payload->>'id')::uuid for update;
 if exists(select 1 from clinic_finance.journal_corrections where reverse_batch=r.id or replacement_batch=r.id) then raise exception 'راجع التصحيح والعكس معًا من طلب تصحيح القيد';end if;
 if coalesce((p_payload->>'approve')::boolean,false) then perform clinic_finance.check_chart_lines(r.payload,r.kind='reversal');end if;
 elsif p_action='request' then perform clinic_finance.check_chart_lines(p_payload,p_payload->>'kind'='reversal');
 end if;
 return clinic_finance.journal_manual_base(p_action,p_payload,p_token);
end $$;
create function public.clinic_finance_ledger_command(p_action text,p_payload jsonb,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_variable
declare me uuid:=clinic_finance.require_access('review');op clinic_finance.journal_operations%rowtype;
 d clinic_finance.journal_drafts%rowtype;c clinic_finance.account_config%rowtype;
 correction clinic_finance.journal_corrections%rowtype;batch clinic_finance.manual_batches%rowtype;
 code text:=trim(p_payload->>'code');parent text:=nullif(p_payload->>'parent_code','');kind text:=p_payload->>'kind';
 before_value jsonb;payload jsonb:=p_payload->'payload';result jsonb;v uuid;r uuid;b uuid;entry uuid;j jsonb;used boolean;old_kind text;depth integer;
begin
 if p_token is null then raise exception 'مفتاح العملية مطلوب';end if;
 perform pg_advisory_xact_lock(927311);
 select * into op from clinic_finance.journal_operations where actor=me and token=p_token;
 if found then if op.action<>p_action or op.payload<>p_payload then raise exception 'مفتاح مستخدم لبيانات أخرى';end if;return op.result;end if;
 perform clinic_finance.lock_day();
 if p_action like 'draft_%' then
 if p_action='draft_save' then
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>100000 or coalesce(payload->>'kind','') not in ('opening','correction','replacement') or jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines')>200 then raise exception 'راجع بيانات المسودة وعدد السطور';end if;
 if nullif(p_payload->>'id','') is null then
 insert into clinic_finance.journal_drafts(created_by,payload) values(me,payload) returning * into d;
 else
 select * into d from clinic_finance.journal_drafts where id=(p_payload->>'id')::uuid for update;
 before_value:=to_jsonb(d);
 if not found or d.created_by<>me or d.state<>'draft' or d.revision is distinct from (p_payload->>'revision')::integer then raise exception 'المسودة تغيرت أو غير متاحة لك؛ حدّث الشاشة';end if;
 update clinic_finance.journal_drafts set payload=payload,revision=revision+1,updated_at=now() where id=d.id returning * into d;
 end if;
 else
 select * into d from clinic_finance.journal_drafts where id=(p_payload->>'id')::uuid for update;
 before_value:=to_jsonb(d);
 if not found or d.created_by<>me or d.revision is distinct from (p_payload->>'revision')::integer then raise exception 'المسودة تغيرت أو غير متاحة لك؛ حدّث الشاشة';end if;
 if p_action='draft_delete' and d.state='draft' then update clinic_finance.journal_drafts set state='deleted',revision=revision+1,updated_at=now() where id=d.id returning * into d;
 elsif p_action='draft_restore' and d.state='deleted' then update clinic_finance.journal_drafts set state='draft',revision=revision+1,updated_at=now() where id=d.id returning * into d;
 elsif p_action='draft_submit' and d.state='draft' then
 if d.payload->>'kind'='replacement' then
 payload:=d.payload;entry:=(payload->>'entry_id')::uuid;
 select mb.* into batch from clinic_finance.manual_batches mb where mb.entry_id=entry and mb.kind='correction' and mb.status='approved' for update;
 if not found then raise exception 'تصحيح القيد من هنا لقيد يدوي معتمد؛ افتح العملية الأصلية للقيود التشغيلية';end if;
 perform clinic_finance.check_chart_lines(payload);
 r:=public.clinic_finance_manual_command('request',jsonb_build_object('kind','reversal','entry_id',entry,'reference',(payload->>'reference')||'-R','note',payload->>'note'),gen_random_uuid());
 b:=public.clinic_finance_manual_command('request',(payload-'entry_id')||jsonb_build_object('kind','correction','reference',(payload->>'reference')||'-C'),gen_random_uuid());
 insert into clinic_finance.journal_corrections(entry_id,reverse_batch,replacement_batch,created_by) values(entry,r,b,me) returning id into v;
 else b:=public.clinic_finance_manual_command('request',d.payload,gen_random_uuid());v:=b;end if;
 update clinic_finance.journal_drafts set state='submitted',batch_id=b,revision=revision+1,updated_at=now() where id=d.id returning * into d;
 else raise exception 'حالة المسودة لا تسمح بهذا الإجراء';end if;
 end if;
 result:=jsonb_build_object('id',d.id,'revision',d.revision,'state',d.state,'batch_id',d.batch_id);
 elsif p_action='correction_review' then
 select * into correction from clinic_finance.journal_corrections where id=(p_payload->>'id')::uuid for update;
 if not found or correction.status<>'pending' or correction.created_by=me then raise exception 'يلزم طلب معلق ومراجع آخر';end if;
 select * into batch from clinic_finance.manual_batches where id=correction.replacement_batch;
 if coalesce((p_payload->>'approve')::boolean,false) then perform clinic_finance.check_chart_lines(batch.payload);end if;
 -- Both approvals and postings share this transaction, so any failure rolls both back.
 perform clinic_finance.journal_manual_base('review',p_payload||jsonb_build_object('id',correction.reverse_batch),gen_random_uuid());
 perform clinic_finance.journal_manual_base('review',p_payload||jsonb_build_object('id',correction.replacement_batch),gen_random_uuid());
 update clinic_finance.journal_corrections set status=case when (p_payload->>'approve')::boolean then 'approved' else 'rejected' end where id=correction.id;
 result:=jsonb_build_object('id',correction.id);
 elsif p_action like 'account_%' then
 if p_action='account_create' then
 if coalesce(code,'')!~'^[1-9][0-9]{2,11}$' or kind not in ('asset','liability','equity','income','expense') or coalesce(length(trim(p_payload->>'name')),0) not between 2 and 120 then raise exception 'راجع كود الحساب واسمه ونوعه';end if;
 insert into clinic_finance.accounts(code,name,kind) values(code,trim(p_payload->>'name'),kind);
 insert into clinic_finance.account_config(code,parent_code,is_system) values(code,null,false) returning * into c;
 else
 select * into c from clinic_finance.account_config where account_config.code=code for update;
 if not found or c.revision is distinct from (p_payload->>'revision')::integer then raise exception 'الحساب تغير؛ حدّث الشاشة';end if;
 end if;
 select to_jsonb(a)||to_jsonb(c) into before_value from clinic_finance.accounts a where a.code=code;
 select a.kind into old_kind from clinic_finance.accounts a where a.code=code;
 used:=exists(select 1 from clinic_finance.lines where account=code) or exists(select 1 from clinic_finance.manual_batches b cross join lateral jsonb_array_elements(b.payload->'lines') x where b.status='pending' and x->>'account'=code) or exists(select 1 from clinic_finance.journal_drafts jd cross join lateral jsonb_array_elements(jd.payload->'lines') x where jd.state='draft' and x->>'account'=code);
 if p_action in ('account_create','account_update') then
 if c.archived then raise exception 'استرجع الحساب أولًا';end if;
 if coalesce(length(trim(p_payload->>'name')),0) not between 2 and 120 or kind not in ('asset','liability','equity','income','expense') then raise exception 'راجع اسم ونوع الحساب';end if;
 if kind<>old_kind and (used or c.is_system or exists(select 1 from clinic_finance.account_config where parent_code=code and not archived)) then raise exception 'لا يمكن تغيير نوع حساب نظام أو مستخدم أو له حسابات تابعة';end if;
 if parent is not null then
 if parent=code or not exists(select 1 from clinic_finance.accounts a left join clinic_finance.account_config ac on ac.code=a.code where a.code=parent and a.kind=kind and coalesce(ac.active,true) and not coalesce(ac.archived,false)) then raise exception 'اختر حسابًا أبًا متاحًا من نفس النوع';end if;
 if exists(with recursive chain(code) as(select parent union select a.parent_code from clinic_finance.account_config a join chain on a.code=chain.code) select 1 from chain where chain.code=code) then raise exception 'الربط يصنع دائرة في الشجرة';end if;
 end if;
 update clinic_finance.accounts a set name=trim(p_payload->>'name'),kind=kind where a.code=code;
 update clinic_finance.account_config ac set parent_code=parent,revision=ac.revision+1 where ac.code=code returning * into c;
 elsif p_action='account_delete' then
 if c.is_system or used or exists(select 1 from clinic_finance.account_config where parent_code=code and not archived) then raise exception 'لا يُحذف حساب نظام أو حساب مستخدم أو له حسابات تابعة؛ يمكن إيقاف الحساب المضاف المستخدم';end if;
 update clinic_finance.account_config set archived=true,active=false,revision=revision+1 where account_config.code=code returning * into c;
 elsif p_action='account_restore' then
 if c.parent_code is not null and exists(select 1 from clinic_finance.account_config where account_config.code=c.parent_code and (archived or not active)) then raise exception 'استرجع الحساب الأب أولًا';end if;
 update clinic_finance.account_config set archived=false,active=true,revision=revision+1 where account_config.code=code returning * into c;
 elsif p_action='account_toggle' then
 if c.is_system or c.archived then raise exception 'حسابات النظام لا تتوقف من هنا';end if;
 if c.active and exists(select 1 from clinic_finance.account_config where parent_code=code and not archived and active) then raise exception 'أوقف الحسابات التابعة أولًا';end if;
 if not c.active and c.parent_code is not null and exists(select 1 from clinic_finance.account_config where account_config.code=c.parent_code and (archived or not active)) then raise exception 'فعّل الحساب الأب أولًا';end if;
 update clinic_finance.account_config set active=not active,revision=revision+1 where account_config.code=code returning * into c;
 else raise exception 'إجراء الحساب غير معروف';end if;
 result:=to_jsonb(c);
 else raise exception 'إجراء غير معروف';end if;
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'ledger_'||p_action,d.id,jsonb_build_object('code',code,'before',before_value,'payload',p_payload,'result',result));
 insert into clinic_finance.journal_operations(actor,token,action,payload,result) values(me,p_token,p_action,p_payload,result);
 return result;
end $$;
alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance;
alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to journal_snapshot_base;
create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb:=clinic_finance.journal_snapshot_base(p_from,p_to,p_offset);
begin
 if clinic_finance.allowed('review') then
 v:=v||jsonb_build_object(
 'journal_drafts',(select coalesce(jsonb_agg(d order by updated_at desc),'[]') from(select * from clinic_finance.journal_drafts where created_by=public.my_admin_id() and state in ('draft','deleted') order by updated_at desc limit 200 offset p_offset)d),
 'journal_corrections',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('reference',(select reference from clinic_finance.manual_batches where id=c.replacement_batch),'note',(select note from clinic_finance.manual_batches where id=c.replacement_batch),'original_lines',(select jsonb_agg(to_jsonb(l)) from clinic_finance.lines l where l.entry_id=c.entry_id),'reverse_lines',(select payload->'lines' from clinic_finance.manual_batches where id=c.reverse_batch),'replacement_lines',(select payload->'lines' from clinic_finance.manual_batches where id=c.replacement_batch)) order by c.created_at desc),'[]') from clinic_finance.journal_corrections c where (c.created_at at time zone 'Africa/Cairo')::date between p_from and p_to),
 'finance_accounts',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('parent_code',c.parent_code,'is_system',coalesce(c.is_system,true),'active',coalesce(c.active,true),'archived',coalesce(c.archived,false),'revision',coalesce(c.revision,1),'used',exists(select 1 from clinic_finance.lines where account=a.code)) order by a.code),'[]') from clinic_finance.accounts a left join clinic_finance.account_config c on c.code=a.code));
 v:=v||jsonb_build_object('entries',(select coalesce(jsonb_agg(x||jsonb_build_object('manual_kind',b.kind,'manual_batch_id',b.id,'can_reverse',b.kind='correction' and b.status='approved' and not exists(select 1 from clinic_finance.manual_batches r where r.kind='reversal' and r.payload->>'entry_id'=x->>'id' and r.status in ('pending','approved')) and not exists(select 1 from clinic_finance.bank_rows br join clinic_finance.lines l on l.id=br.line_id where l.entry_id=(x->>'id')::uuid)) order by x->>'created_at' desc),'[]') from jsonb_array_elements(v->'entries')x left join clinic_finance.manual_batches b on b.entry_id=(x->>'id')::uuid));end if;return v;
end $$;
do $$declare t text;begin foreach t in array array['account_config','journal_drafts','journal_corrections','journal_operations'] loop execute format('alter table clinic_finance.%I enable row level security',t);execute format('revoke all on clinic_finance.%I from public,anon,authenticated',t);end loop;end $$;
revoke all on function clinic_finance.check_chart_lines(jsonb,boolean),clinic_finance.journal_manual_base(text,jsonb,uuid),clinic_finance.journal_snapshot_base(date,date,integer) from public,anon,authenticated;
revoke all on function public.clinic_finance_ledger_command(text,jsonb,uuid),public.clinic_finance_manual_command(text,jsonb,uuid),public.clinic_finance_snapshot(date,date,integer) from public,anon;
grant execute on function public.clinic_finance_ledger_command(text,jsonb,uuid),public.clinic_finance_manual_command(text,jsonb,uuid),public.clinic_finance_snapshot(date,date,integer) to authenticated;

create function public.clinic_finance_entry_origin(p_entry uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare e clinic_finance.entries%rowtype;section text;reference text;
begin perform clinic_finance.require_access('review');select * into e from clinic_finance.entries where id=p_entry;if not found then raise exception 'القيد غير موجود';end if;
 section:=case when e.source like 'manual_%' then 'manual' when e.source like 'reception_%' then 'reception_services' when e.source in ('invoice','stock_revenue','stock_cost') then 'invoices' when e.source='collection' then 'payments' when e.source like 'doctor_%' then 'doctors' when e.source like 'insurance_%' then 'insurance' when e.source like 'advance_%' then 'advances' when e.source like 'pos_%' then 'bank' when e.source like 'payroll_%' or e.source in ('business_payroll','business_salary_payment','business_advance','business_statutory_payment') then 'payroll' when e.source like 'legacy_asset_%' or e.source in ('business_asset','depreciation') then 'assets' when e.source like 'tax_%' or e.source='business_tax_payment' then 'taxes' when e.source like '%supplier%' or e.source like '%stock_return%' or e.source='inventory_purchase' then 'suppliers' else 'requests' end;
 if section='manual' then select b.reference into reference from clinic_finance.manual_batches b where b.id=e.source_id;
 elsif section='invoices' then select i.reference into reference from clinic_finance.invoices i where i.id=e.source_id;
 elsif section='payments' then select p.reference into reference from clinic_finance.payments p where p.id=e.source_id;
 end if;
 return jsonb_build_object('entry_id',e.id,'source_id',e.source_id,'source',e.source,'section',section,'reference',coalesce(reference,e.description),'note','القيد الأصلي محفوظ. نفّذ الإلغاء أو الاسترداد أو تصحيح العملية من القسم المرتبط بها.');
end $$;
revoke all on function public.clinic_finance_entry_origin(uuid) from public,anon;
grant execute on function public.clinic_finance_entry_origin(uuid) to authenticated;

commit;
