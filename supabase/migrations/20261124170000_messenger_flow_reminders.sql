-- One reminder per stuck Messenger booking conversation (see meta-comments/messages.ts sendFlowReminders).
alter table public.messenger_flow_state add column if not exists reminded_at timestamptz;
