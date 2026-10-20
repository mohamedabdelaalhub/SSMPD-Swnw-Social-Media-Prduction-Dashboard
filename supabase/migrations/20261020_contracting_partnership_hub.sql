-- SSMPD — Contracting Partnership Hub
-- Extends the existing contracting_entities module without replacing legacy contracts/finance.

create extension if not exists pgcrypto;

alter table if exists public.contracting_entities
  add column if not exists partner_code text,
  add column if not exists partner_slug text,
  add column if not exists pipeline_status text default 'lead',
  add column if not exists portal_enabled boolean default false,
  add column if not exists qr_enabled boolean default true,
  add column if not exists settlement_cycle text default 'monthly',
  add column if not exists default_member_discount numeric(5,2) default 20,
  add column if not exists representative_name text,
  add column if not exists representative_title text,
  add column if not exists representative_email text,
  add column if not exists representative_phone text;

create unique index if not exists contracting_entities_partner_code_uidx
  on public.contracting_entities(partner_code) where partner_code is not null;
create unique index if not exists contracting_entities_partner_slug_uidx
  on public.contracting_entities(partner_slug) where partner_slug is not null;

create table if not exists public.contracting_partnership_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_name text not null default 'عيادات سونو التخصصية',
  clinic_address text default 'حدائق الأهرام – بوابة 3 – منطقة الخزان',
  clinic_representative_name text,
  clinic_representative_title text,
  clinic_email text,
  clinic_whatsapp text,
  letterhead_logo_url text,
  letterhead_header_html text,
  letterhead_footer_html text,
  signature_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.contracting_agreement_presets (
  id uuid primary key default gen_random_uuid(),
  preset_key text unique not null,
  name_ar text not null,
  description_ar text,
  default_discount numeric(5,2) not null default 20,
  settlement_cycle text not null default 'monthly',
  services text[] not null default '{}',
  extras jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.contracting_incentive_tiers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.contracting_entities(id) on delete cascade,
  preset_key text,
  min_amount numeric(14,2) not null default 0,
  max_amount numeric(14,2),
  rate_percent numeric(6,3) not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.contracting_agreements (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.contracting_entities(id) on delete cascade,
  document_type text not null check (document_type in ('proposal','final_contract')),
  preset_key text,
  status text not null default 'draft',
  version_no integer not null default 1,
  title text,
  member_discount numeric(5,2),
  settlement_cycle text,
  duration_months integer,
  services text[] not null default '{}',
  selected_options jsonb not null default '{}'::jsonb,
  terms_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid,
  reviewed_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  sent_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contracting_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.contracting_agreements(id) on delete cascade,
  version_no integer not null,
  content_html text not null,
  file_name text,
  pdf_url text,
  word_url text,
  immutable boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique(agreement_id, version_no)
);

create table if not exists public.contracting_referrals (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.contracting_entities(id) on delete cascade,
  contract_id uuid references public.contracting_entity_contracts(id) on delete set null,
  patient_id uuid,
  patient_name text,
  patient_phone text,
  specialty text,
  service_name text,
  preferred_at timestamptz,
  notes text,
  source text not null default 'partner_portal',
  status text not null default 'new',
  booking_id uuid,
  submitted_by_name text,
  submitted_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contracting_referrals_entity_status_idx
  on public.contracting_referrals(entity_id, status, created_at desc);

create table if not exists public.contracting_partner_transactions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.contracting_entities(id) on delete cascade,
  referral_id uuid references public.contracting_referrals(id) on delete set null,
  patient_id uuid,
  invoice_id uuid,
  service_name text,
  eligible boolean not null default true,
  gross_amount numeric(14,2) not null default 0,
  member_discount_amount numeric(14,2) not null default 0,
  collected_amount numeric(14,2) not null default 0,
  refunded_amount numeric(14,2) not null default 0,
  eligible_amount numeric(14,2) generated always as (greatest(collected_amount - refunded_amount, 0)) stored,
  transaction_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.contracting_settlements (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.contracting_entities(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  eligible_revenue numeric(14,2) not null default 0,
  referral_count integer not null default 0,
  completed_count integer not null default 0,
  incentive_amount numeric(14,2) not null default 0,
  adjustments numeric(14,2) not null default 0,
  status text not null default 'under_review',
  reviewed_by uuid,
  approved_by uuid,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(entity_id, period_start, period_end)
);

create table if not exists public.contracting_activity_log (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.contracting_entities(id) on delete cascade,
  agreement_id uuid references public.contracting_agreements(id) on delete set null,
  action_key text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.contracting_partner_users (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.contracting_entities(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.contracting_agreement_presets
  (preset_key,name_ar,description_ar,default_discount,settlement_cycle,services,extras)
values
  ('standard','شراكة قياسية','نموذج عام للجهات والمؤسسات',20,'monthly',array['الأسنان','الجلدية والتجميل','الباطنة','الأطفال','الصحة النفسية'], '{"portal":true,"qr":true,"events":true}'::jsonb),
  ('corporate','شراكة شركات','للشركات وجهات العمل وبرامج الموظفين',20,'monthly',array['الأسنان','الجلدية والتجميل','الباطنة','الأطفال','الصحة النفسية'], '{"portal":true,"qr":true,"priority_booking":true,"reports":true}'::jsonb),
  ('nursery','شراكة حضانات','للأطفال والأسر والأنشطة التوعوية',20,'monthly',array['الأطفال','الأسنان','التغذية'], '{"portal":true,"qr":true,"family_offers":true,"events":true}'::jsonb),
  ('gym','شراكة جيم/نادي رياضي','للأعضاء والخدمات المرتبطة بالنشاط الرياضي',20,'monthly',array['العظام','العلاج الطبيعي','التغذية','الجلدية والتجميل','الأسنان'], '{"portal":true,"qr":true,"events":true}'::jsonb)
on conflict (preset_key) do update set
  name_ar=excluded.name_ar,
  description_ar=excluded.description_ar,
  default_discount=excluded.default_discount,
  settlement_cycle=excluded.settlement_cycle,
  services=excluded.services,
  extras=excluded.extras,
  active=true;

-- Default progressive incentive ladder. Entity-specific rows override this when present.
insert into public.contracting_incentive_tiers (preset_key,min_amount,max_amount,rate_percent,sort_order)
select x.preset_key,x.min_amount,x.max_amount,x.rate_percent,x.sort_order
from (values
 ('standard',0::numeric,10000::numeric,5::numeric,1),
 ('standard',10000::numeric,25000::numeric,7.5::numeric,2),
 ('standard',25000::numeric,50000::numeric,10::numeric,3),
 ('standard',50000::numeric,null::numeric,12.5::numeric,4),
 ('corporate',0::numeric,10000::numeric,5::numeric,1),
 ('corporate',10000::numeric,25000::numeric,7.5::numeric,2),
 ('corporate',25000::numeric,50000::numeric,10::numeric,3),
 ('corporate',50000::numeric,null::numeric,12.5::numeric,4),
 ('nursery',0::numeric,10000::numeric,5::numeric,1),
 ('nursery',10000::numeric,25000::numeric,7.5::numeric,2),
 ('nursery',25000::numeric,50000::numeric,10::numeric,3),
 ('nursery',50000::numeric,null::numeric,12.5::numeric,4),
 ('gym',0::numeric,10000::numeric,5::numeric,1),
 ('gym',10000::numeric,25000::numeric,7.5::numeric,2),
 ('gym',25000::numeric,50000::numeric,10::numeric,3),
 ('gym',50000::numeric,null::numeric,12.5::numeric,4)
) as x(preset_key,min_amount,max_amount,rate_percent,sort_order)
where not exists (
  select 1 from public.contracting_incentive_tiers t
  where t.entity_id is null and t.preset_key=x.preset_key and t.sort_order=x.sort_order
);

create or replace function public.contracting_progressive_incentive(
  p_amount numeric,
  p_entity_id uuid default null,
  p_preset_key text default 'standard'
) returns numeric
language plpgsql
stable
as $$
declare
  r record;
  v_amount numeric := greatest(coalesce(p_amount,0),0);
  v_total numeric := 0;
  v_slice numeric;
begin
  for r in
    select min_amount,max_amount,rate_percent
    from public.contracting_incentive_tiers
    where active=true
      and ((p_entity_id is not null and entity_id=p_entity_id)
        or (entity_id is null and preset_key=p_preset_key
            and not exists(select 1 from public.contracting_incentive_tiers z where z.entity_id=p_entity_id and z.active=true)))
    order by sort_order,min_amount
  loop
    if v_amount <= r.min_amount then continue; end if;
    v_slice := least(v_amount,coalesce(r.max_amount,v_amount)) - r.min_amount;
    if v_slice > 0 then v_total := v_total + (v_slice * r.rate_percent / 100); end if;
  end loop;
  return round(v_total,2);
end;
$$;

create or replace function public.contracting_partner_snapshot(p_entity_id uuid)
returns jsonb
language sql
stable
as $$
  with r as (
    select count(*) referrals,
      count(*) filter (where status in ('confirmed','attended','completed','collected')) confirmed,
      count(*) filter (where status in ('attended','completed','collected')) attended,
      count(*) filter (where status in ('completed','collected')) completed
    from public.contracting_referrals where entity_id=p_entity_id
  ), t as (
    select coalesce(sum(eligible_amount) filter (where eligible),0) eligible_revenue
    from public.contracting_partner_transactions where entity_id=p_entity_id
  )
  select jsonb_build_object(
    'referrals',r.referrals,'confirmed',r.confirmed,'attended',r.attended,'completed',r.completed,
    'eligible_revenue',t.eligible_revenue,
    'incentive',public.contracting_progressive_incentive(t.eligible_revenue,p_entity_id,'standard')
  ) from r,t;
$$;
