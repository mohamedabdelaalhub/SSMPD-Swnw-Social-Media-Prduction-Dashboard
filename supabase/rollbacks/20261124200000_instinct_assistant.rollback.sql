-- Rollback of 20261124200000_instinct_assistant.sql. Refuses while an ai_assistant account exists (switch or delete it first).
-- Drops the notes / threads / messages / notifications / audit log (export the audit log first if it must be kept).
begin;

do $$ begin
  if to_regclass('public.instinct_saved_defs') is null then raise exception 'instinct_assistant غير مطبّق'; end if;
  if exists (select 1 from public.admins where role = 'ai_assistant') then raise exception 'فيه حساب ai_assistant — غيّر دوره أو احذفه الأول'; end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.instinct_context()', 'public.instinct_notes_list()', 'public.instinct_note_save(uuid,text,text,text)',
    'public.instinct_note_decide(uuid,text)', 'public.instinct_ask(uuid,text)', 'public.instinct_reply(uuid,text)', 'public.instinct_threads_list()',
    'public.instinct_thread(uuid)', 'public.instinct_notifications_list()', 'public.instinct_notifications_read(uuid[])',
    'public.instinct_unread_since(timestamptz)', 'public.instinct_staff_profiles()', 'public.instinct_audit_list(integer)',
    'public.instinct_require()', 'public.instinct_audit(uuid,text,text,text,uuid,jsonb)', 'public.instinct_notify(uuid,text,text,uuid,text)',
    'public.instinct_check_text(text)', 'public.instinct_patient_data_reason(text)'] loop
    execute format('drop function if exists %s', f);
  end loop;
end $$;

drop table if exists public.instinct_audit_log, public.instinct_notifications, public.instinct_messages, public.instinct_threads cascade;
drop function if exists public.instinct_note_json(public.instinct_notes);
drop table if exists public.instinct_notes cascade;
drop function if exists public.instinct_audit_immutable();

-- restrictive policies
do $$ declare r record; begin
  for r in select p.polrelid::regclass::text t from pg_policy p where p.polname = 'instinct_ai_block' loop
    execute format('drop policy instinct_ai_block on %s', r.t);
  end loop;
end $$;

drop trigger if exists instinct_guard_ai_admin on public.admins;
do $$ begin
  if to_regclass('public.admin_extra_roles') is not null then drop trigger if exists instinct_guard_ai_extra_role on public.admin_extra_roles; end if;
end $$;
drop function if exists public.instinct_guard_ai_admin(), public.instinct_guard_ai_extra_role();

-- my_admin_id() and admins_role_check back to their saved definitions
do $$ declare d text; begin
  select def into d from public.instinct_saved_defs where name = 'public.my_admin_id()';
  if d is null then raise exception 'saved my_admin_id() definition missing'; end if;
  execute d;
  select def into d from public.instinct_saved_defs where name = 'constraint:public.admins:admins_role_check';
  if d is null then raise exception 'saved admins_role_check definition missing'; end if;
  alter table public.admins drop constraint admins_role_check;
  execute format('alter table public.admins add constraint admins_role_check %s', d);
end $$;
revoke all on function public.my_admin_id() from public;
grant execute on function public.my_admin_id() to authenticated;

drop function if exists public.instinct_not_ai(), public.instinct_ai_id(), public.instinct_caller_is_owner(), public.instinct_my_groups(), public.instinct_owner_id();
drop table public.instinct_saved_defs;

commit;
