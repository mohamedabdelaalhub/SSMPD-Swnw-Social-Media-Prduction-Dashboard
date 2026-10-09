-- Autopilot replies for comments + private messages (applied live 2026-10-09).
alter table public.social_comments add column if not exists category text, add column if not exists alert boolean not null default false,
  add column if not exists alert_resolved_at timestamptz, add column if not exists alert_resolved_by uuid;
create table if not exists public.social_settings (key text primary key, value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
alter table public.social_settings enable row level security;
insert into public.social_settings(key, value) values ('autopilot', '{"comments":true,"messages":true}') on conflict (key) do nothing;
create table if not exists public.social_messages (
  id text primary key, platform text not null, brand text not null, conversation_id text not null, conversation_url text,
  sender_id text, sender_name text, is_page boolean not null default false, message text not null default '', sent_at timestamptz,
  status text not null default 'new' check (status in ('new','replied','skipped','failed','expired')),
  category text, alert boolean not null default false, alert_resolved_at timestamptz, alert_resolved_by uuid,
  reply_text text, replied_at timestamptz, reply_platform_id text, last_error text,
  fetched_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.social_messages enable row level security;
create policy social_messages_read on public.social_messages for select to authenticated using (public.social_comments_access());
create policy social_settings_read on public.social_settings for select to authenticated using (public.social_comments_access());
grant select on public.social_messages, public.social_settings to authenticated;

create or replace function public.social_alert_resolve(p_kind text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.social_comments_access() then raise exception 'FORBIDDEN'; end if;
  if p_kind = 'comment' then
    update social_comments set alert_resolved_at = now(), alert_resolved_by = public.my_admin_id() where id = p_id and alert;
  elsif p_kind = 'message' then
    update social_messages set alert_resolved_at = now(), alert_resolved_by = public.my_admin_id() where conversation_id = (select conversation_id from social_messages where id = p_id) and alert and alert_resolved_at is null;
  else raise exception 'bad kind'; end if;
end $$;
revoke all on function public.social_alert_resolve(text, text) from public, anon;
grant execute on function public.social_alert_resolve(text, text) to authenticated;
