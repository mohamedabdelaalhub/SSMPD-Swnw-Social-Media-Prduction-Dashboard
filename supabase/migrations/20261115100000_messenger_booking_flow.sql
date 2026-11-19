-- Messenger / Instagram booking flow: per-conversation state + reception handoff notification.
create table if not exists public.messenger_flow_state (
  conversation_id text primary key,
  platform text not null, brand text not null, sender_id text,
  stage text not null default 'collecting' check (stage in ('collecting','ready','handoff')),
  name text, phone text, service text, preferred_time text, expect text,
  unclear integer not null default 0, handoff_reason text, lead_id uuid,
  handoff_at timestamptz, reviewed_at timestamptz, reviewed_human_count integer not null default 0, no_reply_alerted boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.messenger_flow_state enable row level security;
create policy messenger_flow_state_read on public.messenger_flow_state for select to authenticated using (public.social_comments_access());
grant select on public.messenger_flow_state to authenticated;

alter table public.task_notifications drop constraint if exists task_notifications_kind_check;
alter table public.task_notifications add constraint task_notifications_kind_check
  check (kind in ('assigned','status','review','returned','overdue','comment','due_soon','lead_reminder','messenger_handoff'));

-- Notify active reception staff that a conversation needs a human (ready booking or handoff).
create or replace function public.messenger_flow_notify(p_message text, p_role text default 'reception') returns integer
 language plpgsql security definer set search_path to 'public' as $$
declare r record; n integer := 0;
begin
  for r in select a.id from public.admins a where a.active and a.role = p_role loop
    insert into public.task_notifications(recipient_id, task_id, kind, message, reference_date)
    values (r.id, null, 'messenger_handoff', left(p_message, 300), current_date);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.messenger_flow_notify(text,text) from public, anon, authenticated;
grant execute on function public.messenger_flow_notify(text,text) to service_role;

-- Ad attribution: Meta sends the ad id in the `referral` of the first Click-to-Messenger message (webhook only).
create table if not exists public.messenger_referrals (
  sender_id text not null, page_id text not null, ad_id text, ref text, source text,
  first_seen timestamptz not null default now(), primary key (sender_id, page_id)
);
alter table public.messenger_referrals enable row level security;
create policy messenger_referrals_read on public.messenger_referrals for select to authenticated using (public.can_manage_all_content());
grant select on public.messenger_referrals to authenticated;

-- After a human takes over: AI review of what happened and how the staff member handled it.
create table if not exists public.messenger_flow_reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null, lead_id uuid, brand text,
  outcome text check (outcome in ('booked','pending','declined','unclear')),
  summary text, booking_time text,
  staff_quality text check (staff_quality in ('good','ok','poor')),
  issues text[] not null default '{}', needs_owner boolean not null default false,
  human_messages integer not null default 0, created_at timestamptz not null default now()
);
create index if not exists messenger_flow_reviews_conv_idx on public.messenger_flow_reviews(conversation_id, created_at desc);
alter table public.messenger_flow_reviews enable row level security;
create policy messenger_flow_reviews_read on public.messenger_flow_reviews for select to authenticated using (public.can_manage_all_content());
grant select on public.messenger_flow_reviews to authenticated;

-- Apply a review to the lead: note as an attempt + conservative status change (booked / rejected only from open states).
create or replace function public.messenger_flow_apply_review(p_lead uuid, p_outcome text, p_summary text) returns void
 language plpgsql security definer set search_path to 'public' as $$
begin
  if p_lead is null then return; end if;
  insert into public.lead_attempts(lead_id, result, notes) values (p_lead, 'other', left('[ملخص آلي لمحادثة ماسنجر] ' || coalesce(p_summary,''), 1000));
  if p_outcome = 'booked' then update public.leads set current_status = 'booked' where id = p_lead and current_status in ('new','in_progress','interested_undecided');
  elsif p_outcome = 'declined' then update public.leads set current_status = 'rejected' where id = p_lead and current_status in ('new','in_progress','interested_undecided');
  else update public.leads set current_status = 'in_progress' where id = p_lead and current_status = 'new'; end if;
end $$;
revoke all on function public.messenger_flow_apply_review(uuid,text,text) from public, anon, authenticated;
grant execute on function public.messenger_flow_apply_review(uuid,text,text) to service_role;
