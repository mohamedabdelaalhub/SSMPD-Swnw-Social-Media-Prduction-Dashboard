begin;
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
  where l.id=v_list and l.status='draft' and l.created_by=v_actor
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

-- Reuse private batches, aliases, proposals and audit; do not create a second catalog.
create or replace function public.price_service_mapping_workspace(p_list uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if public.my_admin_id() is null or not clinic_prices.manage() then raise exception 'غير مصرح بإدارة لوائح الأسعار';end if;
 return jsonb_build_object('stats',(select coalesce(jsonb_agg(x),'[]') from (
 select l.id list_id,count(r.value) total,count(r.value) filter(where coalesce((r.value->>'confirmed')::boolean,false)) confirmed,
 count(r.value) filter(where not coalesce((r.value->>'confirmed')::boolean,false)) unresolved
 from clinic_prices.lists l left join clinic_prices.batches b on b.list_id=l.id and b.status<>'discarded'
 left join lateral jsonb_array_elements(b.rows) r on true where l.contract_id is not null group by l.id)x),
 'batches',(select coalesce(jsonb_agg(b order by b.created_at,b.id),'[]') from clinic_prices.batches b join clinic_prices.lists l on l.id=b.list_id where b.list_id=p_list and l.contract_id is not null and b.status<>'discarded'),
 'audit',(select coalesce(jsonb_agg(x),'[]') from (select actor_id,action,details,created_at from clinic_prices.audit where list_id=p_list order by id desc limit 30)x));
end $$;
create or replace function public.price_service_mapping_command(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();action text:=coalesce(p_payload->>'action','item');
 l clinic_prices.lists%rowtype;b clinic_prices.batches%rowtype;s public.pricing_services%rowtype;existing clinic_prices.items%rowtype;
 sid uuid:=nullif(p_payload->>'service_id','')::uuid;idx integer;indexes integer[];r jsonb;firstrow jsonb;outrows jsonb;scope text;sec uuid;prior uuid;proposal uuid;note text:=btrim(coalesce(p_payload->>'note',''));
begin
 if me is null or not clinic_prices.manage() then raise exception 'غير مصرح بإدارة لوائح الأسعار';end if;
 perform pg_advisory_xact_lock(712241024);
 if action='item' then return clinic_prices.item_mapping_command(p_payload);end if;
 if action not in ('source_review','source_defer','source_propose') then raise exception 'إجراء غير متاح';end if;
 select * into l from clinic_prices.lists where id=(p_payload->>'list_id')::uuid for update;
 if not found or l.status<>'draft' or l.contract_id is null then raise exception 'مراجعة المصدر متاحة لمسودة جهة فقط';end if;
 if l.revision is distinct from (p_payload->>'list_revision')::integer then raise exception 'اللائحة تغيرت؛ أعد تحميلها';end if;
 select * into b from clinic_prices.batches where id=(p_payload->>'batch_id')::uuid and list_id=l.id for update;
 if not found or b.status<>'draft' or b.revision is distinct from (p_payload->>'batch_revision')::integer then raise exception 'الدفعة تغيرت؛ أعد تحميلها';end if;
 if jsonb_typeof(p_payload->'indexes') is distinct from 'array' or jsonb_array_length(p_payload->'indexes') not between 1 and 1000 then raise exception 'اختر من سطر إلى 1000 سطر للمراجعة';end if;
 select array_agg(x::integer) into indexes from jsonb_array_elements_text(p_payload->'indexes') x;
 if (select count(distinct x) from unnest(indexes) x)<>cardinality(indexes) or exists(select 1 from unnest(indexes) x where x is null or x<0 or x>=jsonb_array_length(b.rows)) then raise exception 'سطور مراجعة غير صالحة';end if;
 if length(note)<3 then raise exception 'اكتب سبب قرار المراجعة';end if;
 firstrow:=b.rows->indexes[1];
 select entity_id::text into scope from public.contracting_entity_contracts where id=l.contract_id;
 if scope is null then raise exception 'راجع ربط عقد الجهة';end if;
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
end $$;
-- Price-list managers may collaborate on source review; price activation remains independent.
create or replace function clinic_prices.guard_mapping_price_approval() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.status='active' and old.status is distinct from 'active' and exists(select 1 from clinic_prices.audit where list_id=new.id and action='source_review' and actor_id=public.my_admin_id()) then raise exception 'اعتماد أسعار اللائحة يحتاج مراجعًا آخر غير من راجع ربط المصدر';end if;
 return new;
end $$;
create trigger mapping_independent_price_approval before update of status on clinic_prices.lists for each row execute function clinic_prices.guard_mapping_price_approval();
revoke all on function clinic_prices.guard_mapping_price_approval() from public,anon,authenticated;
-- Contract tariffs require their own approved fixed price, never a center fallback.
create or replace function clinic_prices.resolve(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare l clinic_prices.lists%rowtype;i clinic_prices.items%rowtype;val numeric:=p_base;pc numeric:=0;dc numeric:=0;begin
 select * into l from clinic_prices.lists where status='active' and contract_id is not distinct from p_contract and p_date between valid_from and valid_to;
 if not found then
  if p_contract is not null then raise exception 'لا توجد قائمة أسعار جهة معتمدة وسارية؛ لا يستخدم سعر سونو بدلًا منها';end if;
  return jsonb_build_object('price',round(val,2),'reason','لائحة المركز من التسعير','source','existing','discount_percent',0);
 end if;
 select * into i from clinic_prices.items where list_id=l.id and service_id=p_service;
 if p_contract is not null and (i.id is null or i.fixed_price is null) then raise exception 'الخدمة ليس لها سعر جهة معتمد؛ راجع لائحة الجهة';end if;
 if i.id is not null then val:=coalesce(i.fixed_price,p_base);pc:=i.discount_percent;dc:=i.discount_amount;
 elsif l.fallback='block' then raise exception 'الخدمة غير مشمولة في اللائحة %',l.name;end if;
 if i.id is not null or l.fallback='discount' then pc:=1-(1-pc/100)*(1-l.discount_percent/100);val:=val*(1-pc)-dc-l.discount_amount;end if;
 if val<=0 then raise exception 'الخصم يجعل سعر الخدمة صفرًا أو سالبًا؛ راجع اللائحة %',l.name;end if;
 return jsonb_build_object('price',round(val,2),'reason',l.name||' — إصدار '||l.version,'source','price_list','list_id',l.id,'version',l.version,'list_terms',to_jsonb(l)-'created_by'-'reviewed_by','item_terms',to_jsonb(i));
end $$;
revoke all on function clinic_prices.item_mapping_command(jsonb),clinic_prices.resolve(uuid,numeric,date,uuid) from public,anon,authenticated;
revoke all on function public.price_service_mapping_workspace(uuid),public.price_service_mapping_command(jsonb) from public,anon;
grant execute on function public.price_service_mapping_workspace(uuid),public.price_service_mapping_command(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
