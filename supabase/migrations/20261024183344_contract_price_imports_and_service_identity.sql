begin;
-- Private staging. Source files stay on the operator's device.
alter table clinic_prices.lists add column issue_year integer not null default extract(year from current_date),add column application_year integer not null default extract(year from current_date),add constraint price_years check(issue_year between 1900 and 2200 and application_year between 1900 and 2200);
update clinic_prices.lists set issue_year=extract(year from valid_from),application_year=extract(year from valid_from);
create table clinic_prices.sections(id uuid primary key default gen_random_uuid(),list_id uuid not null references clinic_prices.lists(id),name text not null check(length(trim(name)) between 1 and 150),unique(list_id,name),unique(list_id,id));
alter table clinic_prices.items add column section_id uuid,add column external_code text not null default '',add column external_name text not null default '',add column unit text not null default '',add column source_ref jsonb not null default '{}',add foreign key(list_id,section_id) references clinic_prices.sections(list_id,id);
create sequence clinic_prices.service_code;
alter table public.pricing_services add column canonical_code text unique,add column canonical_unit text not null default '';
create function clinic_prices.assign_service_code() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin if tg_op='INSERT' then new.canonical_code:='SVC-'||lpad(nextval('clinic_prices.service_code')::text,7,'0');elsif new.canonical_code is distinct from old.canonical_code then raise exception 'كود الخدمة المعتمد ثابت';end if;return new;end $$;
update public.pricing_services set canonical_code='SVC-'||lpad(nextval('clinic_prices.service_code')::text,7,'0');
create trigger pricing_canonical_code before insert or update on public.pricing_services for each row execute function clinic_prices.assign_service_code();
alter table public.pricing_services alter column canonical_code set not null;
create table clinic_prices.aliases(id uuid primary key default gen_random_uuid(),scope_key text not null,external_code text not null default '',external_name text not null,unit text not null default '',service_id uuid not null references public.pricing_services(id),list_id uuid not null references clinic_prices.lists(id),reviewed_by uuid not null references public.admins(id),reviewed_at timestamptz not null default now(),unique(scope_key,external_code,external_name,unit));
create table clinic_prices.batches(id uuid primary key default gen_random_uuid(),list_id uuid not null references clinic_prices.lists(id),section_id uuid not null,filename text not null,checksum text not null,operation text not null check(operation in ('append','update','replace_section','replace_all')),rows jsonb not null check(jsonb_typeof(rows)='array' and jsonb_array_length(rows) between 1 and 10000),split_sections boolean not null default false,status text not null default 'draft' check(status in ('draft','applied','discarded')),revision integer not null default 1,created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),unique(list_id,checksum),foreign key(list_id,section_id) references clinic_prices.sections(list_id,id));
create table clinic_prices.service_proposals(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name))>=3),category text not null,unit text not null default '',note text not null check(length(trim(note))>=3),status text not null default 'pending' check(status in ('pending','approved','rejected')),service_id uuid references public.pricing_services(id),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),review_note text,created_at timestamptz not null default now());
create index price_batches_list on clinic_prices.batches(list_id,status);
alter table clinic_prices.sections enable row level security;
alter table clinic_prices.aliases enable row level security;
alter table clinic_prices.batches enable row level security;
alter table clinic_prices.service_proposals enable row level security;
alter function public.price_lists_workspace() set schema clinic_prices;
alter function clinic_prices.price_lists_workspace() rename to workspace_v1;
create function public.price_lists_workspace() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb;begin
 v:=clinic_prices.workspace_v1();
 return v||jsonb_build_object('sections',(select coalesce(jsonb_agg(s),'[]') from clinic_prices.sections s),'aliases',(select coalesce(jsonb_agg(s),'[]') from clinic_prices.aliases s),'proposals',(select coalesce(jsonb_agg(s order by s.created_at desc),'[]') from clinic_prices.service_proposals s where s.status='pending'),'services',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',coalesce(booking_code,canonical_code),'canonical_code',canonical_code,'category',category,'unit',canonical_unit,'base_price',base_price,'active',active) order by name),'[]') from public.pricing_services),'contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'entity_id',c.entity_id,'category',coalesce(e.category,'cash'),'name',e.name||' — '||coalesce(c.contract_number,c.id::text),'start_date',c.start_date,'end_date',c.end_date,'status',c.status,'service_ids',c.booking_service_ids) order by e.name),'[]') from public.contracting_entity_contracts c join public.contracting_entities e on e.id=c.entity_id));
end $$;
alter function public.price_lists_command(text,jsonb) set schema clinic_prices;
alter function clinic_prices.price_lists_command(text,jsonb) rename to command_v1;
create function public.price_lists_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v uuid;l clinic_prices.lists%rowtype;r jsonb;i clinic_prices.items%rowtype;scope text;prior uuid;begin
 if not clinic_prices.manage() then raise exception 'لا تملك إدارة لوائح الأسعار';end if;
 perform pg_advisory_xact_lock(712241024);
 select * into l from clinic_prices.lists where id=nullif(p_payload->>'id','')::uuid for update;
 if p_action='submit' and exists(select 1 from clinic_prices.batches where list_id=l.id and status='draft') then raise exception 'راجع دفعات الاستيراد وضمها أو استبعدها قبل إرسال اللائحة';end if;
 v:=clinic_prices.command_v1(p_action,p_payload);
 if p_action='save' then
  update clinic_prices.lists set issue_year=coalesce((p_payload->>'issue_year')::int,l.issue_year,extract(year from current_date)::int),application_year=coalesce((p_payload->>'application_year')::int,l.application_year,extract(year from current_date)::int) where id=v;
  for r in select * from jsonb_array_elements(coalesce(p_payload->'items','[]')) loop
   update clinic_prices.items set section_id=nullif(r->>'section_id','')::uuid,external_code=trim(coalesce(r->>'external_code','')),external_name=trim(coalesce(r->>'external_name','')),unit=trim(coalesce(r->>'unit','')),source_ref=coalesce(r->'source_ref','{}') where list_id=v and service_id=(r->>'service_id')::uuid;
  end loop;
 elsif p_action='clone' then
  update clinic_prices.lists set issue_year=extract(year from current_date),application_year=extract(year from current_date) where id=v;
  insert into clinic_prices.sections(list_id,name) select v,name from clinic_prices.sections where list_id=l.id;
  update clinic_prices.items n set section_id=ns.id,external_code=o.external_code,external_name=o.external_name,unit=o.unit,source_ref=o.source_ref from clinic_prices.items o left join clinic_prices.sections os on os.id=o.section_id left join clinic_prices.sections ns on ns.list_id=v and ns.name=os.name where n.list_id=v and o.list_id=l.id and n.service_id=o.service_id;
 elsif p_action='review' and p_payload->>'decision'='active' then
  scope:='center';if l.contract_id is not null then select entity_id::text into scope from public.contracting_entity_contracts where id=l.contract_id;end if;
  for i in select * from clinic_prices.items where list_id=v and external_name<>'' loop
   select service_id into prior from clinic_prices.aliases where scope_key=scope and external_code=i.external_code and (external_name=i.external_name or i.external_code<>'' and external_code=i.external_code) and unit=i.unit limit 1;
   if prior is not null and prior<>i.service_id then raise exception 'تعارض مع مطابقة معتمدة للاسم %؛ راجع تعريف الخدمة',i.external_name;end if;
   insert into clinic_prices.aliases(scope_key,external_code,external_name,unit,service_id,list_id,reviewed_by) values(scope,i.external_code,i.external_name,i.unit,i.service_id,v,public.my_admin_id()) on conflict(scope_key,external_code,external_name,unit) do nothing;
  end loop;
 end if;return v;
end $$;
create function public.price_import_workspace(p_list uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 if not clinic_prices.manage() then raise exception 'لا تملك إدارة لوائح الأسعار';end if;
 return jsonb_build_object('batches',(select coalesce(jsonb_agg(b order by b.created_at),'[]') from clinic_prices.batches b where b.list_id=p_list),'audit',(select coalesce(jsonb_agg(x),'[]') from(select actor_id,action,created_at from clinic_prices.audit where list_id=p_list order by id desc limit 40)x));end $$;
create function public.price_import_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();lid uuid:=nullif(p_payload->>'list_id','')::uuid;v uuid:=nullif(p_payload->>'id','')::uuid;l clinic_prices.lists%rowtype;b clinic_prices.batches%rowtype;r jsonb;sid uuid;target_section uuid;props clinic_prices.service_proposals%rowtype;begin
 if not clinic_prices.manage() then raise exception 'لا تملك إدارة لوائح الأسعار';end if;
 perform pg_advisory_xact_lock(712241024);
 if p_action='service_propose' then
  insert into clinic_prices.service_proposals(name,category,unit,note,created_by) values(trim(p_payload->>'name'),trim(p_payload->>'category'),coalesce(p_payload->>'unit',''),p_payload->>'note',me) returning id into v;return v;
 elsif p_action='service_review' then
  select * into props from clinic_prices.service_proposals where id=v for update;
  if not found or props.status<>'pending' or props.created_by=me or length(trim(coalesce(p_payload->>'review_note','')))<3 then raise exception 'يلزم مراجع آخر وسبب القرار';end if;
  if p_payload->>'decision'='approved' then
   if exists(select 1 from public.pricing_services where lower(trim(name))=lower(trim(props.name)) and category is not distinct from props.category and canonical_unit=props.unit) then raise exception 'اسم الخدمة موجود في هذا القسم؛ استخدم الخدمة الموجودة';end if;
   insert into public.pricing_services(name,category,base_price,supplies_used,profit_margin_percent,active,booking_enabled,canonical_unit,created_by) values(props.name,props.category,0,'[]',0,true,false,props.unit,props.created_by) returning id into sid;
  elsif p_payload->>'decision'<>'rejected' then raise exception 'قرار غير متاح';end if;
  update clinic_prices.service_proposals set status=p_payload->>'decision',reviewed_by=me,review_note=p_payload->>'review_note',service_id=sid where id=v;return v;
 end if;
 select * into l from clinic_prices.lists where id=lid for update;
 if not found or l.status<>'draft' or l.created_by<>me then raise exception 'التعديل لمسودة أنشأتها فقط؛ انسخ اللائحة المعتمدة لإصدار جديد';end if;
 if l.revision<>coalesce((p_payload->>'list_revision')::int,0) then raise exception 'اللائحة تغيرت؛ أعد تحميلها';end if;
 if p_action='section' then
  insert into clinic_prices.sections(list_id,name) values(lid,trim(p_payload->>'name')) returning id into v;
 elsif p_action='batch' then
  if v is null then
   insert into clinic_prices.batches(list_id,section_id,filename,checksum,operation,split_sections,rows,created_by) values(lid,(p_payload->>'section_id')::uuid,p_payload->>'filename',p_payload->>'checksum',p_payload->>'operation',coalesce((p_payload->>'split_sections')::boolean,false),p_payload->'rows',me) returning id into v;
  else
   select * into b from clinic_prices.batches where id=v and list_id=lid for update;
   if not found or b.status<>'draft' or b.revision<>coalesce((p_payload->>'revision')::int,0) then raise exception 'الدفعة تغيرت أو سبق ضمها';end if;
   update clinic_prices.batches set rows=p_payload->'rows',revision=revision+1 where id=v;
  end if;
 elsif p_action in ('apply_batch','discard_batch') then
  select * into b from clinic_prices.batches where id=v and list_id=lid for update;
  if not found or b.status<>'draft' or b.revision<>coalesce((p_payload->>'revision')::int,0) then raise exception 'الدفعة تغيرت أو سبق ضمها';end if;
  if p_action='discard_batch' then update clinic_prices.batches set status='discarded',revision=revision+1 where id=v;
  else
   if exists(select 1 from jsonb_array_elements(b.rows) x where coalesce(x->>'service_id','')='' or coalesce((x->>'confirmed')::boolean,false)=false or not exists(select 1 from public.pricing_services where id=(x->>'service_id')::uuid and active)) then raise exception 'كل سطر يحتاج خدمة معتمدة وتأكيد المطابقة';end if;
   if exists(select 1 from jsonb_array_elements(b.rows) x group by x->>'service_id' having count(*)>1) then raise exception 'نفس الخدمة مكررة في الدفعة؛ راجع البنود قبل الضم';end if;
   if b.split_sections and b.operation='replace_section' then raise exception 'استبدال قسم يتطلب تحديد قسم واحد؛ ألغِ توزيع أقسام الملف';end if;
   if b.operation='replace_all' then delete from clinic_prices.items where list_id=lid;
   elsif b.operation='replace_section' then delete from clinic_prices.items where list_id=lid and section_id=b.section_id;end if;
   for r in select * from jsonb_array_elements(b.rows) loop
    sid:=(r->>'service_id')::uuid;target_section:=b.section_id;
    if b.split_sections and trim(coalesce(r->>'category',''))<>'' then insert into clinic_prices.sections(list_id,name) values(lid,trim(r->>'category')) on conflict(list_id,name) do update set name=excluded.name returning id into target_section;end if;
    if b.operation<>'update' and exists(select 1 from clinic_prices.items where list_id=lid and service_id=sid) then raise exception 'الخدمة موجودة بالفعل؛ اختر تحديث أو راجع التكرار';end if;
    if nullif(r->>'price','') is null or (r->>'price')::numeric<=0 or (r->>'price') in ('NaN','Infinity','-Infinity') then raise exception 'أكمل سعرًا موجبًا لكل بند';end if;
    insert into clinic_prices.items(list_id,service_id,fixed_price,section_id,external_code,external_name,unit,source_ref,notes) values(lid,sid,(r->>'price')::numeric,target_section,coalesce(r->>'code',''),coalesce(r->>'name',''),coalesce(r->>'unit',''),jsonb_build_object('batch_id',v,'filename',b.filename,'sheet',r->>'sheet','row',r->>'row'),coalesce(r->>'note','')) on conflict(list_id,service_id) do update set fixed_price=excluded.fixed_price,section_id=excluded.section_id,external_code=excluded.external_code,external_name=excluded.external_name,unit=excluded.unit,source_ref=excluded.source_ref,notes=excluded.notes;
   end loop;
   update clinic_prices.batches set status='applied',revision=revision+1 where id=v;
  end if;
 elsif p_action='annual' then
  if jsonb_typeof(p_payload->'rates')<>'array' or jsonb_array_length(p_payload->'rates') not between 1 and 1000 or exists(select 1 from jsonb_array_elements(p_payload->'rates') x group by x->>'section_id' having count(*)>1) or jsonb_array_length(p_payload->'rates')>1 and exists(select 1 from jsonb_array_elements(p_payload->'rates') x where x->>'section_id'='all') then raise exception 'حدد نطاقات تعديل غير متكررة';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'rates') x where (x->>'percent')::numeric<=-100 or (x->>'percent')::numeric>1000 or (x->>'percent') in ('NaN','Infinity','-Infinity')) then raise exception 'راجع نسب التعديل';end if;
  if (p_payload->>'rounding')::numeric not in (0.01,0.1,0.5,1,5,10) then raise exception 'اختر قيمة التقريب';end if;
  if exists(select 1 from clinic_prices.items where list_id=lid and fixed_price is null) then raise exception 'التعديل النسبي يحتاج أسعارًا ثابتة؛ راجع البنود المعتمدة على الخصم أولًا';end if;
  for r in select * from jsonb_array_elements(p_payload->'rates') loop
   update clinic_prices.items set fixed_price=round((fixed_price*(1+(r->>'percent')::numeric/100))/(p_payload->>'rounding')::numeric)*(p_payload->>'rounding')::numeric where list_id=lid and (r->>'section_id'='all' or section_id=nullif(r->>'section_id','')::uuid);
  end loop;
  v:=lid;
 else raise exception 'إجراء غير متاح';end if;
 update clinic_prices.lists set revision=revision+1 where id=lid;
 insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,p_action,lid,jsonb_build_object('id',v,'operation',p_payload->>'operation','rates',p_payload->'rates'));
 return v;
end $$;
revoke all on all tables in schema clinic_prices from public,anon,authenticated;
revoke all on all sequences in schema clinic_prices from public,anon,authenticated;
revoke all on all functions in schema clinic_prices from public,anon,authenticated;
revoke all on function public.price_lists_workspace(),public.price_lists_command(text,jsonb),public.price_import_workspace(uuid),public.price_import_command(text,jsonb) from public,anon;
grant execute on function public.price_lists_workspace(),public.price_lists_command(text,jsonb),public.price_import_workspace(uuid),public.price_import_command(text,jsonb) to authenticated;
commit;
