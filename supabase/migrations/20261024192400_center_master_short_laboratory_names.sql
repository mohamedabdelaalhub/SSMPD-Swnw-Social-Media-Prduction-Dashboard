begin;
create or replace function public.price_master_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare lid uuid:=(p_payload->>'list_id')::uuid;me uuid:=public.my_admin_id();l clinic_prices.lists%rowtype;mr clinic_prices.master_reviews%rowtype;planj jsonb;r jsonb;batchrec clinic_prices.batches%rowtype;sid uuid;cnt integer;source_n integer;items_n integer;mapping jsonb:='{}';outrows jsonb;rowj jsonb;begin
 if not clinic_prices.manage() then raise exception 'تحتاج إدارة لوائح الأسعار';end if;
 perform pg_advisory_xact_lock(712241024);
 select * into l from clinic_prices.lists where id=lid for update;
 if not found or l.contract_id is not null or l.status<>'draft' then raise exception 'المسار مخصص لمسودة لائحة المركز فقط';end if;
 if l.revision<>coalesce((p_payload->>'revision')::int,0) then raise exception 'اللائحة تغيرت؛ أعد تحميلها';end if;
 if p_action='prepare' then
  if l.mode<>'fixed' or l.discount_percent<>0 or l.discount_amount<>0 then raise exception 'مرجع المركز يحتاج لائحة أسعار ثابتة دون خصم عام';end if;
  if l.created_by<>me then raise exception 'تجهيز المرجع لصاحب المسودة';end if;
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
end $$;
commit;
