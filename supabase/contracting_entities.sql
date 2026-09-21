-- SSMPD | جهات التعاقد
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor بعد setup.sql.
-- التصميم يفصل بيانات الجهة عن العقود حتى تظل التجديدات والتسعير التاريخي صحيحين.

alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check (
  role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','sono_doctor','contract_manager')
);
alter table public.admin_extra_roles drop constraint if exists admin_extra_roles_role_check;
alter table public.admin_extra_roles add constraint admin_extra_roles_role_check check (
  role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','sono_doctor','contract_manager')
);

create or replace function public.can_manage_contracting_entities()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('contract_manager')
      or public.has_role('general_manager')
      or public.has_role('super_admin');
$$;
revoke all on function public.can_manage_contracting_entities() from public;
grant execute on function public.can_manage_contracting_entities() to authenticated;

create table if not exists public.contracting_entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  entity_type text not null check (entity_type in ('school','nursery','center','clinic','other')),
  address text,
  notes text,
  owner_admin_id uuid references public.admins(id) on delete set null,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contracting_entities_name_uidx on public.contracting_entities (lower(name));

create table if not exists public.contracting_entity_contacts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.contracting_entities(id) on delete cascade,
  full_name text not null,
  job_title text,
  phone text,
  whatsapp text,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists contracting_primary_contact_uidx
  on public.contracting_entity_contacts(entity_id) where is_primary;

create table if not exists public.contracting_entity_contracts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.contracting_entities(id) on delete cascade,
  contract_number text,
  agreement_date date,
  start_date date not null,
  end_date date,
  status text not null default 'negotiating'
    check (status in ('negotiating','active','suspended','expired','rejected')),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  cashback_percent numeric(5,2) not null default 0 check (cashback_percent between 0 and 100),
  cashback_recipient text,
  cashback_transfer_method text,
  services text,
  terms_notes text,
  signed_by_name text,
  signed_document_url text,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists contracting_contracts_entity_idx on public.contracting_entity_contracts(entity_id, start_date desc);
create index if not exists contracting_contracts_status_idx on public.contracting_entity_contracts(status, end_date);

create table if not exists public.contracting_entity_activities (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.contracting_entities(id) on delete cascade,
  contract_id uuid references public.contracting_entity_contracts(id) on delete set null,
  activity_type text not null default 'note' check (activity_type in ('call','meeting','whatsapp','email','note','status_change')),
  summary text not null,
  next_follow_up_date date,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contracting_activities_followup_idx on public.contracting_entity_activities(next_follow_up_date) where next_follow_up_date is not null;

-- العلاقة مستقلة عن ملف المريض الطبي: لا تعرض أي بيانات طبية في موديول العقود.
create table if not exists public.contract_patient_links (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracting_entity_contracts(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  member_reference text,
  linked_from date not null default current_date,
  linked_until date,
  notes text,
  linked_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  check (linked_until is null or linked_until >= linked_from)
);
create unique index if not exists contract_patient_links_current_uidx
  on public.contract_patient_links(patient_id) where linked_until is null;
create index if not exists contract_patient_links_contract_idx on public.contract_patient_links(contract_id, linked_from);

alter table public.contracting_entities enable row level security;
alter table public.contracting_entity_contacts enable row level security;
alter table public.contracting_entity_contracts enable row level security;
alter table public.contracting_entity_activities enable row level security;
alter table public.contract_patient_links enable row level security;

drop policy if exists "contract entities manage" on public.contracting_entities;
create policy "contract entities manage" on public.contracting_entities for all
  using (public.can_manage_contracting_entities()) with check (public.can_manage_contracting_entities());
drop policy if exists "contract contacts manage" on public.contracting_entity_contacts;
create policy "contract contacts manage" on public.contracting_entity_contacts for all
  using (public.can_manage_contracting_entities()) with check (public.can_manage_contracting_entities());
drop policy if exists "contracts manage" on public.contracting_entity_contracts;
create policy "contracts manage" on public.contracting_entity_contracts for all
  using (public.can_manage_contracting_entities()) with check (public.can_manage_contracting_entities());
drop policy if exists "contract activities manage" on public.contracting_entity_activities;
create policy "contract activities manage" on public.contracting_entity_activities for all
  using (public.can_manage_contracting_entities()) with check (public.can_manage_contracting_entities());
drop policy if exists "contract patient links manage" on public.contract_patient_links;
create policy "contract patient links manage" on public.contract_patient_links for all
  using (public.can_manage_contracting_entities()) with check (public.can_manage_contracting_entities());

create or replace function public.contract_entity_financial_rows(p_entity_id uuid default null)
returns table(
  entity_id uuid, contract_id uuid, patient_id uuid, patient_name text, patient_code text,
  invoices_count bigint, documented_revenue numeric, cashback_due numeric, net_after_cashback numeric
) language sql security definer stable set search_path = public as $$
  select c.entity_id, e.contract_id, p.id, p.full_name, p.patient_code,
    count(li.id)::bigint,
    coalesce(sum(li.amount), 0)::numeric,
    coalesce(sum(li.amount * c.cashback_percent / 100), 0)::numeric,
    coalesce(sum(li.amount * (1 - c.cashback_percent / 100)), 0)::numeric
  from public.contract_patient_links e
  join public.contracting_entity_contracts c on c.id = e.contract_id
  join public.patients p on p.id = e.patient_id
  left join public.leads l on l.patient_id = p.id
  left join public.lead_invoices li on li.lead_id = l.id
    and li.uploaded_at::date >= e.linked_from
    and (e.linked_until is null or li.uploaded_at::date <= e.linked_until)
  where public.can_manage_contracting_entities()
    and (p_entity_id is null or c.entity_id = p_entity_id)
  group by c.entity_id, e.contract_id, p.id, p.full_name, p.patient_code;
$$;
revoke all on function public.contract_entity_financial_rows(uuid) from public;
grant execute on function public.contract_entity_financial_rows(uuid) to authenticated;

create or replace function public.contracting_entities_overview()
returns table(
  entity_id uuid, entity_name text, entity_type text, contract_status text, end_date date,
  next_follow_up_date date, patients_count bigint, documented_revenue numeric, cashback_due numeric
) language sql security definer stable set search_path = public as $$
  with latest_contract as (
    select distinct on (c.entity_id) c.id, c.entity_id, c.status, c.end_date
    from public.contracting_entity_contracts c order by c.entity_id, c.start_date desc, c.created_at desc
  ), next_followup as (
    select entity_id, min(next_follow_up_date) as next_follow_up_date
    from public.contracting_entity_activities where next_follow_up_date >= current_date group by entity_id
  ), finance as (
    select entity_id, count(distinct patient_id) patients_count, sum(documented_revenue) documented_revenue, sum(cashback_due) cashback_due
    from public.contract_entity_financial_rows(null) group by entity_id
  )
  select e.id, e.name, e.entity_type, lc.status, lc.end_date, nf.next_follow_up_date,
    coalesce(f.patients_count, 0), coalesce(f.documented_revenue, 0), coalesce(f.cashback_due, 0)
  from public.contracting_entities e
  left join latest_contract lc on lc.entity_id = e.id
  left join next_followup nf on nf.entity_id = e.id
  left join finance f on f.entity_id = e.id
  where public.can_manage_contracting_entities()
  order by case lc.status when 'active' then 0 when 'negotiating' then 1 else 2 end, e.name;
$$;
revoke all on function public.contracting_entities_overview() from public;
grant execute on function public.contracting_entities_overview() to authenticated;

-- بحث محدود بالاسم/الهاتف/الكود لاستخدام ربط المريض فقط؛ لا يفتح الملف الطبي.
create or replace function public.search_patients_basic(p_term text)
returns table(id uuid, full_name text, phone text, patient_code text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
          or public.has_role('nursing') or public.can_manage_contracting_entities()) then
    raise exception 'not allowed';
  end if;
  return query
    select p.id, p.full_name, p.phone, p.patient_code
    from public.patients p
    where p.full_name ilike '%'||p_term||'%' or p.phone ilike '%'||p_term||'%' or p.patient_code ilike '%'||p_term||'%'
    order by p.full_name limit 20;
end;
$$;
revoke all on function public.search_patients_basic(text) from public;
grant execute on function public.search_patients_basic(text) to authenticated;

create or replace function public.touch_contracting_entity_updated_at()
returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_contracting_entities_updated_at on public.contracting_entities;
create trigger trg_contracting_entities_updated_at before update on public.contracting_entities for each row execute function public.touch_contracting_entity_updated_at();
drop trigger if exists trg_contracting_contracts_updated_at on public.contracting_entity_contracts;
create trigger trg_contracting_contracts_updated_at before update on public.contracting_entity_contracts for each row execute function public.touch_contracting_entity_updated_at();
