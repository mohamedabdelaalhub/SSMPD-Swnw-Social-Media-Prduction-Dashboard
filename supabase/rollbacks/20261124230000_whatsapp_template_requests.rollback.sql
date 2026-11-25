-- Rollback for 20261124230000_whatsapp_template_requests.sql (drops the request queue and its audit; the picker table stays).
begin;
drop function if exists public.whatsapp_template_api(text, jsonb);
drop function if exists public.whatsapp_template_requests_list();
drop function if exists public.whatsapp_template_submit(uuid, text, text, text);
drop function if exists ops_private.whatsapp_template_sweep();
drop table if exists ops_private.whatsapp_template_audit;
drop table if exists ops_private.whatsapp_template_requests;
commit;
