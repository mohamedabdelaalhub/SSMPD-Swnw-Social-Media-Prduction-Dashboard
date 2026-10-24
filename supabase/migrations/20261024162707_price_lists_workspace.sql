begin;
create schema clinic_prices;
revoke all on schema clinic_prices from public,anon,authenticated;
create table clinic_prices.lists(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name))>=3),version integer not null check(version>0),contract_id uuid references public.contracting_entity_contracts(id),mode text not null check(mode in ('fixed','discount','mixed')),fallback text not null check(fallback in ('base','discount','block')),discount_percent numeric(7,4) not null default 0 check(discount_percent between 0 and 100),discount_amount numeric(14,2) not null default 0 check(discount_amount>=0 and discount_amount::text not in ('NaN','Infinity')),valid_from date not null,valid_to date not null,notes text not null default '',status text not null default 'draft' check(status in ('draft','pending','active','retired','rejected')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),review_note text,created_at timestamptz not null default now(),revision integer not null default 1,allow_extra_discount boolean not null default false,unique(name,version),check(valid_to>=valid_from));
create table clinic_prices.items(id uuid primary key default gen_random_uuid(),list_id uuid not null references clinic_prices.lists(id) on delete cascade,service_id uuid not null references public.pricing_services(id),fixed_price numeric(14,2) check(fixed_price>0 and fixed_price::text not in ('NaN','Infinity')),discount_percent numeric(7,4) not null default 0 check(discount_percent between 0 and 100),discount_amount numeric(14,2) not null default 0 check(discount_amount>=0 and discount_amount::text not in ('NaN','Infinity')),notes text not null default '',unique(list_id,service_id));
create index price_scope on clinic_prices.lists(contract_id,status,valid_from,valid_to);
create table clinic_prices.audit(id bigint generated always as identity primary key,actor_id uuid not null references public.admins(id),action text not null,list_id uuid not null references clinic_prices.lists(id),details jsonb not null,created_at timestamptz not null default now());
alter table clinic_prices.lists enable row level security;
alter table clinic_prices.items enable row level security;
alter table clinic_prices.audit enable row level security;
create function clinic_prices.manage() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select public.my_admin_id() is not null and (public.has_role('super_admin') or public.has_role('general_manager') or exists(select 1 from public.admins where id=public.my_admin_id() and active and has_price_lists_access))$$;
create function clinic_prices.resolve(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare l clinic_prices.lists%rowtype;i clinic_prices.items%rowtype;val numeric:=p_base;reason text:='لائحة المركز من التسعير';pc numeric:=0;dc numeric:=0;begin
 select * into l from clinic_prices.lists where status='active' and contract_id is not distinct from p_contract and p_date between valid_from and valid_to;
 if not found then
  if p_contract is not null then select coalesce(discount_percent,0) into pc from public.contracting_entity_contracts where id=p_contract;reason:='خصم عقد الجهة الحالي';end if;
  return jsonb_build_object('price',round(val*(1-coalesce(pc,0)/100),2),'reason',reason,'source','existing','discount_percent',coalesce(pc,0));
 end if;
 select * into i from clinic_prices.items where list_id=l.id and service_id=p_service;
 if i.id is not null then
  val:=coalesce(i.fixed_price,p_base);pc:=i.discount_percent;dc:=i.discount_amount;
 elsif l.fallback='block' then raise exception 'الخدمة غير مشمولة في اللائحة %',l.name;
 end if;
 if i.id is not null or l.fallback='discount' then pc:=1-(1-pc/100)*(1-l.discount_percent/100);val:=val*(1-pc)-dc-l.discount_amount;end if;
 if val<=0 then raise exception 'الخصم يجعل سعر الخدمة صفرًا أو سالبًا؛ راجع اللائحة %',l.name;end if;
 return jsonb_build_object('price',round(val,2),'reason',l.name||' — إصدار '||l.version,'source','price_list','list_id',l.id,'version',l.version,'list_terms',to_jsonb(l)-'created_by'-'reviewed_by','item_terms',to_jsonb(i));
end $$;
create function public.price_lists_workspace() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 if not clinic_prices.manage() then raise exception 'لا تملك إدارة لوائح الأسعار';end if;
 return jsonb_build_object('lists',(select coalesce(jsonb_agg(l order by l.created_at desc),'[]') from clinic_prices.lists l),'items',(select coalesce(jsonb_agg(i),'[]') from clinic_prices.items i),'services',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',booking_code,'category',category,'active',active) order by name),'[]') from public.pricing_services),'contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',e.name||' — '||coalesce(c.contract_number,c.id::text),'start_date',c.start_date,'end_date',c.end_date,'status',c.status,'service_ids',c.booking_service_ids) order by e.name),'[]') from public.contracting_entity_contracts c join public.contracting_entities e on e.id=c.entity_id));
end $$;
create function public.price_lists_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();v uuid:=nullif(p_payload->>'id','')::uuid;l clinic_prices.lists%rowtype;item jsonb;begin
 if not clinic_prices.manage() then raise exception 'لا تملك إدارة لوائح الأسعار';end if;
 -- Serialize approval and edits, including new center lists with no parent row.
 perform pg_advisory_xact_lock(712241024);
 if v is not null then select * into l from clinic_prices.lists where id=v for update;if not found then raise exception 'اللائحة غير موجودة';end if;end if;
 if p_action='save' then
  if l.id is not null and (l.status<>'draft' or l.created_by<>me or l.revision<>coalesce((p_payload->>'revision')::int,0)) then raise exception 'اللائحة تغيرت أو خرجت من المسودة؛ أنشئ إصدارًا جديدًا';end if;
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
  if l.contract_id is not null and exists(select 1 from clinic_prices.items i join public.contracting_entity_contracts c on c.id=l.contract_id where i.list_id=l.id and not(i.service_id=any(c.booking_service_ids))) then raise exception 'الخدمة غير مشمولة بعقد الجهة؛ أضفها من جهات التعاقد أولًا';end if;
  update clinic_prices.lists set status='pending' where id=v;
 elsif p_action='review' then
  if l.status<>'pending' or l.created_by=me or length(trim(coalesce(p_payload->>'review_note','')))<3 or p_payload->>'decision' not in ('active','rejected') then raise exception 'تحتاج مراجعًا آخر وسبب القرار';end if;
  if p_payload->>'decision'='active' and l.contract_id is not null and not exists(select 1 from public.contracting_entity_contracts where id=l.contract_id and status='active' and l.valid_from>=start_date and l.valid_to<=coalesce(end_date,'9999-12-31')) then raise exception 'فترة اللائحة يجب أن تكون داخل عقد جهة معتمد';end if;
  if p_payload->>'decision'='active' and exists(select 1 from clinic_prices.lists where id<>v and status='active' and contract_id is not distinct from l.contract_id and daterange(valid_from,valid_to,'[]')&&daterange(l.valid_from,l.valid_to,'[]')) then raise exception 'فترة اللائحة تتداخل مع إصدار معتمد لنفس النطاق؛ أنهِ القديم أو عدّل تواريخ المسودة';end if;
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
end $$;
-- A quote calculator uses the exact same resolver as operational catalogs.
create function public.price_lists_preview(p_service uuid,p_date date,p_contract uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
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
 value:=(quote->>'price')::numeric;return quote||jsonb_build_object('center_price',(center->>'price')::numeric,'payer',round(value*coverage/100,2),'patient',value-round(value*coverage/100,2),'currency','EGP');
end $$;
revoke all on all tables in schema clinic_prices from public,anon,authenticated;
revoke all on all functions in schema clinic_prices from public,anon,authenticated;
revoke all on function public.price_lists_workspace(),public.price_lists_command(text,jsonb),public.price_lists_preview(uuid,date,uuid) from public,anon;
grant execute on function public.price_lists_workspace(),public.price_lists_command(text,jsonb),public.price_lists_preview(uuid,date,uuid) to authenticated;
commit;
