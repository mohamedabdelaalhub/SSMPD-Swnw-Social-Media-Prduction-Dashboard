alter table clinic_prices.list_editors add column can_clone boolean;
create or replace function clinic_prices.can_clone(p_list uuid) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare allowed boolean;begin
 if public.my_admin_id() is null or not clinic_prices.manage() then return false;end if;
 if not exists(select 1 from clinic_prices.lists where id=p_list and deleted_at is null) then return false;end if;
 select can_clone into allowed from clinic_prices.list_editors where list_id=p_list and admin_id=public.my_admin_id();
 if found and allowed is not null then return allowed;end if;
 return public.is_super();
end $$;
revoke all on function clinic_prices.can_clone(uuid) from public,anon,authenticated;
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
 if p_action in ('submit','retire') and not clinic_prices.can_edit(l.id) then raise exception 'التعديل غير مسموح لهذه القائمة';end if;
 if p_action='clone' and not clinic_prices.can_clone(l.id) then raise exception 'إنشاء إصدار جديد يحتاج صلاحية يمنحها السوبر أدمن';end if;
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
  if p_payload ? 'can_clone' and (p_payload->>'can_clone' is null or p_payload->>'can_clone' not in ('true','false')) then raise exception 'حدد صلاحية إنشاء إصدار جديد';end if;
  insert into clinic_prices.list_editors(list_id,admin_id,can_edit,can_clone,updated_by) values(lid,(p_payload->>'admin_id')::uuid,(p_payload->>'can_edit')::boolean,case when p_payload ? 'can_clone' then (p_payload->>'can_clone')::boolean else null end,me) on conflict(list_id,admin_id) do update set can_edit=excluded.can_edit,can_clone=case when p_payload ? 'can_clone' then excluded.can_clone else clinic_prices.list_editors.can_clone end,updated_by=me,updated_at=now();
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
  if not clinic_prices.can_clone(l.id) then raise exception 'إنشاء إصدار جديد يحتاج صلاحية يمنحها السوبر أدمن';end if;
  if not coalesce((p_payload->>'clone_confirmed')::boolean,false) then raise exception 'افتح إعدادات الإصدار الجديد وأكد الإنشاء أولًا';end if;
  if l.revision<>coalesce((p_payload->>'source_revision')::int,0) then raise exception 'القائمة المصدر تغيرت؛ أعد فتح إعدادات الإصدار';end if;
  if length(btrim(coalesce(p_payload->>'name',''))) not between 1 and 200 then raise exception 'اكتب اسم الإصدار الجديد';end if;
  if coalesce((p_payload->>'version')::int,0)<1 then raise exception 'حدد رقم نسخة صحيحًا';end if;
  if exists(select 1 from clinic_prices.lists where name=btrim(p_payload->>'name') and version=(p_payload->>'version')::int) then raise exception 'الاسم ورقم النسخة مستخدمان؛ غيّر أحدهما';end if;
  if p_payload->>'mode' not in ('fixed','mixed','discount') or p_payload->>'fallback' not in ('block','base','discount') then raise exception 'حدد طريقة التسعير والخدمات غير المدرجة';end if;
  if not coalesce((p_payload->>'copy_sections')::boolean,true) and (coalesce((p_payload->>'copy_items')::boolean,true) or coalesce((p_payload->>'copy_batches')::boolean,true)) then raise exception 'نسخ الخدمات أو الدفعات يتطلب نسخ أقسامها';end if;
  v:=clinic_prices.list_command_previous(p_action,p_payload);
  update clinic_prices.lists set list_kind=l.list_kind,name=btrim(p_payload->>'name'),version=(p_payload->>'version')::int,issue_year=(p_payload->>'issue_year')::int,application_year=(p_payload->>'application_year')::int,mode=p_payload->>'mode',fallback=p_payload->>'fallback',discount_percent=coalesce((p_payload->>'discount_percent')::numeric,0),discount_amount=coalesce((p_payload->>'discount_amount')::numeric,0),allow_extra_discount=coalesce((p_payload->>'allow_extra_discount')::boolean,false),valid_from=(p_payload->>'valid_from')::date,valid_to=(p_payload->>'valid_to')::date,notes=coalesce(p_payload->>'notes','') where id=v;
  if not coalesce((p_payload->>'copy_items')::boolean,true) then delete from clinic_prices.items where list_id=v;end if;
  if coalesce((p_payload->>'copy_batches')::boolean,true) then
   for r in select b.*,s.name section_name from clinic_prices.batches b join clinic_prices.sections s on s.id=b.section_id where b.list_id=lid and b.status='draft' loop
    select id into sec from clinic_prices.sections where list_id=v and name=r.section_name;
    if sec is null then insert into clinic_prices.sections(list_id,name) values(v,r.section_name) returning id into sec;end if;
    insert into clinic_prices.batches(list_id,section_id,filename,checksum,operation,rows,split_sections,created_by) values(v,sec,r.filename,r.checksum,r.operation,r.rows,r.split_sections,me);
   end loop;
  end if;
  if not coalesce((p_payload->>'copy_sections')::boolean,true) then delete from clinic_prices.sections where list_id=v;end if;
  insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,'clone_settings',v,jsonb_build_object('source_list_id',lid,'source_revision',l.revision,'settings',p_payload,'created_status','draft','contracts_relinked',false));
 else v:=clinic_prices.list_command_previous(p_action,p_payload);end if;
 return v;
end $$;
create or replace function public.price_lists_workspace() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare d jsonb;begin
 d:=clinic_prices.list_workspace_previous();
 return d||jsonb_build_object('is_super',public.is_super(),'lists',(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('can_edit',clinic_prices.can_edit(l.id),'can_clone',clinic_prices.can_clone(l.id),'item_count',(select count(*) from clinic_prices.items where list_id=l.id),'batch_count',(select count(*) from clinic_prices.batches where list_id=l.id)) order by l.created_at desc),'[]') from clinic_prices.lists l where deleted_at is null),
 'editors',case when public.is_super() then (select coalesce(jsonb_agg(e),'[]') from clinic_prices.list_editors e) else '[]'::jsonb end,
 'accounts',case when public.is_super() then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'is_super',role='super_admin')),'[]') from public.admins where active) else '[]'::jsonb end,
 'contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'entity_id',c.entity_id,'category',coalesce(e.category,'cash'),'name',e.name||' — '||coalesce(c.contract_number,c.id::text),'start_date',c.start_date,'end_date',c.end_date,'status',c.status,'service_ids',c.booking_service_ids,'price_list_id',c.price_list_id,'price_list_terms',c.price_list_terms,'price_list_link_status',c.price_list_link_status,'price_list_link_revision',c.price_list_link_revision,'price_list_linked_by',c.price_list_linked_by,'price_list_reviewed_by',c.price_list_reviewed_by) order by e.name),'[]') from public.contracting_entity_contracts c join public.contracting_entities e on e.id=c.entity_id));
end $$;
revoke all on function public.price_lists_command(text,jsonb),public.price_lists_workspace() from public,anon;
grant execute on function public.price_lists_command(text,jsonb),public.price_lists_workspace() to authenticated;

