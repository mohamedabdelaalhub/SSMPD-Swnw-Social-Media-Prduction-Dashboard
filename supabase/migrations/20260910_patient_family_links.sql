-- Patient portal family links
-- Family membership and medical record access are intentionally separate.
-- All client access should go through authenticated Edge Functions using service role.

create table if not exists public.patient_family_requests (
  id uuid primary key default gen_random_uuid(),
  requester_account_id uuid not null references public.patient_accounts(id) on delete cascade,
  target_account_id uuid not null references public.patient_accounts(id) on delete cascade,
  match_method text not null check (match_method in ('patient_code','phone','email')),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled','expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  constraint patient_family_requests_not_self check (requester_account_id <> target_account_id)
);

create index if not exists idx_patient_family_requests_requester
  on public.patient_family_requests(requester_account_id, status, created_at desc);
create index if not exists idx_patient_family_requests_target
  on public.patient_family_requests(target_account_id, status, created_at desc);

create unique index if not exists uq_patient_family_requests_pending_pair
  on public.patient_family_requests(
    least(requester_account_id, target_account_id),
    greatest(requester_account_id, target_account_id)
  )
  where status = 'pending';

create table if not exists public.patient_family_links (
  id uuid primary key default gen_random_uuid(),
  account_a_id uuid not null references public.patient_accounts(id) on delete cascade,
  account_b_id uuid not null references public.patient_accounts(id) on delete cascade,
  created_from_request_id uuid references public.patient_family_requests(id) on delete set null,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by_account_id uuid references public.patient_accounts(id) on delete set null,
  constraint patient_family_links_not_self check (account_a_id <> account_b_id)
);

create index if not exists idx_patient_family_links_a
  on public.patient_family_links(account_a_id, status, created_at desc);
create index if not exists idx_patient_family_links_b
  on public.patient_family_links(account_b_id, status, created_at desc);

create unique index if not exists uq_patient_family_links_active_pair
  on public.patient_family_links(
    least(account_a_id, account_b_id),
    greatest(account_a_id, account_b_id)
  )
  where status = 'active';

create table if not exists public.patient_family_record_shares (
  id uuid primary key default gen_random_uuid(),
  family_link_id uuid not null references public.patient_family_links(id) on delete cascade,
  owner_account_id uuid not null references public.patient_accounts(id) on delete cascade,
  recipient_account_id uuid not null references public.patient_accounts(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  patient_account_access_id uuid references public.patient_account_access(id) on delete set null,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_account_id uuid references public.patient_accounts(id) on delete set null,
  constraint patient_family_record_shares_not_self check (owner_account_id <> recipient_account_id)
);

create index if not exists idx_patient_family_record_shares_owner
  on public.patient_family_record_shares(owner_account_id, status, created_at desc);
create index if not exists idx_patient_family_record_shares_recipient
  on public.patient_family_record_shares(recipient_account_id, status, created_at desc);
create index if not exists idx_patient_family_record_shares_patient
  on public.patient_family_record_shares(patient_id, status, created_at desc);

create unique index if not exists uq_patient_family_record_shares_active
  on public.patient_family_record_shares(owner_account_id, recipient_account_id, patient_id)
  where status = 'active';

alter table public.patient_family_requests enable row level security;
alter table public.patient_family_links enable row level security;
alter table public.patient_family_record_shares enable row level security;

comment on table public.patient_family_requests is
  'Pairwise family invitation requests. Exact-match discovery happens only in a secured Edge Function and must not expose whether arbitrary patient data exists.';
comment on table public.patient_family_links is
  'Accepted pairwise family connections. No transitive family membership is implied.';
comment on table public.patient_family_record_shares is
  'Explicit medical-record sharing consent between accepted family members. Family membership alone never grants medical access.';
