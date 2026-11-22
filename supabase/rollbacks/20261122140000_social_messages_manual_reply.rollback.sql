-- Rollback of 20261122140000_social_messages_manual_reply.sql
begin;
alter table public.social_messages drop column if exists sent_by;
commit;
