-- SSMPD | جهات التعاقد — رفع العقد وربط الزيارة
-- شغّل هذا الملف بعد contracting_entities.sql.

alter table public.contracting_entity_contracts
  add column if not exists signed_document_drive_file_id text,
  add column if not exists signed_document_file_name text,
  add column if not exists signed_document_mime_type text,
  add column if not exists signed_document_uploaded_at timestamptz,
  add column if not exists signed_document_uploaded_by uuid references public.admins(id) on delete set null;

alter table public.patient_visits
  add column if not exists contract_id uuid references public.contracting_entity_contracts(id) on delete restrict;
create index if not exists patient_visits_contract_idx on public.patient_visits(contract_id, visit_date desc) where contract_id is not null;

-- قائمة محدودة للزيارة فقط. لا تُرجع بيانات مالية أو طبية.
create or replace function public.list_contracts_for_patient_visit(p_patient_id uuid)
returns table(contract_id uuid, entity_name text, start_date date, end_date date, is_current_patient_contract boolean)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (public.has_archive_access() or public.can_manage_contracting_entities()) then
    raise exception 'not allowed';
  end if;
  return query
    select c.id, e.name, c.start_date, c.end_date,
      exists(
        select 1 from public.contract_patient_links l
        where l.patient_id = p_patient_id and l.contract_id = c.id and l.linked_until is null
      )
    from public.contracting_entity_contracts c
    join public.contracting_entities e on e.id = c.entity_id
    join public.contract_patient_links l on l.contract_id = c.id
      and l.patient_id = p_patient_id
      and l.linked_from <= current_date
      and (l.linked_until is null or l.linked_until >= current_date)
    where c.status = 'active'
      and c.start_date <= current_date
      and (c.end_date is null or c.end_date >= current_date)
    order by 5 desc, e.name;
end;
$$;
revoke all on function public.list_contracts_for_patient_visit(uuid) from public;
grant execute on function public.list_contracts_for_patient_visit(uuid) to authenticated;

-- أي زيارة مرتبطة بعقد لازم تكون داخل فترة العقد، ولازم المريض يكون منسوبًا
-- للعقد في نفس التاريخ. هذا يحافظ على التقارير التاريخية عند تجديد أو تغيير العقد.
create or replace function public.validate_patient_visit_contract()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_valid boolean;
begin
  if new.contract_id is null then return new; end if;
  select exists(
    select 1
    from public.contracting_entity_contracts c
    join public.contract_patient_links l on l.contract_id = c.id and l.patient_id = new.patient_id
    where c.id = new.contract_id
      and c.status = 'active'
      and c.start_date <= new.visit_date
      and (c.end_date is null or c.end_date >= new.visit_date)
      and l.linked_from <= new.visit_date
      and (l.linked_until is null or l.linked_until >= new.visit_date)
  ) into v_valid;
  if not v_valid then
    raise exception 'المريض غير مربوط بعقد نشط يغطي تاريخ الزيارة';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_validate_patient_visit_contract on public.patient_visits;
create trigger trg_validate_patient_visit_contract
  before insert or update of contract_id, visit_date, patient_id on public.patient_visits
  for each row execute function public.validate_patient_visit_contract();
