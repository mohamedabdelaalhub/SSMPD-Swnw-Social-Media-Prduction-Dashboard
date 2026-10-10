begin;

-- Restrictive policy also protects direct REST deletion alongside existing ALL policies.
drop policy if exists "contract entities manager delete" on public.contracting_entities;
create policy "contract entities manager delete" on public.contracting_entities
as restrictive for delete to authenticated
using (public.has_role('super_admin') or public.has_role('general_manager'));

create or replace function public.delete_contracting_entity(p_entity_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare deleted_id uuid;
begin
  if public.my_admin_id() is null or not (public.has_role('super_admin') or public.has_role('general_manager')) then
    raise exception 'الحذف متاح للسوبر أدمن والمدير فقط' using errcode='42501';
  end if;
  select id into deleted_id from public.contracting_entities where id=p_entity_id for update;
  if deleted_id is null then raise exception 'جهة التعاقد غير موجودة أو تم حذفها بالفعل'; end if;
  perform id from public.contracting_entity_contracts where entity_id=p_entity_id for update;
  if exists(select 1 from public.contract_patient_links l join public.contracting_entity_contracts c on c.id=l.contract_id where c.entity_id=p_entity_id)
     or exists(select 1 from public.patient_visits v join public.contracting_entity_contracts c on c.id=v.contract_id where c.entity_id=p_entity_id) then
    raise exception 'لا يمكن حذف جهة مرتبطة بمرضى أو زيارات. يمكن تعليق العقد بدلًا من الحذف.';
  end if;
  delete from public.contracting_entities where id=p_entity_id;
  return deleted_id;
exception when foreign_key_violation then
  raise exception 'لا يمكن حذف جهة مرتبطة بمرضى أو زيارات. يمكن تعليق العقد بدلًا من الحذف.';
end;
$$;
revoke all on function public.delete_contracting_entity(uuid) from public;
grant execute on function public.delete_contracting_entity(uuid) to authenticated;

commit;
