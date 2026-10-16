-- تعديل أسماء الفروع والمخازن دون تغيير هوياتها أو أرصدتها.
begin;

update public.inventory_branches
set name='حدائق الأهرام'
where id='00000000-0000-4000-8000-000000000002' and name='الفرع الحالي'
and not exists(select 1 from public.inventory_branches where name='حدائق الأهرام' and id<>'00000000-0000-4000-8000-000000000002');

create or replace function public.inventory_rename_structure(p_id uuid,p_name text,p_kind text)
returns void language plpgsql security definer set search_path=public as $$
declare previous_name text;
begin
 if not public.inventory_is_manager() or not exists(select 1 from public.admins where id=public.my_admin_id() and active) then
  raise exception 'تعديل أسماء الفروع والمخازن للسوبر أدمن والمدير العام';
 end if;
 if p_kind is null or p_kind not in ('branch','location') or p_id is null or p_name is null or length(trim(p_name)) not between 2 and 120 then
  raise exception 'راجع نوع المكان والاسم؛ الاسم من حرفين إلى 120 حرفاً';
 end if;
 if p_kind='branch' then
  select name into previous_name from public.inventory_branches where id=p_id for update;
  if not found then raise exception 'الفرع غير موجود'; end if;
  update public.inventory_branches set name=trim(p_name) where id=p_id;
 else
  select name into previous_name from public.inventory_locations where id=p_id for update;
  if not found then raise exception 'المخزن غير موجود'; end if;
  update public.inventory_locations set name=trim(p_name) where id=p_id;
 end if;
 if previous_name<>trim(p_name) then
  insert into public.inventory_audit_events(entity_id,kind,actor_id,detail)
  values(p_id,p_kind||'_renamed',public.my_admin_id(),previous_name||' → '||trim(p_name));
 end if;
exception when unique_violation then
 raise exception 'الاسم مستخدم بالفعل في نفس النطاق';
end $$;

revoke all on function public.inventory_rename_structure(uuid,text,text) from public,anon,authenticated;
grant execute on function public.inventory_rename_structure(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
