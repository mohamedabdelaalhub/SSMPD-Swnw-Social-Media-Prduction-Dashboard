-- Rollback of 20261128200000_staff_assistant.sql. DROPS the staff requests and the usage counters (export them first if needed).
-- The staff_notifications rows of kind 'assistant_request' are deleted before the kind check is put back.
begin;
drop function if exists public.staff_assistant_request_create(text, text, text, jsonb);
drop function if exists public.staff_assistant_my_requests();
drop function if exists public.staff_assistant_request_seen(uuid);
drop function if exists public.staff_assistant_request_reply(uuid, text);
drop function if exists public.staff_assistant_all_requests(date);
drop function if exists public.staff_assistant_decide(uuid, text, text);
drop function if exists public.staff_assistant_set_status(uuid, text, text);
drop function if exists public.staff_assistant_annotate(uuid, jsonb);
drop function if exists public.staff_assistant_settings(text, jsonb);
drop function if exists public.staff_assistant_usage_take();
drop function if exists public.staff_assistant_usage_record(bigint, bigint, bigint, bigint);
do $$ begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists assistant_shots_insert on storage.objects';
    execute 'drop policy if exists assistant_shots_select on storage.objects';
  end if;
end $$;
drop function if exists public.assistant_shot_allowed(text, boolean);
drop schema if exists staff_assistant cascade;
delete from public.staff_notifications where kind = 'assistant_request';
do $$ declare k text; begin
  select pg_get_constraintdef(c.oid) into k from pg_constraint c
   where c.conrelid = 'public.staff_notifications'::regclass and c.conname = 'staff_notifications_kind_check';
  if k like '%assistant_request%' then
    execute 'alter table public.staff_notifications drop constraint staff_notifications_kind_check';
    execute 'alter table public.staff_notifications add constraint staff_notifications_kind_check ' || replace(k, ', ''assistant_request''::text', '');
  end if;
end $$;
alter table public.staff_notifications drop column if exists request_id;
commit;
-- The 'assistant-shots' bucket and its files are kept (storage); delete them from the dashboard if no longer wanted.
