-- ADDITIVE ONLY. Review file; applied only after local rehearsal + owner go-ahead + backup.
-- Touches no existing table. Idempotent (IF NOT EXISTS). RLS enabled, NO policies = deny by default;
-- access policies/RPCs are a separate reviewed step.
begin;

create table if not exists clinic_reception.service_specialties(
  service_id uuid not null references clinic_reception.services(id) on delete cascade,
  specialty_id text not null,
  primary key(service_id,specialty_id));

create table if not exists clinic_reception.service_performers(
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references clinic_reception.services(id) on delete cascade,
  doctor_key text,
  specialty_id text,
  check ((doctor_key is not null)<>(specialty_id is not null)));

create table if not exists clinic_reception.referral_rates(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  doctor_key text not null,
  category text not null check (category in ('consult','followup','consultation','radiology','lab','procedure')),
  percent numeric(5,2) not null check (percent>=0 and percent<=100),
  valid_from date not null default current_date,
  valid_to date,
  unique(workspace_id,doctor_key,category,valid_from));

create table if not exists clinic_reception.external_providers(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  name text not null,
  kind text not null check (kind in ('lab','radiology')),
  phone text,
  terms jsonb not null default '{}'::jsonb,
  active boolean not null default true);

create table if not exists clinic_reception.provider_cost_list(
  provider_id uuid not null references clinic_reception.external_providers(id) on delete cascade,
  service_id uuid not null references clinic_reception.services(id) on delete cascade,
  year int not null,
  cost numeric(12,2) not null check (cost>=0),
  primary key(provider_id,service_id,year));

create table if not exists clinic_reception.order_ext(
  order_id uuid primary key references clinic_reception.orders(id) on delete cascade,
  kind text not null check (kind in ('service','radiology','lab','medicine','supply')),
  mode text not null default 'internal' check (mode in ('internal','external')),
  billing_party text not null default 'center' check (billing_party in ('center','provider')),
  referring_doctor_key text,
  performing_doctor_key text,
  external_provider_id uuid references clinic_reception.external_providers(id),
  status text not null default 'referred' check (status in
    ('referred','scheduled','attended','cancelled','no_show','done','report_uploaded','patient_notified')),
  status_at timestamptz not null default now(),
  report_file_ref text,
  priced jsonb,
  created_at timestamptz not null default now(),
  check (mode='internal' or external_provider_id is not null),
  check (billing_party='center' or mode='external'));

create table if not exists clinic_reception.order_status_log(
  id bigserial primary key,
  order_id uuid not null references clinic_reception.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  at timestamptz not null default now(),
  by_user uuid);

create or replace function clinic_reception.order_ext_status_guard() returns trigger
language plpgsql as $$
declare ok boolean;
begin
  if tg_op='UPDATE' and new.status is distinct from old.status then
    ok := (old.status,new.status) in (
      ('referred','scheduled'),('referred','cancelled'),
      ('scheduled','attended'),('scheduled','cancelled'),('scheduled','no_show'),
      ('attended','done'),('done','report_uploaded'),('report_uploaded','patient_notified'));
    if not ok then raise exception 'invalid order status transition % -> %',old.status,new.status; end if;
    new.status_at := now();
    insert into clinic_reception.order_status_log(order_id,from_status,to_status) values(new.order_id,old.status,new.status);
  end if;
  return new;
end $$;

drop trigger if exists order_ext_status_guard on clinic_reception.order_ext;
create trigger order_ext_status_guard before update on clinic_reception.order_ext
  for each row execute function clinic_reception.order_ext_status_guard();

alter table clinic_reception.service_specialties enable row level security;
alter table clinic_reception.service_performers  enable row level security;
alter table clinic_reception.referral_rates      enable row level security;
alter table clinic_reception.external_providers  enable row level security;
alter table clinic_reception.provider_cost_list  enable row level security;
alter table clinic_reception.order_ext           enable row level security;
alter table clinic_reception.order_status_log    enable row level security;
commit;
