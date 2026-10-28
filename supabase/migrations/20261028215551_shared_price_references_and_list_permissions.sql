begin;
alter table clinic_prices.lists add column list_kind text not null default 'center' check(list_kind in ('center','reference')),add column deleted_at timestamptz,add column deleted_by uuid references public.admins(id);
update clinic_prices.lists set list_kind=case when contract_id is null then 'center' else 'reference' end;
create table clinic_prices.list_editors(list_id uuid not null references clinic_prices.lists(id),admin_id uuid not null references public.admins(id),can_edit boolean not null,updated_by uuid not null references public.admins(id),updated_at timestamptz not null default now(),primary key(list_id,admin_id));
alter table clinic_prices.list_editors enable row level security;
revoke all on clinic_prices.list_editors from public,anon,authenticated;
alter table public.contracting_entity_contracts add column price_list_id uuid references clinic_prices.lists(id),add column price_list_terms jsonb not null default '[]' check(jsonb_typeof(price_list_terms)='array'),add column price_list_link_status text not null default 'pending' check(price_list_link_status in ('pending','active')),add column price_list_link_revision integer not null default 1,add column price_list_linked_by uuid references public.admins(id),add column price_list_reviewed_by uuid references public.admins(id);
-- Preserve existing list/contract links; no tariff or contract is activated by migration.
update public.contracting_entity_contracts c set price_list_id=l.id,price_list_linked_by=l.created_by,price_list_reviewed_by=l.reviewed_by,price_list_link_status=case when c.status='active' and l.status='active' then 'active' else 'pending' end from clinic_prices.lists l where l.contract_id=c.id;
create function clinic_prices.guard_contract_price_link() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if current_user in ('authenticated','anon') then
  if tg_op='INSERT' then
   if new.price_list_id is not null or new.price_list_terms<>'[]'::jsonb or new.price_list_link_status<>'pending' or new.price_list_linked_by is not null or new.price_list_reviewed_by is not null then raise exception 'استخدم مسار ربط الأسعار المعتمد';end if;
  elsif row(new.price_list_id,new.price_list_terms,new.price_list_link_status,new.price_list_link_revision,new.price_list_linked_by,new.price_list_reviewed_by) is distinct from row(old.price_list_id,old.price_list_terms,old.price_list_link_status,old.price_list_link_revision,old.price_list_linked_by,old.price_list_reviewed_by) then raise exception 'استخدم مسار ربط الأسعار المعتمد';end if;
 end if;return new;
end $$;
create trigger contract_price_link_guard before insert or update on public.contracting_entity_contracts for each row execute function clinic_prices.guard_contract_price_link();
revoke all on function clinic_prices.guard_contract_price_link() from public,anon,authenticated;
create index price_contract_reference on public.contracting_entity_contracts(price_list_id);
create function clinic_prices.can_edit(p_list uuid) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare permitted boolean;l clinic_prices.lists%rowtype;me uuid:=public.my_admin_id();begin
 if me is null or not clinic_prices.manage() then return false;end if;
 select * into l from clinic_prices.lists where id=p_list and deleted_at is null;if not found then return false;end if;
 select can_edit into permitted from clinic_prices.list_editors where list_id=p_list and admin_id=me;
 if found then return permitted;end if;
 return public.is_super() or l.created_by=me;
end $$;
CREATE OR REPLACE FUNCTION clinic_prices.command_v1(p_action text, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=public.my_admin_id();v uuid:=nullif(p_payload->>'id','')::uuid;l clinic_prices.lists%rowtype;item jsonb;begin
 if not clinic_prices.manage() then raise exception 'لا تملك إدارة لوائح الأسعار';end if;
 -- Serialize approval and edits, including new center lists with no parent row.
 perform pg_advisory_xact_lock(712241024);
 if v is not null then select * into l from clinic_prices.lists where id=v for update;if not found then raise exception 'اللائحة غير موجودة';end if;end if;
 if l.id is not null and l.deleted_at is not null then raise exception 'القائمة محذوفة';end if;
 if p_action in ('submit','clone','retire') and not clinic_prices.can_edit(l.id) then raise exception 'التعديل غير مسموح لهذه القائمة';end if;
 if p_action='save' then
  if l.id is not null and (l.status<>'draft' or not clinic_prices.can_edit(l.id) or l.revision<>coalesce((p_payload->>'revision')::int,0)) then raise exception 'اللائحة تغيرت أو خرجت من المسودة؛ أنشئ إصدارًا جديدًا';end if;
  if v is null then insert into clinic_prices.lists(name,version,mode,fallback,valid_from,valid_to,created_by) values(p_payload->>'name',(p_payload->>'version')::int,p_payload->>'mode',p_payload->>'fallback',(p_payload->>'valid_from')::date,(p_payload->>'valid_to')::date,me) returning id into v;end if;
  update clinic_prices.lists set name=p_payload->>'name',version=(p_payload->>'version')::int,contract_id=nullif(p_payload->>'contract_id','')::uuid,mode=p_payload->>'mode',fallback=p_payload->>'fallback',discount_percent=coalesce((p_payload->>'discount_percent')::numeric,0),discount_amount=coalesce((p_payload->>'discount_amount')::numeric,0),valid_from=(p_payload->>'valid_from')::date,valid_to=(p_payload->>'valid_to')::date,notes=coalesce(p_payload->>'notes',''),allow_extra_discount=coalesce((p_payload->>'allow_extra_discount')::boolean,false),revision=revision+1 where id=v;
  delete from clinic_prices.items where list_id=v;
  for item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]')) loop
   insert into clinic_prices.items(list_id,service_id,fixed_price,discount_percent,discount_amount,notes) values(v,(item->>'service_id')::uuid,nullif(item->>'fixed_price','')::numeric,coalesce((item->>'discount_percent')::numeric,0),coalesce((item->>'discount_amount')::numeric,0),coalesce(item->>'notes',''));
  end loop;
 elsif p_action='submit' then
  if l.status<>'draft' then raise exception 'أرسل المسودة فقط';end if;
  if l.mode='fixed' and not exists(select 1 from clinic_prices.items where list_id=l.id and fixed_price is not null) then raise exception 'أضف سعر خدمة واحدًا على الأقل';end if;
  if l.mode='discount' and exists(select 1 from clinic_prices.items where list_id=l.id and fixed_price is not null) then raise exception 'لائحة الخصم لا تضم أسعارًا ثابتة؛ اختر مختلطة';end if;
  if l.mode='fixed' and exists(select 1 from clinic_prices.items where list_id=l.id and fixed_price is null) then raise exception 'اللائحة الثابتة تتطلب سعر كل بند';end if;
  if l.list_kind='center' and l.contract_id is not null and exists(select 1 from clinic_prices.items i join public.contracting_entity_contracts c on c.id=l.contract_id where i.list_id=l.id and not(i.service_id=any(c.booking_service_ids))) then raise exception 'الخدمة غير مشمولة بعقد الجهة؛ أضفها من جهات التعاقد أولًا';end if;
  update clinic_prices.lists set status='pending' where id=v;
 elsif p_action='review' then
  if l.status<>'pending' or l.created_by=me or length(trim(coalesce(p_payload->>'review_note','')))<3 or p_payload->>'decision' not in ('active','rejected') then raise exception 'تحتاج مراجعًا آخر وسبب القرار';end if;
  if p_payload->>'decision'='active' and l.list_kind='center' and l.contract_id is not null and not exists(select 1 from public.contracting_entity_contracts where id=l.contract_id and status='active' and l.valid_from>=start_date and l.valid_to<=coalesce(end_date,'9999-12-31')) then raise exception 'فترة اللائحة يجب أن تكون داخل عقد جهة معتمد';end if;
  if p_payload->>'decision'='active' and l.list_kind='center' and exists(select 1 from clinic_prices.lists where id<>v and status='active' and deleted_at is null and list_kind='center' and daterange(valid_from,valid_to,'[]')&&daterange(l.valid_from,l.valid_to,'[]')) then raise exception 'فترة اللائحة تتداخل مع إصدار معتمد لنفس النطاق؛ أنهِ القديم أو عدّل تواريخ المسودة';end if;
  update clinic_prices.lists set status=p_payload->>'decision',reviewed_by=me,review_note=p_payload->>'review_note' where id=v;
 elsif p_action='retire' then
  if l.status<>'active' or length(trim(coalesce(p_payload->>'review_note','')))<3 then raise exception 'اكتب سبب إنهاء اللائحة المعتمدة';end if;
  update clinic_prices.lists set status='retired',review_note=coalesce(review_note,'')||' / إنهاء: '||(p_payload->>'review_note') where id=v;
 elsif p_action='clone' then
  if l.id is null then raise exception 'اختر اللائحة';end if;
  insert into clinic_prices.lists(name,version,contract_id,mode,fallback,discount_percent,discount_amount,valid_from,valid_to,notes,allow_extra_discount,created_by) select l.name,coalesce(max(version),0)+1,l.contract_id,l.mode,l.fallback,l.discount_percent,l.discount_amount,l.valid_from,l.valid_to,l.notes,l.allow_extra_discount,me from clinic_prices.lists where name=l.name returning id into v;
  insert into clinic_prices.items(list_id,service_id,fixed_price,discount_percent,discount_amount,notes) select v,service_id,fixed_price,discount_percent,discount_amount,notes from clinic_prices.items where list_id=l.id;
 else raise exception 'إجراء غير متاح';end if;
 insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,p_action,v,p_payload);return v;
end $function$
;
CREATE OR REPLACE FUNCTION public.price_import_command(p_action text, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
 if not found or l.status<>'draft' or not clinic_prices.can_edit(l.id) then raise exception 'تعديل هذه المسودة غير مسموح لك؛ راجع صلاحيات القائمة';end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.price_master_command(p_action text, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare lid uuid:=(p_payload->>'list_id')::uuid;me uuid:=public.my_admin_id();l clinic_prices.lists%rowtype;mr clinic_prices.master_reviews%rowtype;planj jsonb;r jsonb;batchrec clinic_prices.batches%rowtype;sid uuid;cnt integer;source_n integer;items_n integer;mapping jsonb:='{}';outrows jsonb;rowj jsonb;begin
 if not clinic_prices.manage() then raise exception 'تحتاج إدارة لوائح الأسعار';end if;
 perform pg_advisory_xact_lock(712241024);
 select * into l from clinic_prices.lists where id=lid for update;
 if not found or l.list_kind<>'center' or l.deleted_at is not null or l.contract_id is not null or l.status<>'draft' then raise exception 'المسار مخصص لمسودة لائحة المركز فقط';end if;
 if l.revision<>coalesce((p_payload->>'revision')::int,0) then raise exception 'اللائحة تغيرت؛ أعد تحميلها';end if;
 if p_action='prepare' then
  if l.mode<>'fixed' or l.discount_percent<>0 or l.discount_amount<>0 then raise exception 'مرجع المركز يحتاج لائحة أسعار ثابتة دون خصم عام';end if;
  if not clinic_prices.can_edit(l.id) then raise exception 'التعديل غير مسموح لهذه القائمة';end if;
  if exists(select 1 from clinic_prices.items where list_id=lid) or exists(select 1 from clinic_prices.batches where list_id=lid and status<>'draft') then raise exception 'يجب أن تكون كل دفعات المرجع مسودات لم تضم بعد';end if;
  select count(*) into source_n from clinic_prices.batches b cross join lateral jsonb_array_elements(b.rows) x where b.list_id=lid;
  if source_n not between 1 and 10000 then raise exception 'عدد سطور المرجع خارج الحدود';end if;
  if exists(select 1 from clinic_prices.batches b cross join lateral jsonb_array_elements(b.rows)x where b.list_id=lid and (length(trim(coalesce(x->>'name','')))<1 or length(trim(coalesce(x->>'code','')))=0 or nullif(x->>'price','') is null or (x->>'price')::numeric<=0 or (x->>'price') in ('NaN','Infinity','-Infinity'))) then raise exception 'أكمل أسماء الخدمات وأكواد المصدر وأسعارها الموجبة';end if;
  if exists(select 1 from clinic_prices.batches b cross join lateral jsonb_array_elements(b.rows)x where b.list_id=lid group by x->>'code' having count(*)>1) then raise exception 'كود المصدر مكرر؛ راجع الملف';end if;
  if exists(select 1 from clinic_prices.batches b join clinic_prices.sections s on s.id=b.section_id cross join lateral jsonb_array_elements(b.rows)x where b.list_id=lid group by trim(x->>'name'),s.name,trim(coalesce(x->>'unit','')) having min((x->>'price')::numeric)<>max((x->>'price')::numeric)) then raise exception 'نفس الاسم والقسم والوحدة لها أسعار مختلفة؛ احسم التعارض قبل التجهيز';end if;
  with raw as(select s.id section_id,s.name category,x from clinic_prices.batches b join clinic_prices.sections s on s.id=b.section_id cross join lateral jsonb_array_elements(b.rows)x where b.list_id=lid), groups as(select section_id,category,trim(x->>'name') name,trim(coalesce(x->>'unit','')) unit,min((x->>'price')::numeric) price,jsonb_agg(x order by x->>'code') source_rows from raw group by section_id,category,trim(x->>'name'),trim(coalesce(x->>'unit','')))
  select jsonb_agg(jsonb_build_object('key',md5(jsonb_build_array(name,category,unit)::text),'name',name,'category',category,'section_id',section_id,'unit',unit,'price',price,'source_rows',source_rows,'existing_ids',(select coalesce(jsonb_agg(p.id),'[]') from public.pricing_services p where p.active and p.name=g.name and p.category=g.category and p.canonical_unit=g.unit)) order by category,name) into planj from groups g;
  if exists(select 1 from jsonb_array_elements(planj) x where jsonb_array_length(x->'existing_ids')>1) then raise exception 'خدمة لها أكثر من تعريف مطابق؛ راجع توحيد الكتالوج أولًا';end if;
  insert into clinic_prices.master_reviews(list_id,source_hash,source_revision,plan,prepared_by) values(lid,clinic_prices.master_hash(lid),l.revision,planj,me) on conflict(list_id) do update set source_hash=excluded.source_hash,source_revision=excluded.source_revision,plan=excluded.plan,prepared_by=me,status='pending',reviewed_by=null,review_note=null,created_at=now();
 elsif p_action='review' then
  select * into mr from clinic_prices.master_reviews where list_id=lid for update;
  if not found or mr.status<>'pending' or mr.prepared_by=me or l.created_by=me then raise exception 'يلزم مرجع مجهز ومراجع آخر غير منشئ المسودة';end if;
  if mr.source_revision<>l.revision or mr.source_hash<>clinic_prices.master_hash(lid) then raise exception 'المصدر تغير؛ أعد تجهيز المرجع قبل الاعتماد';end if;
  if length(trim(coalesce(p_payload->>'note','')))<5 or coalesce(p_payload->>'decision','') not in ('approved','rejected') then raise exception 'حدد القرار وسبب المراجعة';end if;
  if p_payload->>'decision'='rejected' then update clinic_prices.master_reviews set status='rejected',reviewed_by=me,review_note=p_payload->>'note' where list_id=lid;return lid;end if;
  if not coalesce((p_payload->>'dates_confirmed')::boolean,false) then raise exception 'أكد فترة سريان الأسعار';end if;
  if exists(select 1 from jsonb_array_elements(mr.plan) x where jsonb_array_length(x->'source_rows')>1) and not coalesce((p_payload->>'merge_identical')::boolean,false) then raise exception 'أكد قرار توحيد السطور المتطابقة قبل الاعتماد';end if;
  for r in select * from jsonb_array_elements(mr.plan) loop
   sid:=null;
   if jsonb_array_length(r->'existing_ids')=1 then
    sid:=(r->'existing_ids'->>0)::uuid;
    if not exists(select 1 from public.pricing_services where id=sid and active and name=r->>'name' and category=r->>'category' and canonical_unit=r->>'unit') then raise exception 'تعريف الخدمة تغير؛ أعد التجهيز';end if;
   else
    if exists(select 1 from public.pricing_services where active and name=r->>'name' and category=r->>'category' and canonical_unit=r->>'unit') then raise exception 'خدمة أضيفت بعد التجهيز؛ أعد التجهيز لمنع التكرار';end if;
    insert into public.pricing_services(name,category,canonical_unit,base_price,supplies_used,profit_margin_percent,active,booking_enabled,created_by) values(r->>'name',r->>'category',r->>'unit',0,'[]',0,true,false,mr.prepared_by) returning id into sid;
   end if;
   insert into clinic_prices.items(list_id,service_id,fixed_price,section_id,external_code,external_name,unit,source_ref) values(lid,sid,(r->>'price')::numeric,(r->>'section_id')::uuid,r->'source_rows'->0->>'code',r->>'name',r->>'unit',jsonb_build_object('master_review',lid,'rows',r->'source_rows'));
   for rowj in select * from jsonb_array_elements(r->'source_rows') loop mapping:=mapping||jsonb_build_object(rowj->>'code',sid);end loop;
  end loop;
  for batchrec in select * from clinic_prices.batches where list_id=lid loop
   select jsonb_agg(x||jsonb_build_object('service_id',mapping->>(x->>'code'),'confirmed',true)) into outrows from jsonb_array_elements(batchrec.rows)x;
   update clinic_prices.batches set rows=outrows,status='applied',revision=revision+1 where id=batchrec.id;
  end loop;
  -- Master excludes doctor consultations; unlisted services keep their existing price.
  update clinic_prices.lists set fallback='base',revision=revision+1 where id=lid;
  perform public.price_lists_command('submit',jsonb_build_object('id',lid));
  perform public.price_lists_command('review',jsonb_build_object('id',lid,'decision','active','review_note',p_payload->>'note'));
  for r in select * from jsonb_array_elements(mr.plan) loop for rowj in select * from jsonb_array_elements(r->'source_rows') loop
   sid:=(mapping->>(rowj->>'code'))::uuid;
   if exists(select 1 from clinic_prices.aliases where scope_key='center' and external_code=rowj->>'code' and external_name=r->>'name' and unit=r->>'unit' and service_id<>sid) then raise exception 'كود المصدر مرتبط بخدمة أخرى؛ راجع المطابقة';end if;
   insert into clinic_prices.aliases(scope_key,external_code,external_name,unit,service_id,list_id,reviewed_by) values('center',rowj->>'code',r->>'name',r->>'unit',sid,lid,me) on conflict(scope_key,external_code,external_name,unit) do nothing;
  end loop;end loop;
  update clinic_prices.master_reviews set status='approved',reviewed_by=me,review_note=p_payload->>'note' where list_id=lid;
 else raise exception 'إجراء غير متاح';end if;
 insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,'master_'||p_action,lid,jsonb_build_object('groups',jsonb_array_length(coalesce(planj,mr.plan)),'note',p_payload->>'note'));
 return lid;
end $function$
;
CREATE OR REPLACE FUNCTION clinic_prices.item_mapping_command(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor uuid := public.my_admin_id();
  v_list uuid := nullif(p_payload->>'list_id','')::uuid;
  v_item uuid := nullif(p_payload->>'item_id','')::uuid;
  v_service uuid := nullif(p_payload->>'service_id','')::uuid;
  v_section uuid := nullif(p_payload->>'section_id','')::uuid;
  v_external_name text := nullif(btrim(coalesce(p_payload->>'external_name','')), '');
  v_external_code text := nullif(btrim(coalesce(p_payload->>'external_code','')), '');
  v_unit text := nullif(btrim(coalesce(p_payload->>'unit','')), '');
  v_revision integer;
  v_result jsonb;
begin
  if v_actor is null or not clinic_prices.manage() then
    raise exception 'غير مصرح بإدارة لوائح الأسعار';
  end if;
  if v_list is null or v_item is null or v_service is null then
    raise exception 'بيانات الخدمة أو اللائحة غير مكتملة';
  end if;

  select l.revision into v_revision
  from clinic_prices.lists l
  where l.id=v_list and l.status='draft' and clinic_prices.can_edit(l.id)
  for update;
  if not found then
    raise exception 'يمكن تعديل مطابقة الخدمات في مسودة اللائحة التي أنشأتها فقط';
  end if;

  if not exists(select 1 from clinic_prices.items i where i.id=v_item and i.list_id=v_list) then
    raise exception 'بند الخدمة غير موجود في هذه اللائحة';
  end if;
  if not exists(select 1 from public.pricing_services s where s.id=v_service and s.active) then
    raise exception 'خدمة سونو المختارة غير متاحة';
  end if;
  if v_section is not null and not exists(select 1 from clinic_prices.sections s where s.id=v_section and s.list_id=v_list) then
    raise exception 'القسم المختار لا يتبع هذه اللائحة';
  end if;
  if exists(select 1 from clinic_prices.items i where i.list_id=v_list and i.service_id=v_service and i.id<>v_item) then
    raise exception 'الخدمة المختارة مرتبطة بالفعل ببند آخر في نفس اللائحة';
  end if;

  update clinic_prices.items
  set service_id=v_service,
      section_id=v_section,
      external_name=v_external_name,
      external_code=v_external_code,
      unit=coalesce(v_unit,unit)
  where id=v_item and list_id=v_list
  returning jsonb_build_object(
    'id',id,
    'list_id',list_id,
    'service_id',service_id,
    'section_id',section_id,
    'external_name',external_name,
    'external_code',external_code,
    'unit',unit
  ) into v_result;

  update clinic_prices.lists set revision=revision+1 where id=v_list returning revision into v_revision;
  insert into clinic_prices.audit(actor_id,action,list_id,details)
  values(v_actor,'service_mapping_update',v_list,jsonb_build_object('item_id',v_item,'service_id',v_service,'section_id',v_section,'external_name',v_external_name,'external_code',v_external_code));

  return v_result || jsonb_build_object('revision',v_revision);
end
$function$
;
CREATE OR REPLACE FUNCTION public.price_service_mapping_command(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=public.my_admin_id();action text:=coalesce(p_payload->>'action','item');
 l clinic_prices.lists%rowtype;b clinic_prices.batches%rowtype;s public.pricing_services%rowtype;existing clinic_prices.items%rowtype;
 sid uuid:=nullif(p_payload->>'service_id','')::uuid;idx integer;indexes integer[];r jsonb;firstrow jsonb;outrows jsonb;scope text;sec uuid;prior uuid;proposal uuid;note text:=btrim(coalesce(p_payload->>'note',''));
begin
 if me is null or not clinic_prices.manage() then raise exception 'غير مصرح بإدارة لوائح الأسعار';end if;
 perform pg_advisory_xact_lock(712241024);
 if action='item' then return clinic_prices.item_mapping_command(p_payload);end if;
 if action not in ('source_review','source_defer','source_propose') then raise exception 'إجراء غير متاح';end if;
 select * into l from clinic_prices.lists where id=(p_payload->>'list_id')::uuid for update;
 if not found or l.status<>'draft' or not clinic_prices.can_edit(l.id) or l.list_kind<>'reference' then raise exception 'مراجعة المصدر متاحة لمسودة جهة فقط';end if;
 if l.revision is distinct from (p_payload->>'list_revision')::integer then raise exception 'اللائحة تغيرت؛ أعد تحميلها';end if;
 select * into b from clinic_prices.batches where id=(p_payload->>'batch_id')::uuid and list_id=l.id for update;
 if not found or b.status<>'draft' or b.revision is distinct from (p_payload->>'batch_revision')::integer then raise exception 'الدفعة تغيرت؛ أعد تحميلها';end if;
 if jsonb_typeof(p_payload->'indexes') is distinct from 'array' or jsonb_array_length(p_payload->'indexes') not between 1 and 1000 then raise exception 'اختر من سطر إلى 1000 سطر للمراجعة';end if;
 select array_agg(x::integer) into indexes from jsonb_array_elements_text(p_payload->'indexes') x;
 if (select count(distinct x) from unnest(indexes) x)<>cardinality(indexes) or exists(select 1 from unnest(indexes) x where x is null or x<0 or x>=jsonb_array_length(b.rows)) then raise exception 'سطور مراجعة غير صالحة';end if;
 if length(note)<3 then raise exception 'اكتب سبب قرار المراجعة';end if;
 firstrow:=b.rows->indexes[1];
 select entity_id::text into scope from public.contracting_entity_contracts where id=l.contract_id;
 scope:='list:'||l.id::text;
 if action='source_review' then
  if coalesce((p_payload->>'details_confirmed')::boolean,false)=false then raise exception 'راجع الوحدة والعينة والمستلزمات وأكد تفاصيل الخدمة';end if;
  select * into s from public.pricing_services where id=sid and active;
  if not found then raise exception 'اختر خدمة سونو المتاحة';end if;
 end if;
 foreach idx in array indexes loop
  r:=b.rows->idx;
  if coalesce((r->>'confirmed')::boolean,false) then raise exception 'السطر معتمد بالفعل؛ لا تغير مطابقة معتمدة من دفعة المصدر';end if;
  if cardinality(indexes)>1 and jsonb_build_array(r->>'name',coalesce(r->>'code',''),coalesce(r->>'unit',''),coalesce(r->>'category','')) is distinct from jsonb_build_array(firstrow->>'name',coalesce(firstrow->>'code',''),coalesce(firstrow->>'unit',''),coalesce(firstrow->>'category','')) then raise exception 'الاعتماد الجماعي لنفس الاسم والكود والوحدة والقسم فقط';end if;
  if action='source_review' then
   if nullif(btrim(r->>'name'),'') is null or nullif(r->>'price','') is null or (r->>'price')::numeric<=0 or (r->>'price') in ('NaN','Infinity','-Infinity') then raise exception 'راجع اسم الخدمة وسعر الجهة';end if;
   -- An existing code/name/unit mapping must never be silently redirected.
   if exists(select 1 from clinic_prices.aliases a where a.scope_key=scope and a.unit=coalesce(r->>'unit','') and (a.external_name=r->>'name' or coalesce(r->>'code','')<>'' and a.external_code=r->>'code') and a.service_id<>sid) then raise exception 'تعارض مع Alias معتمد؛ راجع المطابقة السابقة';end if;
   select * into existing from clinic_prices.items where list_id=l.id and service_id=sid;
   if found and (existing.fixed_price is distinct from (r->>'price')::numeric or existing.unit is distinct from coalesce(r->>'unit','')) then raise exception 'الخدمة لها سعر أو وحدة مختلفة في نفس اللائحة؛ راجع التعارض قبل الربط';end if;
   sec:=b.section_id;
   if nullif(btrim(r->>'category'),'') is not null then
    insert into clinic_prices.sections(list_id,name) values(l.id,btrim(r->>'category')) on conflict(list_id,name) do update set name=excluded.name returning id into sec;
   end if;
   insert into clinic_prices.items(list_id,service_id,fixed_price,section_id,external_code,external_name,unit,source_ref,notes)
   values(l.id,sid,(r->>'price')::numeric,sec,coalesce(r->>'code',''),r->>'name',coalesce(r->>'unit',''),jsonb_build_object('batch_id',b.id,'filename',b.filename,'sheet',r->>'sheet','row',r->'row','price_column',coalesce(r->>'price_column','السعر'),'mapping_reviewed_by',me),note)
   on conflict(list_id,service_id) do nothing;
   insert into clinic_prices.aliases(scope_key,external_code,external_name,unit,service_id,list_id,reviewed_by)
   values(scope,coalesce(r->>'code',''),r->>'name',coalesce(r->>'unit',''),sid,l.id,me) on conflict(scope_key,external_code,external_name,unit) do nothing;
   r:=r||jsonb_build_object('service_id',sid,'confirmed',true,'review_status','approved','reviewed_by',me,'reviewed_at',now(),'review_note',note);
  elsif action='source_defer' then
   r:=r||jsonb_build_object('review_status','deferred','review_note',note,'reviewed_by',me,'reviewed_at',now());
  else
   if nullif(btrim(p_payload->>'proposal_category'),'') is null and (nullif(btrim(r->>'category'),'') is null or r->>'category'='غير مصنف') then raise exception 'حدد قسم الخدمة المقترحة';end if;
   if nullif(r->>'proposal_id','') is not null then raise exception 'يوجد اقتراح خدمة لهذا السطر بالفعل';end if;
   if proposal is null then insert into clinic_prices.service_proposals(name,category,unit,note,created_by) values(r->>'name',coalesce(nullif(btrim(p_payload->>'proposal_category'),''),r->>'category'),coalesce(r->>'unit',''),note,me) returning id into proposal;end if;
   r:=r||jsonb_build_object('review_status','proposed','proposal_id',proposal,'review_note',note,'reviewed_by',me,'reviewed_at',now());
  end if;
  b.rows:=jsonb_set(b.rows,array[idx::text],r);
 end loop;
 update clinic_prices.batches set rows=b.rows,revision=revision+1,status=case when not exists(select 1 from jsonb_array_elements(b.rows) x where not coalesce((x->>'confirmed')::boolean,false)) then 'applied' else 'draft' end where id=b.id;
 update clinic_prices.lists set revision=revision+1 where id=l.id;
 insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,action,l.id,jsonb_build_object('batch_id',b.id,'indexes',to_jsonb(indexes),'service_id',sid,'note',note,'source_rows',(select jsonb_agg(b.rows->x) from unnest(indexes) x)));
 return jsonb_build_object('count',cardinality(indexes),'list_revision',l.revision+1,'batch_revision',b.revision+1,'prices_status','draft');
end $function$
;
CREATE OR REPLACE FUNCTION clinic_prices.list_command_previous(p_action text, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  scope:='center';if l.list_kind='reference' then scope:='list:'||l.id::text;end if;
  for i in select * from clinic_prices.items where list_id=v and external_name<>'' loop
   select service_id into prior from clinic_prices.aliases where scope_key=scope and external_code=i.external_code and (external_name=i.external_name or i.external_code<>'' and external_code=i.external_code) and unit=i.unit limit 1;
   if prior is not null and prior<>i.service_id then raise exception 'تعارض مع مطابقة معتمدة للاسم %؛ راجع تعريف الخدمة',i.external_name;end if;
   insert into clinic_prices.aliases(scope_key,external_code,external_name,unit,service_id,list_id,reviewed_by) values(scope,i.external_code,i.external_name,i.unit,i.service_id,v,public.my_admin_id()) on conflict(scope_key,external_code,external_name,unit) do nothing;
  end loop;
 end if;return v;
end $function$
;
CREATE OR REPLACE FUNCTION clinic_prices.list_workspace_previous()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v jsonb;begin
 v:=clinic_prices.workspace_v1();
 return v||jsonb_build_object('sections',(select coalesce(jsonb_agg(s),'[]') from clinic_prices.sections s),'aliases',(select coalesce(jsonb_agg(s),'[]') from clinic_prices.aliases s),'proposals',(select coalesce(jsonb_agg(s order by s.created_at desc),'[]') from clinic_prices.service_proposals s where s.status='pending'),'services',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',coalesce(booking_code,canonical_code),'canonical_code',canonical_code,'category',category,'unit',canonical_unit,'base_price',base_price,'active',active) order by name),'[]') from public.pricing_services),'contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'entity_id',c.entity_id,'category',coalesce(e.category,'cash'),'name',e.name||' — '||coalesce(c.contract_number,c.id::text),'start_date',c.start_date,'end_date',c.end_date,'status',c.status,'service_ids',c.booking_service_ids) order by e.name),'[]') from public.contracting_entity_contracts c join public.contracting_entities e on e.id=c.entity_id));
end $function$
;
create or replace function public.price_lists_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();lid uuid:=nullif(p_payload->>'id','')::uuid;l clinic_prices.lists%rowtype;v uuid;r record;sec uuid;kind text;
begin
 if me is null or not clinic_prices.manage() then raise exception 'لا تملك إدارة لوائح الأسعار';end if;
 perform pg_advisory_xact_lock(712241024);
 if lid is not null then select * into l from clinic_prices.lists where id=lid for update;if not found or l.deleted_at is not null then raise exception 'القائمة غير موجودة أو محذوفة';end if;end if;
 if p_action='permission' then
  if not public.is_super() then raise exception 'إدارة صلاحيات القائمة للسوبر أدمن فقط';end if;
  if not exists(select 1 from public.admins where id=(p_payload->>'admin_id')::uuid and active) then raise exception 'اختر مستخدمًا نشطًا';end if;
  if p_payload->>'can_edit' not in ('true','false') or p_payload->>'can_edit' is null then raise exception 'حدد السماح أو المنع';end if;
  insert into clinic_prices.list_editors(list_id,admin_id,can_edit,updated_by) values(lid,(p_payload->>'admin_id')::uuid,(p_payload->>'can_edit')::boolean,me) on conflict(list_id,admin_id) do update set can_edit=excluded.can_edit,updated_by=me,updated_at=now();
  update clinic_prices.lists set revision=revision+1 where id=lid;
  insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,'list_edit_permission',lid,p_payload);return lid;
 elsif p_action='delete' then
  if not public.is_super() then raise exception 'حذف القوائم للسوبر أدمن فقط';end if;
  if l.status='active' then raise exception 'أنه القائمة النشطة قبل حذفها';end if;
  if exists(select 1 from public.contracting_entity_contracts where price_list_id=lid) then raise exception 'القائمة مرتبطة بعقد؛ فك ارتباطها أولًا';end if;
  if to_regclass('public.insurance_plans') is not null then if exists(select 1 from public.insurance_plans where price_list_id=lid) then raise exception 'القائمة مرتبطة بخطة تأمين؛ فك ارتباطها أولًا';end if;end if;
  if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'اكتب سبب الحذف';end if;
  update clinic_prices.lists set deleted_at=now(),deleted_by=me,revision=revision+1 where id=lid;
  insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,'list_deleted',lid,jsonb_build_object('reason',p_payload->>'reason','name',l.name,'version',l.version,'preserved_history',true));return lid;
 elsif p_action='save' then
  kind:=coalesce(p_payload->>'list_kind',l.list_kind,case when nullif(p_payload->>'contract_id','') is null then 'center' else 'reference' end);
  if l.id is not null and kind<>l.list_kind then raise exception 'نوع القائمة ثابت؛ أنشئ مرجعًا آخر عند الحاجة';end if;
  -- The old contract_id remains provenance only. New bindings are managed from the contract UI.
  if l.id is not null then p_payload:=p_payload||jsonb_build_object('contract_id',l.contract_id);end if;
  v:=clinic_prices.list_command_previous(p_action,p_payload);
  update clinic_prices.lists set list_kind=kind where id=v;
  if l.id is null and nullif(p_payload->>'contract_id','') is not null then update public.contracting_entity_contracts set price_list_id=v,price_list_link_status='pending',price_list_linked_by=me where id=(p_payload->>'contract_id')::uuid and price_list_id is null;end if;
 elsif p_action='clone' then
  v:=clinic_prices.list_command_previous(p_action,p_payload);
  update clinic_prices.lists set list_kind=l.list_kind where id=v;
  for r in select b.*,s.name section_name from clinic_prices.batches b join clinic_prices.sections s on s.id=b.section_id where b.list_id=lid and b.status='draft' loop
   select id into sec from clinic_prices.sections where list_id=v and name=r.section_name;
   if sec is null then insert into clinic_prices.sections(list_id,name) values(v,r.section_name) returning id into sec;end if;
   insert into clinic_prices.batches(list_id,section_id,filename,checksum,operation,rows,split_sections,created_by) values(v,sec,r.filename,r.checksum,r.operation,r.rows,r.split_sections,me);
  end loop;
 else v:=clinic_prices.list_command_previous(p_action,p_payload);end if;
 return v;
end $$;
create or replace function public.price_lists_workspace() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare d jsonb;begin
 d:=clinic_prices.list_workspace_previous();
 return d||jsonb_build_object('is_super',public.is_super(),'lists',(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('can_edit',clinic_prices.can_edit(l.id),'item_count',(select count(*) from clinic_prices.items where list_id=l.id),'batch_count',(select count(*) from clinic_prices.batches where list_id=l.id)) order by l.created_at desc),'[]') from clinic_prices.lists l where deleted_at is null),
 'editors',case when public.is_super() then (select coalesce(jsonb_agg(e),'[]') from clinic_prices.list_editors e) else '[]'::jsonb end,
 'accounts',case when public.is_super() then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.admins where active) else '[]'::jsonb end,
 'contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'entity_id',c.entity_id,'category',coalesce(e.category,'cash'),'name',e.name||' — '||coalesce(c.contract_number,c.id::text),'start_date',c.start_date,'end_date',c.end_date,'status',c.status,'service_ids',c.booking_service_ids,'price_list_id',c.price_list_id,'price_list_terms',c.price_list_terms,'price_list_link_status',c.price_list_link_status,'price_list_link_revision',c.price_list_link_revision,'price_list_linked_by',c.price_list_linked_by,'price_list_reviewed_by',c.price_list_reviewed_by) order by e.name),'[]') from public.contracting_entity_contracts c join public.contracting_entities e on e.id=c.entity_id));
end $$;
create function public.price_contract_list_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.contracting_entity_contracts%rowtype;l clinic_prices.lists%rowtype;me uuid:=public.my_admin_id();r jsonb;terms jsonb:=coalesce(p_payload->'service_terms','[]');begin
 if me is null or not clinic_prices.manage() or not public.can_manage_contracting_entities() then raise exception 'ربط الأسعار يحتاج صلاحية لوائح الأسعار وإدارة الجهات';end if;
 perform pg_advisory_xact_lock(712241024);
 select * into c from public.contracting_entity_contracts where id=(p_payload->>'contract_id')::uuid for update;
 if not found or c.price_list_link_revision is distinct from (p_payload->>'revision')::int then raise exception 'العقد تغير؛ أعد تحميله';end if;
 if p_action='assign' then
  select * into l from clinic_prices.lists where id=(p_payload->>'list_id')::uuid and deleted_at is null and status in ('draft','pending','active');
  if not found then raise exception 'اختر قائمة أسعار موجودة';end if;
  if jsonb_typeof(terms)<>'array' or jsonb_array_length(terms)>1000 then raise exception 'شروط الخدمات غير صالحة';end if;
  if exists(select 1 from jsonb_array_elements(terms) t group by t->>'service_id' having count(*)>1) then raise exception 'شروط الخدمة مكررة';end if;
  for r in select * from jsonb_array_elements(terms) loop
   if (r ? 'excluded' and jsonb_typeof(r->'excluded')<>'boolean') or (r ? 'requires_authorization' and jsonb_typeof(r->'requires_authorization')<>'boolean') then raise exception 'راجع شروط الاستثناء والموافقة';end if;
   if not exists(select 1 from public.pricing_services where id=(r->>'service_id')::uuid and active) or (r ? 'coverage_percent' and ((r->>'coverage_percent')::numeric not between 0 and 100 or r->>'coverage_percent' in ('NaN','Infinity','-Infinity'))) or r ? 'fixed_price' or r ? 'price' then raise exception 'راجع الخدمة ونسبة التحمل؛ السعر يأتي من المرجع المشترك';end if;
  end loop;
  update public.contracting_entity_contracts set price_list_id=l.id,price_list_terms=terms,price_list_link_status='pending',price_list_link_revision=price_list_link_revision+1,price_list_linked_by=me,price_list_reviewed_by=null where id=c.id;
 elsif p_action='approve' then
  if c.price_list_id is null or c.price_list_linked_by=me or c.price_list_link_status<>'pending' then raise exception 'اعتماد الربط يحتاج مراجعًا آخر';end if;
  if not exists(select 1 from clinic_prices.lists where id=c.price_list_id and status='active' and deleted_at is null) or c.status<>'active' then raise exception 'اعتمد القائمة والعقد قبل تفعيل الربط';end if;
  update public.contracting_entity_contracts set price_list_link_status='active',price_list_reviewed_by=me,price_list_link_revision=price_list_link_revision+1 where id=c.id;
 elsif p_action='detach' then
  if not public.is_super() then raise exception 'فك ارتباط القائمة للسوبر أدمن فقط';end if;if c.price_list_id is null then raise exception 'العقد غير مرتبط بقائمة';end if;
  update public.contracting_entity_contracts set price_list_id=null,price_list_terms='[]',price_list_link_status='pending',price_list_link_revision=price_list_link_revision+1,price_list_linked_by=me,price_list_reviewed_by=null where id=c.id;
 else raise exception 'إجراء غير متاح';end if;
 insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,'contract_list_'||p_action,coalesce(l.id,c.price_list_id),jsonb_build_object('contract_id',c.id,'old_list_id',c.price_list_id,'new_list_id',l.id,'previous_terms',c.price_list_terms,'new_terms',terms));
 return c.id;
end $$;
create or replace function clinic_prices.resolve_explicit_list(p_service uuid,p_base numeric,p_date date,p_list uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare l clinic_prices.lists%rowtype;i clinic_prices.items%rowtype;val numeric:=p_base;pc numeric:=0;dc numeric:=0;begin
 select * into l from clinic_prices.lists where id=p_list and status='active' and deleted_at is null and (list_kind='reference' or p_date between valid_from and valid_to);
 if not found then raise exception 'قائمة الأسعار غير معتمدة أو غير متاحة للتطبيق';end if;
 select * into i from clinic_prices.items where list_id=l.id and service_id=p_service;
 if l.list_kind='reference' and (i.id is null or i.fixed_price is null) then raise exception 'الخدمة ليس لها سعر معتمد في المرجع المختار';end if;
 if i.id is not null then val:=coalesce(i.fixed_price,p_base);pc:=i.discount_percent;dc:=i.discount_amount;
 elsif l.fallback='block' then raise exception 'الخدمة غير مشمولة في اللائحة %',l.name;end if;
 if i.id is not null or l.fallback='discount' then pc:=1-(1-pc/100)*(1-l.discount_percent/100);val:=val*(1-pc)-dc-l.discount_amount;end if;
 if val<=0 then raise exception 'التسعير يجعل السعر صفرًا أو سالبًا';end if;
 return jsonb_build_object('price',round(val,2),'reason',l.name||' — إصدار '||l.issue_year||' — نسخة '||l.version,'source','price_list','list_id',l.id,'version',l.version,'list_terms',to_jsonb(l)-'created_by'-'reviewed_by','item_terms',to_jsonb(i));
end $$;
create or replace function clinic_prices.resolve(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare lid uuid;c public.contracting_entity_contracts%rowtype;q jsonb;t jsonb;coverage numeric:=0;begin
 if p_contract is null then
  select id into lid from clinic_prices.lists where list_kind='center' and deleted_at is null and status='active' and p_date between valid_from and valid_to;
  if lid is null then return jsonb_build_object('price',round(p_base,2),'source','existing','reason','أسعار سونو / دار النقاهة');end if;
  return clinic_prices.resolve_explicit_list(p_service,p_base,p_date,lid);
 end if;
 select * into c from public.contracting_entity_contracts where id=p_contract and status='active' and p_date between start_date and coalesce(end_date,'9999-12-31');
 if not found or c.price_list_id is null or c.price_list_link_status<>'active' then raise exception 'لا توجد قائمة أسعار مرتبطة ومعتمدة لعقد الجهة؛ لا يستخدم سعر سونو بدلًا منها';end if;
 q:=clinic_prices.resolve_explicit_list(p_service,p_base,p_date,c.price_list_id);
 select x into t from jsonb_array_elements(c.price_list_terms) x where x->>'service_id'=p_service::text;
 if coalesce((t->>'excluded')::boolean,false) then raise exception 'الخدمة مستثناة من عقد الجهة';end if;
 if c.booking_billing_kind='insurer' then coverage:=coalesce((t->>'coverage_percent')::numeric,c.booking_coverage,0);end if;
 return q||jsonb_build_object('contract_id',c.id,'contract_terms',coalesce(t,'{}'),'coverage',coverage,'requires_authorization',coalesce((t->>'requires_authorization')::boolean,false));
end $$;
CREATE OR REPLACE FUNCTION public.price_service_mapping_workspace(p_list uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 if public.my_admin_id() is null or not clinic_prices.manage() then raise exception 'غير مصرح بإدارة لوائح الأسعار';end if;
 return jsonb_build_object('stats',(select coalesce(jsonb_agg(x),'[]') from (
 select l.id list_id,count(r.value) total,count(r.value) filter(where coalesce((r.value->>'confirmed')::boolean,false)) confirmed,
 count(r.value) filter(where not coalesce((r.value->>'confirmed')::boolean,false)) unresolved
 from clinic_prices.lists l left join clinic_prices.batches b on b.list_id=l.id and b.status<>'discarded'
 left join lateral jsonb_array_elements(b.rows) r on true where l.list_kind='reference' and l.deleted_at is null group by l.id)x),
 'batches',(select coalesce(jsonb_agg(b order by b.created_at,b.id),'[]') from clinic_prices.batches b join clinic_prices.lists l on l.id=b.list_id where b.list_id=p_list and l.list_kind='reference' and l.deleted_at is null and b.status<>'discarded'),
 'audit',(select coalesce(jsonb_agg(x),'[]') from (select actor_id,action,details,created_at from clinic_prices.audit where list_id=p_list order by id desc limit 30)x));
end $function$
;
CREATE OR REPLACE FUNCTION public.price_lists_preview(p_service uuid, p_date date, p_contract uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare s public.pricing_services%rowtype;line jsonb;sp public.pricing_supplies%rowtype;value numeric;center jsonb;quote jsonb;coverage numeric:=0;begin
 if not clinic_prices.manage() then raise exception 'لا تملك إدارة لوائح الأسعار';end if;
 select * into s from public.pricing_services where id=p_service and active;if not found then raise exception 'الخدمة غير متاحة';end if;value:=s.base_price;
 for line in select * from jsonb_array_elements(coalesce(s.supplies_used,'[]')) loop select * into sp from public.pricing_supplies where id=(line->>'supply_id')::uuid and active;if not found or sp.units_per_package<=0 then raise exception 'أكمل مستلزمات الخدمة';end if;value:=value+(line->>'quantity')::numeric*sp.package_price/sp.units_per_package;end loop;
 value:=round(value*(1+s.profit_margin_percent/100),2);center:=clinic_prices.resolve(s.id,value,p_date);quote:=center;
 if p_contract is not null then
  if not exists(select 1 from public.contracting_entity_contracts where id=p_contract and status='active' and p_date between start_date and coalesce(end_date,'9999-12-31') and s.id=any(booking_service_ids)) then raise exception 'عقد الجهة لا يشمل الخدمة أو التاريخ';end if;
  quote:=clinic_prices.resolve(s.id,(center->>'price')::numeric,p_date,p_contract);
  select case when booking_billing_kind='insurer' then booking_coverage else 0 end into coverage from public.contracting_entity_contracts where id=p_contract;
 end if;
 coverage:=coalesce((quote->>'coverage')::numeric,coverage);value:=(quote->>'price')::numeric;return quote||jsonb_build_object('center_price',(center->>'price')::numeric,'payer',round(value*coverage/100,2),'patient',value-round(value*coverage/100,2),'currency','EGP');
end $function$
;
CREATE OR REPLACE FUNCTION clinic_reception.sync_catalog(p_workspace uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare x record;l jsonb;ss public.pricing_supplies%rowtype;it public.inventory_items%rowtype;sid uuid;version_no integer;finger text;cfg jsonb;price numeric;bom jsonb;lines jsonb;service clinic_reception.services%rowtype;quantity numeric;max_visit integer;price_evidence jsonb;
begin
 -- Same lock order as booking commands, before touching shared native mappings.
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 perform clinic_reception.sync_native_links(p_workspace);
 if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then return;end if;
 delete from clinic_reception.catalog_issues where workspace_id=p_workspace;
 -- Disabled/deleted native services cannot be sold again; existing order snapshots stay unchanged.
 update clinic_reception.services r set active=false where r.workspace_id=p_workspace and (r.pricing_service_id is null or not exists(select 1 from public.pricing_services s where s.id=r.pricing_service_id and s.active and s.booking_enabled));
 for x in select * from public.pricing_services where active and booking_enabled order by id loop
 begin
  if length(trim(coalesce(x.booking_code,'')))<2 or length(trim(coalesce(x.booking_department,'')))<2 or x.booking_minutes is null then raise exception 'أكمل إعداد الحجز للخدمة % داخل التسعير',x.name;end if;
  price:=x.base_price;bom:='[]';
  for l in select * from jsonb_array_elements(coalesce(x.supplies_used,'[]')) loop
   select * into ss from public.pricing_supplies where id=(l->>'supply_id')::uuid and active;
   if not found or ss.inventory_item_id is null or ss.inventory_quantity_per_unit is null or ss.units_per_package<=0 then raise exception 'اربط مستلزم % بالصنف ووحدة المخزن من نموذج التسعير',coalesce(ss.name,l->>'supply_id');end if;
   select * into it from public.inventory_items where id=ss.inventory_item_id and active;if not found then raise exception 'صنف المستلزم غير متاح';end if;
   quantity:=clinic_reception.number(l->>'quantity',3);price:=price+quantity*ss.package_price/ss.units_per_package;
   select id into sid from clinic_reception.items where workspace_id=p_workspace and inventory_item_id=it.id;
   bom:=bom||jsonb_build_array(jsonb_build_object('item_id',sid,'quantity',quantity*ss.inventory_quantity_per_unit,'included',true));
  end loop;
  price:=round(price*(1+x.profit_margin_percent/100),2);
  price_evidence:=clinic_prices.resolve(x.id,price,clinic_reception.today());price:=(price_evidence->>'price')::numeric;
  cfg:=jsonb_build_object('pricing',price_evidence,'code',x.booking_code,'name',x.name,'department',x.booking_department,'minutes',x.booking_minutes,'requires_device',x.booking_requires_device,'price',price,'bom',bom);finger:=md5(cfg::text);
  if exists(select 1 from clinic_reception.services where workspace_id=p_workspace and pricing_service_id=x.id and source_fingerprint=finger and active) then continue;end if;
  update clinic_reception.services set active=false where workspace_id=p_workspace and (pricing_service_id=x.id or code=x.booking_code);
  select coalesce(max(version),0)+1 into version_no from clinic_reception.services where workspace_id=p_workspace and code=x.booking_code;
  insert into clinic_reception.services(workspace_id,code,name,version,department,minutes,requires_device,price,bom,pricing_service_id,source_fingerprint,pricing_evidence) values(p_workspace,x.booking_code,x.name,version_no,x.booking_department,x.booking_minutes,x.booking_requires_device,price,bom,x.id,finger,price_evidence);
 exception when raise_exception or invalid_text_representation or invalid_parameter_value or division_by_zero or numeric_value_out_of_range or check_violation or not_null_violation then
  update clinic_reception.services set active=false where workspace_id=p_workspace and pricing_service_id=x.id;
  insert into clinic_reception.catalog_issues(workspace_id,kind,source_id,name,detail) values(p_workspace,'services',x.id,x.name,sqlerrm);
 end;
 end loop;
 -- Structured service selection is configured in the existing entity contract. Never parse free-text services.
 update clinic_reception.entity_contracts r set status='rejected' where r.workspace_id=p_workspace and r.external_contract_id is not null and not exists(select 1 from public.contracting_entity_contracts c where c.id=r.external_contract_id and c.status='active' and clinic_reception.today() between c.start_date and coalesce(c.end_date,'9999-12-31'));
 for x in select c.*,e.name entity_name from public.contracting_entity_contracts c join public.contracting_entities e on e.id=c.entity_id where c.status='active' and cardinality(c.booking_service_ids)>0 and clinic_reception.today() between c.start_date and coalesce(c.end_date,'9999-12-31') loop
 begin
  select id into sid from clinic_reception.entities where workspace_id=p_workspace and contracting_entity_id=x.entity_id and kind=x.booking_billing_kind;
  if sid is null then insert into clinic_reception.entities(workspace_id,name,kind,contracting_entity_id) values(p_workspace,x.entity_name,x.booking_billing_kind,x.entity_id) returning id into sid;end if;
  for service in select * from clinic_reception.services where workspace_id=p_workspace and active and pricing_service_id=any(x.booking_service_ids) loop
   if service.price<=0 then raise exception 'راجع سعر الخدمة في عقد الجهة';end if;
   cfg:=clinic_prices.resolve(service.pricing_service_id,service.price,clinic_reception.today(),x.id);
   finger:=md5(jsonb_build_array(cfg,x.id,service.id,service.price,x.discount_percent,x.booking_billing_kind,x.booking_coverage,x.start_date,x.end_date,x.terms_notes,x.cashback_percent)::text);
   if exists(select 1 from clinic_reception.entity_contracts where workspace_id=p_workspace and external_contract_id=x.id and service_code=service.code and source_fingerprint=finger and status='active') then continue;end if;
   update clinic_reception.entity_contracts set status='rejected' where workspace_id=p_workspace and external_contract_id=x.id and service_code=service.code;
   insert into clinic_reception.entity_contracts(workspace_id,entity_id,service_code,price,coverage,valid_from,valid_to,reference,terms,status,created_by,external_contract_id,source_fingerprint,source_terms)
   values(p_workspace,sid,service.code,(cfg->>'price')::numeric,coalesce((cfg->>'coverage')::numeric,case when x.booking_billing_kind='insurer' then x.booking_coverage else 0 end),x.start_date,coalesce(x.end_date,'9999-12-31'),coalesce(x.contract_number,x.id::text),coalesce(x.terms_notes,''),'active',x.created_by,x.id,finger,jsonb_build_object('cashback_percent',coalesce(x.cashback_percent,0),'pricing',cfg));
  end loop;
 exception when raise_exception or invalid_text_representation or invalid_parameter_value or division_by_zero or numeric_value_out_of_range or check_violation or not_null_violation then
  update clinic_reception.entity_contracts set status='rejected' where workspace_id=p_workspace and external_contract_id=x.id;
  insert into clinic_reception.catalog_issues(workspace_id,kind,source_id,name,detail) values(p_workspace,'contracts',x.id,x.entity_name,sqlerrm);
 end;
 end loop;
 update clinic_reception.package_templates r set active=false where r.workspace_id=p_workspace and (r.pricing_package_id is null or not exists(select 1 from public.pricing_packages p where p.id=r.pricing_package_id and p.active and p.booking_enabled));
 for x in select * from public.pricing_packages where active and booking_enabled order by id loop
 begin
  if x.booking_visits is null or x.booking_validity_days is null or length(trim(coalesce(x.booking_terms,'')))<3 then raise exception 'أكمل زيارات وصلاحية وشروط الباكج % في التسعير',x.name;end if;
  lines:='[]';price:=0;max_visit:=0;
  for l in select * from jsonb_array_elements(coalesce(x.services_included,'[]')) loop
   select * into service from clinic_reception.services where workspace_id=p_workspace and pricing_service_id=(l->>'service_id')::uuid and active;
   if not found or service.price<=0 then raise exception 'فعّل الخدمة بسعر مستقل موجب قبل الباكج %',x.name;end if;
   if nullif(l->>'visit_no','') is null or (l->>'visit_no')::integer not between 1 and x.booking_visits then raise exception 'حدد رقم الزيارة لكل خدمة داخل الباكج %',x.name;end if;
   quantity:=clinic_reception.number(l->>'quantity',3);price:=price+service.price*quantity;max_visit:=greatest(max_visit,(l->>'visit_no')::integer);
   lines:=lines||jsonb_build_array(jsonb_build_object('visit_no',(l->>'visit_no')::integer,'service_id',service.id,'quantity',quantity,'standalone_price',service.price,'snapshot',to_jsonb(service)));
  end loop;
  if price<=0 or max_visit<>x.booking_visits or (select count(distinct (l2->>'visit_no')::integer) from jsonb_array_elements(lines) l2)<>x.booking_visits then raise exception 'حدد خدمات كل زيارة في الباكج %',x.name;end if;
  price:=round(price*(1+x.profit_margin_percent/100),2);finger:=md5(jsonb_build_array(x.name,price,x.booking_visits,x.booking_validity_days,x.booking_terms,lines)::text);
  if exists(select 1 from clinic_reception.package_templates where workspace_id=p_workspace and pricing_package_id=x.id and source_fingerprint=finger and active) then continue;end if;
  update clinic_reception.package_templates set active=false where workspace_id=p_workspace and pricing_package_id=x.id;
  select coalesce(max(version),0)+1 into version_no from clinic_reception.package_templates where workspace_id=p_workspace and code='PKG-'||x.id;
  insert into clinic_reception.package_templates(workspace_id,code,name,version,price,visits,validity_days,terms,pricing_package_id,source_fingerprint) values(p_workspace,'PKG-'||x.id,x.name,version_no,price,x.booking_visits,x.booking_validity_days,x.booking_terms,x.id,finger) returning id into sid;
  insert into clinic_reception.template_lines(template_id,visit_no,service_id,quantity,standalone_price,service_snapshot) select sid,(j->>'visit_no')::integer,(j->>'service_id')::uuid,(j->>'quantity')::numeric,(j->>'standalone_price')::numeric,j->'snapshot' from jsonb_array_elements(lines)j;
 exception when raise_exception or invalid_text_representation or invalid_parameter_value or division_by_zero or numeric_value_out_of_range or check_violation or not_null_violation then
  update clinic_reception.package_templates set active=false where workspace_id=p_workspace and pricing_package_id=x.id;
  insert into clinic_reception.catalog_issues(workspace_id,kind,source_id,name,detail) values(p_workspace,'packages',x.id,x.name,sqlerrm);
 end;
 end loop;
end $function$
;
-- Display the legal ownership once; the service catalog is unchanged.
update clinic_prices.lists set name='قائمة أسعار سونو / دار النقاهة',notes=notes||E'\nسونو مركز تابع لشركة دار النقاهة؛ الاسمان يشيران لنفس مرجع الأسعار.' where list_kind='center' and name='لائحة أسعار المركز';
-- Each tariff year stays independent; placeholders contain no invented prices.
insert into clinic_prices.lists(name,version,mode,fallback,valid_from,valid_to,created_by,issue_year,application_year,list_kind,notes)
select 'لائحة نقابة الأطباء '||y,1,'fixed','block',current_date,current_date,(select created_by from clinic_prices.lists where list_kind='center' order by created_at limit 1),y,y,'reference','مرجع مستقل حسب توضيح الإدارة المالية. ملف أسعار هذا الإصدار لم يرد بعد؛ المسودة فارغة ولا تطبق على المرضى. تواريخ الشاشة لا تمثل تاريخ عقد.' from unnest(array[2024,2025]) y where not exists(select 1 from clinic_prices.lists where issue_year=y and name ilike '%اطباء%' or issue_year=y and name ilike '%أطباء%');
-- Reusable tariff aliases are scoped to the list; old entity aliases remain for compatibility.
insert into clinic_prices.aliases(scope_key,external_code,external_name,unit,service_id,list_id,reviewed_by,reviewed_at)
select 'list:'||a.list_id,a.external_code,a.external_name,a.unit,a.service_id,a.list_id,a.reviewed_by,a.reviewed_at from clinic_prices.aliases a join clinic_prices.lists l on l.id=a.list_id where l.list_kind='reference' and a.scope_key not like 'list:%' on conflict(scope_key,external_code,external_name,unit) do nothing;
revoke all on function clinic_prices.can_edit(uuid),clinic_prices.list_command_previous(text,jsonb),clinic_prices.list_workspace_previous(),clinic_prices.resolve_explicit_list(uuid,numeric,date,uuid),clinic_prices.resolve(uuid,numeric,date,uuid) from public,anon,authenticated;
revoke all on function public.price_contract_list_command(text,jsonb) from public,anon;
grant execute on function public.price_contract_list_command(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
