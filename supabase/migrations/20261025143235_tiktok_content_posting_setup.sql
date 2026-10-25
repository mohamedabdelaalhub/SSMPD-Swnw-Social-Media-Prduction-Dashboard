alter table public.meta_publish_jobs
  add column if not exists publish_tiktok boolean not null default false,
  add column if not exists tiktok_privacy_level text,
  add column if not exists tiktok_disable_comment boolean not null default true,
  add column if not exists tiktok_disable_duet boolean not null default true,
  add column if not exists tiktok_disable_stitch boolean not null default true,
  add column if not exists tiktok_commercial_content boolean not null default false,
  add column if not exists tiktok_your_brand boolean not null default false,
  add column if not exists tiktok_branded_content boolean not null default false,
  add column if not exists tiktok_music_confirmation boolean not null default false,
  add column if not exists tiktok_publish_id text,
  add column if not exists tiktok_publish_status text,
  add column if not exists tiktok_share_url text,
  add column if not exists tiktok_post_id text,
  add column if not exists tiktok_error text;

create table if not exists public.tiktok_accounts (
  id uuid primary key default gen_random_uuid(),
  brand text not null unique check (brand in ('sono','dr_dina')),
  open_id text not null,
  username text,
  display_name text,
  avatar_url text,
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  connected_by uuid,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tiktok_accounts enable row level security;
revoke all on public.tiktok_accounts from anon, authenticated;
grant all on public.tiktok_accounts to service_role;

create table if not exists public.tiktok_oauth_states (
  state text primary key,
  brand text not null check (brand in ('sono','dr_dina')),
  admin_user_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.tiktok_oauth_states enable row level security;
revoke all on public.tiktok_oauth_states from anon, authenticated;
grant all on public.tiktok_oauth_states to service_role;

create index if not exists meta_publish_jobs_tiktok_due_idx
  on public.meta_publish_jobs (scheduled_at)
  where status = 'pending' and publish_tiktok = true;