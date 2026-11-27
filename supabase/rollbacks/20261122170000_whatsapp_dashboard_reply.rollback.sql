-- Rollback for 20261122170000_whatsapp_dashboard_reply.sql (drops the WhatsApp outbox; keeps social_messages rows).
begin;
drop function if exists public.whatsapp_outbox_api(text, jsonb);
drop function if exists public.whatsapp_templates_list();
drop function if exists public.whatsapp_outbox_get(uuid);
drop function if exists public.whatsapp_outbox_enqueue(text, text, uuid, text, text, text);
drop function if exists ops_private.whatsapp_outbox_sweep();
drop table if exists ops_private.whatsapp_templates;
drop table if exists ops_private.whatsapp_outbox;
alter table public.social_messages drop constraint if exists social_messages_bot_state_chk;
alter table public.social_messages drop column if exists bot_state;
commit;
