-- Messenger / Instagram booking flow: per-conversation state + reception handoff notification.
create table if not exists public.messenger_flow_state (
  conversation_id text primary key,
  platform text not null, brand text not null, sender_id text,
  stage text not null default 'collecting' check (stage in ('collecting','ready','handoff')),
  name text, phone text, service text, preferred_time text, expect text,
  unclear integer not null default 0, handoff_reason text, lead_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.messenger_flow_state enable row level security;
create policy messenger_flow_state_read on public.messenger_flow_state for select to authenticated using (public.social_comments_access());
grant select on public.messenger_flow_state to authenticated;

alter table public.task_notifications drop constraint if exists task_notifications_kind_check;
alter table public.task_notifications add constraint task_notifications_kind_check
  check (kind in ('assigned','status','review','returned','overdue','comment','due_soon','lead_reminder','messenger_handoff'));

-- Notify active reception staff that a conversation needs a human (ready booking or handoff).
create or replace function public.messenger_flow_notify(p_message text) returns integer
 language plpgsql security definer set search_path to 'public' as $$
declare r record; n integer := 0;
begin
  for r in select a.id from public.admins a where a.active and a.role = 'reception' loop
    insert into public.task_notifications(recipient_id, task_id, kind, message, reference_date)
    values (r.id, null, 'messenger_handoff', left(p_message, 300), current_date);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.messenger_flow_notify(text) from public, anon, authenticated;
grant execute on function public.messenger_flow_notify(text) to service_role;
