-- Manual replies to Messenger / Instagram Direct from the dashboard (owner 2026-11-22: «ايوة عايز الموظف يقدر يرد من الداشبورد»).
-- The send itself happens in the meta-comments edge function (action "send_message", Graph /{page}/messages,
-- messaging_type RESPONSE, only inside Meta's 24h window). This column records WHO sent each manual reply:
--   * on the page message row the function inserts, and
--   * on the customer rows that reply answered.
-- Autopilot rows keep sent_by = null («رد تلقائي»). Reads stay under the existing social_messages_read policy.
-- Rollback: supabase/rollbacks/20261122140000_social_messages_manual_reply.rollback.sql
begin;
alter table public.social_messages add column if not exists sent_by uuid references public.admins(id) on delete set null;
comment on column public.social_messages.sent_by is 'admin who sent this manual dashboard reply (null = autopilot or synced from Meta)';
commit;
