-- Rollback for 20261122180000_social_conversation_leads.sql (leads themselves are kept; only the chat links go).
begin;
drop function if exists public.social_conversation_lead_create(text, text, text);
drop function if exists public.social_conversation_lead(text);
drop function if exists public.social_conversation_lead_summary(uuid, text);
drop function if exists public.social_conversation_lead_id(text);
drop table if exists public.social_conversation_leads;
commit;
