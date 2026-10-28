CREATE OR REPLACE FUNCTION public.price_import_command(p_action text, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=public.my_admin_id();lid uuid:=nullif(p_payload->>'list_id','')::uuid;v uuid:=nullif(p_payload->>'id','')::uuid;l clinic_prices.lists%rowtype;b clinic_prices.batches%rowtype;r jsonb;sid uuid;target_section uuid;props clinic_prices.service_proposals%rowtype;section_row clinic_prices.sections%rowtype;replacement uuid;item_count integer;batch_count integer;begin
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
  if v is null then
   insert into clinic_prices.sections(list_id,name) values(lid,trim(p_payload->>'name')) returning id into v;
  else
   select * into section_row from clinic_prices.sections where id=v and list_id=lid for update;
   if not found then raise exception 'القسم غير موجود في هذه القائمة';end if;
   update clinic_prices.sections set name=trim(p_payload->>'name') where id=v and list_id=lid;
  end if;
 elsif p_action='section_delete' then
  select * into section_row from clinic_prices.sections where id=v and list_id=lid for update;
  if not found then raise exception 'القسم غير موجود في هذه القائمة';end if;
  replacement:=nullif(p_payload->>'replacement_section_id','')::uuid;
  select count(*) into item_count from clinic_prices.items where list_id=lid and section_id=v;
  select count(*) into batch_count from clinic_prices.batches where list_id=lid and section_id=v;
  if replacement is not null and (replacement=v or not exists(select 1 from clinic_prices.sections where list_id=lid and id=replacement)) then raise exception 'اختر قسمًا بديلًا من نفس القائمة';end if;
  if (item_count>0 or batch_count>0) and replacement is null then raise exception 'القسم مرتبط ببنود أو دفعات؛ اختر قسمًا بديلًا لنقل المحتويات دون حذفها';end if;
  if replacement is not null then
   update clinic_prices.items set section_id=replacement where list_id=lid and section_id=v;
   update clinic_prices.batches set section_id=replacement,revision=revision+1 where list_id=lid and section_id=v;
  end if;
  delete from clinic_prices.sections where list_id=lid and id=v;
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
 insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,p_action,lid,jsonb_build_object('id',v,'operation',p_payload->>'operation','rates',p_payload->'rates','section_name',p_payload->>'name','previous_name',section_row.name,'replacement_section_id',replacement,'moved_items',item_count,'moved_batches',batch_count));
 return v;
end $function$
;
REVOKE ALL ON FUNCTION public.price_import_command(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.price_import_command(text,jsonb) TO authenticated;

