-- Contract activation without mandatory documents, approved by one person (owner 2026-11-23).
-- «عشان اقدر افعل العقد ... خليه يبقي اوبشن مش اجباري» + «خلي اعتماد العقود من طرفي او طرف المدير المالي او السوبر ادمن».
--
-- * Contract terms, signed document, signer name and agreement date stay optional (no server rule ever
--   required them; this migration adds none).
-- * Only super_admin or financial_manager (main or extra role) may set a contract to 'active', approve or
--   reject a price list, or approve a contract-price link. One approver is enough: the
--   "another reviewer" (maker-checker) rule is removed for these roles only.
-- * public.contracting_contract_activate(contract) activates the contract and, best effort, approves its
--   linked price list and the link in the same call. A list that fails a pricing check (empty fixed list,
--   dates outside the contract, overlap...) is reported back and the contract is still activated.
-- * Kept as before: review note (3+ chars) on the manual review path, list item/date/overlap checks,
--   "contract and list must be active before the link", contract dates check, RLS.
-- Rollback: supabase/rollbacks/20261123080000_contract_activation_optional_docs.rollback.sql
begin;

create or replace function public.can_approve_contracts() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.my_admin_id() is not null and (public.has_role('super_admin') or public.has_role('financial_manager'))
$$;
revoke all on function public.can_approve_contracts() from public,anon;
grant execute on function public.can_approve_contracts() to authenticated;

-- Direct table writes from the dashboard: only the approver roles can turn a contract active.
create or replace function public.guard_contract_activation_role() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if current_user in ('authenticated','anon') and new.status='active'
    and (tg_op='INSERT' or old.status is distinct from 'active')
    and not public.can_approve_contracts() then
  raise exception 'تفعيل العقد للسوبر أدمن أو المدير المالي فقط' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_contract_activation_role() from public,anon,authenticated;
drop trigger if exists contract_activation_role_guard on public.contracting_entity_contracts;
create trigger contract_activation_role_guard before insert or update of status on public.contracting_entity_contracts
 for each row execute function public.guard_contract_activation_role();

-- Keep the previous command bodies under clinic_prices; the public names become thin wrappers.
do $$begin
 if to_regprocedure('clinic_prices.price_lists_command_before_approver(text,jsonb)') is null then
  alter function public.price_lists_command(text,jsonb) rename to price_lists_command_before_approver;
  alter function public.price_lists_command_before_approver(text,jsonb) set schema clinic_prices;
 end if;
 if to_regprocedure('clinic_prices.price_contract_list_command_before_approver(text,jsonb)') is null then
  alter function public.price_contract_list_command(text,jsonb) rename to price_contract_list_command_before_approver;
  alter function public.price_contract_list_command_before_approver(text,jsonb) set schema clinic_prices;
 end if;
end $$;
revoke all on function clinic_prices.price_lists_command_before_approver(text,jsonb),
 clinic_prices.price_contract_list_command_before_approver(text,jsonb) from public,anon,authenticated;

-- One approval decision on a list. Callers check the role. Same checks as submit + review, minus four-eyes.
create or replace function clinic_prices.decide_list(p_list uuid,p_decision text,p_note text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();l clinic_prices.lists%rowtype;it clinic_prices.items%rowtype;scope text;prior uuid;begin
 perform pg_advisory_xact_lock(712241024);
 select * into l from clinic_prices.lists where id=p_list for update;
 if not found or l.deleted_at is not null then raise exception 'القائمة غير موجودة أو محذوفة';end if;
 if p_decision not in ('active','rejected') then raise exception 'قرار غير متاح';end if;
 if l.status='active' and p_decision='active' then return l.id;end if;
 if l.status not in ('draft','pending') then raise exception 'القائمة ليست مسودة أو بانتظار الاعتماد';end if;
 if p_decision='active' then
  if exists(select 1 from clinic_prices.batches where list_id=l.id and status='draft') then raise exception 'راجع دفعات الاستيراد وضمها أو استبعدها قبل اعتماد اللائحة';end if;
  if l.mode='fixed' and not exists(select 1 from clinic_prices.items where list_id=l.id and fixed_price is not null) then raise exception 'أضف سعر خدمة واحدًا على الأقل';end if;
  if l.mode='discount' and exists(select 1 from clinic_prices.items where list_id=l.id and fixed_price is not null) then raise exception 'لائحة الخصم لا تضم أسعارًا ثابتة؛ اختر مختلطة';end if;
  if l.mode='fixed' and exists(select 1 from clinic_prices.items where list_id=l.id and fixed_price is null) then raise exception 'اللائحة الثابتة تتطلب سعر كل بند';end if;
  if l.list_kind='center' and l.contract_id is not null and exists(select 1 from clinic_prices.items i join public.contracting_entity_contracts c on c.id=l.contract_id where i.list_id=l.id and not(i.service_id=any(c.booking_service_ids))) then raise exception 'الخدمة غير مشمولة بعقد الجهة؛ أضفها من جهات التعاقد أولًا';end if;
  if l.list_kind='center' and l.contract_id is not null and not exists(select 1 from public.contracting_entity_contracts where id=l.contract_id and status='active' and l.valid_from>=start_date and l.valid_to<=coalesce(end_date,'9999-12-31')) then raise exception 'فترة اللائحة يجب أن تكون داخل عقد جهة معتمد';end if;
  if l.list_kind='center' and exists(select 1 from clinic_prices.lists where id<>l.id and status='active' and deleted_at is null and list_kind='center' and daterange(valid_from,valid_to,'[]')&&daterange(l.valid_from,l.valid_to,'[]')) then raise exception 'فترة اللائحة تتداخل مع إصدار معتمد لنفس النطاق؛ أنهِ القديم أو عدّل تواريخ المسودة';end if;
  scope:='center';if l.list_kind='reference' then scope:='list:'||l.id::text;end if;
  for it in select * from clinic_prices.items where list_id=l.id and external_name<>'' loop
   select service_id into prior from clinic_prices.aliases where scope_key=scope and external_code=it.external_code and (external_name=it.external_name or it.external_code<>'' and external_code=it.external_code) and unit=it.unit limit 1;
   if prior is not null and prior<>it.service_id then raise exception 'تعارض مع مطابقة معتمدة للاسم %؛ راجع تعريف الخدمة',it.external_name;end if;
   insert into clinic_prices.aliases(scope_key,external_code,external_name,unit,service_id,list_id,reviewed_by) values(scope,it.external_code,it.external_name,it.unit,it.service_id,l.id,me) on conflict(scope_key,external_code,external_name,unit) do nothing;
  end loop;
 end if;
 update clinic_prices.lists set status=p_decision,reviewed_by=me,review_note=p_note where id=l.id;
 insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,'review',l.id,jsonb_build_object('decision',p_decision,'review_note',p_note,'single_approver',true,'from_status',l.status));
 return l.id;
end $$;
revoke all on function clinic_prices.decide_list(uuid,text,text) from public,anon,authenticated;

create or replace function public.price_lists_command(p_action text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_action='review' then
  if not public.can_approve_contracts() then raise exception 'اعتماد قوائم الأسعار للسوبر أدمن أو المدير المالي فقط' using errcode='42501';end if;
  if length(trim(coalesce(p_payload->>'review_note','')))<3 then raise exception 'اكتب سبب القرار';end if;
  if (select status from clinic_prices.lists where id=nullif(p_payload->>'id','')::uuid) is distinct from 'pending' then raise exception 'راجع القوائم المرسلة للاعتماد فقط';end if;
  return clinic_prices.decide_list(nullif(p_payload->>'id','')::uuid,p_payload->>'decision',p_payload->>'review_note');
 end if;
 return clinic_prices.price_lists_command_before_approver(p_action,p_payload);
end $$;
revoke all on function public.price_lists_command(text,jsonb) from public,anon;
grant execute on function public.price_lists_command(text,jsonb) to authenticated;

create or replace function public.price_contract_list_command(p_action text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.contracting_entity_contracts%rowtype;me uuid:=public.my_admin_id();begin
 if p_action<>'approve' then return clinic_prices.price_contract_list_command_before_approver(p_action,p_payload);end if;
 if not public.can_approve_contracts() then raise exception 'اعتماد ربط الأسعار للسوبر أدمن أو المدير المالي فقط' using errcode='42501';end if;
 perform pg_advisory_xact_lock(712241024);
 select * into c from public.contracting_entity_contracts where id=(p_payload->>'contract_id')::uuid for update;
 if not found or c.price_list_link_revision is distinct from (p_payload->>'revision')::int then raise exception 'العقد تغير؛ أعد تحميله';end if;
 if c.price_list_id is null or c.price_list_link_status<>'pending' then raise exception 'لا يوجد ربط أسعار بانتظار الاعتماد';end if;
 if not exists(select 1 from clinic_prices.lists where id=c.price_list_id and status='active' and deleted_at is null) or c.status<>'active' then raise exception 'اعتمد القائمة والعقد قبل تفعيل الربط';end if;
 update public.contracting_entity_contracts set price_list_link_status='active',price_list_reviewed_by=me,price_list_link_revision=price_list_link_revision+1 where id=c.id;
 insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,'contract_list_approve',c.price_list_id,jsonb_build_object('contract_id',c.id,'single_approver',true));
 return c.id;
end $$;
revoke all on function public.price_contract_list_command(text,jsonb) from public,anon;
grant execute on function public.price_contract_list_command(text,jsonb) to authenticated;

-- One button: activate the contract, then (best effort) its linked list and link.
create or replace function public.contracting_contract_activate(p_contract_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();c public.contracting_entity_contracts%rowtype;l clinic_prices.lists%rowtype;
 list_state text:='not_linked';list_message text;begin
 if not public.can_approve_contracts() then raise exception 'تفعيل العقد للسوبر أدمن أو المدير المالي فقط' using errcode='42501';end if;
 perform pg_advisory_xact_lock(712241024);
 select * into c from public.contracting_entity_contracts where id=p_contract_id for update;
 if not found then raise exception 'العقد غير موجود';end if;
 if c.status<>'active' then
  update public.contracting_entity_contracts set status='active' where id=c.id;
  insert into public.contracting_entity_activities(entity_id,contract_id,activity_type,summary,created_by)
   values(c.entity_id,c.id,'status_change','تم تفعيل العقد',me);
 end if;
 if c.price_list_id is not null then
  select * into l from clinic_prices.lists where id=c.price_list_id;
  begin
   if l.status in ('draft','pending') then perform clinic_prices.decide_list(l.id,'active','اعتماد مع تفعيل العقد');end if;
   if c.price_list_link_status<>'active' then
    if not exists(select 1 from clinic_prices.lists where id=c.price_list_id and status='active' and deleted_at is null) then raise exception 'قائمة الأسعار المرتبطة غير قابلة للاعتماد (حالتها %)',l.status;end if;
    update public.contracting_entity_contracts set price_list_link_status='active',price_list_reviewed_by=me,price_list_link_revision=price_list_link_revision+1 where id=c.id;
    insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,'contract_list_approve',c.price_list_id,jsonb_build_object('contract_id',c.id,'single_approver',true,'with_activation',true));
   end if;
   list_state:='active';
  exception when others then
   list_state:='error';list_message:=sqlerrm;
  end;
 end if;
 return jsonb_build_object('contract_id',c.id,'status','active','price_list',list_state,'price_list_message',list_message);
end $$;
revoke all on function public.contracting_contract_activate(uuid) from public,anon;
grant execute on function public.contracting_contract_activate(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
