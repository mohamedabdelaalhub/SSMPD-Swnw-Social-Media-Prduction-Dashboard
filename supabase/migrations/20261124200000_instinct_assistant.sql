-- «مساعد إنستنكت» Phase 1 (owner request 2026-11-24): an AI program («Instinct») gets its own dashboard user (role ai_assistant)
-- and works as a guide for the owner and the staff. Dashboard only; additive.
--
-- 1. Role ai_assistant: admins.role accepts it (rebuilt from the LIVE value list, nothing dropped); admin_extra_roles does NOT.
--    An ai_assistant row can never carry an access flag (any has_* / can_* column = true) or an extra role (triggers).
-- 2. Lockout of ai_assistant from every other module (defense in depth):
--    a. public.my_admin_id() no longer resolves an ai_assistant account (old definition saved in public.instinct_saved_defs),
--       so every role-generic RPC that starts from my_admin_id() refuses it; has_role()/has_any_role()/is_super() never match it.
--    b. One RESTRICTIVE policy «instinct_ai_block» on every RLS-enabled table in the application schemas (public + clinic_* + …):
--       an ai_assistant caller sees / writes nothing. public.admins: its own row only (login).
--    The only doors left are the instinct_* RPCs below.
-- 3. Notes (title, date, body, target group, status draft → approved → published). Instinct writes drafts; ONLY the owner
--    (public.administrative_assistant_config.owner_admin_id — the same single account as public.digital_chat_owner()) approves or
--    publishes. Staff see a note only once it is published for one of their groups (or «all»).
-- 4. Questions: staff open threads, Instinct replies in the same thread. Staff see only their own threads; owner + Instinct see all.
-- 5. Every message / note is checked server-side for patient identifiers (Egyptian mobile, P-YYYY-NNNNNN, national id, «مريض» + a
--    long number) in Arabic or Latin digits, and refused with a clear Arabic error.
-- 6. In-dashboard notifications (public.instinct_notifications, read through RPCs) + public.instinct_unread_since(ts) for Phase 2.
-- 7. Append-only audit log (public.instinct_audit_log): no update / delete / truncate for anyone (triggers), no client grants.
-- 8. Hidden per-user description (role + permission summary, generated from admins + admin_extra_roles; no free text, no
--    contact data): public.instinct_staff_profiles(), owner + ai_assistant only.
-- All tables: RLS on, no policies, no client grants. All access through SECURITY DEFINER RPCs with role checks.
-- Rollback: supabase/rollbacks/20261124200000_instinct_assistant.rollback.sql
begin;

do $$ begin
  if to_regclass('public.instinct_notes') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('public.has_role(text)') is null or to_regprocedure('public.has_any_role(text[])') is null
     or to_regprocedure('public.my_admin_id()') is null then raise exception 'has_role / has_any_role / my_admin_id غير موجودة'; end if;
  if to_regclass('public.administrative_assistant_config') is null then raise exception 'administrative_assistant_config غير موجود'; end if;
  if not exists (select 1 from public.administrative_assistant_config c join public.admins a on a.id = c.owner_admin_id where c.id = 1 and a.active) then
    raise exception 'مفيش مالك نشط في administrative_assistant_config';
  end if;
end $$;

create table public.instinct_saved_defs(name text primary key, def text not null, saved_at timestamptz not null default now());
alter table public.instinct_saved_defs enable row level security;
revoke all on public.instinct_saved_defs from public, anon, authenticated;

-- 1. role check (rebuilt from the live list + ai_assistant) ---------------------------------------------------------------
do $$
declare d text; vals text[];
begin
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'admins_role_check' and conrelid = 'public.admins'::regclass;
  if d is null then raise exception 'admins_role_check not found'; end if;
  insert into public.instinct_saved_defs(name, def) values ('constraint:public.admins:admins_role_check', d);
  select array_agg(distinct m[1] order by m[1]) into vals from regexp_matches(d, '''([a-z_]+)''', 'g') m;
  if not ('reception' = any(vals) and 'super_admin' = any(vals)) then raise exception 'unexpected admins_role_check definition'; end if;
  vals := array(select distinct x from unnest(vals || array['ai_assistant']) x order by 1);
  alter table public.admins drop constraint admins_role_check;
  execute format('alter table public.admins add constraint admins_role_check check (role = any (%L::text[]))', vals);
end $$;

-- Instinct is a program: no access flag and no extra role, ever.
create function public.instinct_guard_ai_admin() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare k text;
begin
  if new.role = 'ai_assistant' then
    select string_agg(e.key, ', ') into k from jsonb_each(to_jsonb(new)) e
     where (e.key like 'has\_%' or e.key like 'can\_%') and e.value = 'true'::jsonb;
    if k is not null then raise exception 'حساب مساعد إنستنكت مايقدرش ياخد صلاحيات إضافية (%)', k using errcode = '42501'; end if;
    if to_regclass('public.admin_extra_roles') is not null and exists (select 1 from public.admin_extra_roles r where r.admin_id = new.id) then
      raise exception 'حساب مساعد إنستنكت مايقدرش يبقى له أدوار إضافية' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.instinct_guard_ai_admin() from public, anon, authenticated;
create trigger instinct_guard_ai_admin before insert or update on public.admins for each row execute function public.instinct_guard_ai_admin();

create function public.instinct_guard_ai_extra_role() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if exists (select 1 from public.admins a where a.id = new.admin_id and a.role = 'ai_assistant') then
    raise exception 'حساب مساعد إنستنكت مايقدرش يبقى له أدوار إضافية' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.instinct_guard_ai_extra_role() from public, anon, authenticated;
do $$ begin
  if to_regclass('public.admin_extra_roles') is not null then
    create trigger instinct_guard_ai_extra_role before insert or update on public.admin_extra_roles
      for each row execute function public.instinct_guard_ai_extra_role();
  end if;
end $$;

-- 2a. my_admin_id() skips an ai_assistant account ---------------------------------------------------------------------------
do $$
declare d text; src text;
begin
  select pg_get_functiondef('public.my_admin_id()'::regprocedure), p.prosrc into d, src from pg_proc p where p.oid = 'public.my_admin_id()'::regprocedure;
  if regexp_replace(lower(src), '\s+', ' ', 'g') !~ '^ ?select id from public\.admins where user_id = auth\.uid\(\) and active limit 1;? ?$' then
    raise exception 'my_admin_id() live body is not the expected one — review before applying: %', src;
  end if;
  insert into public.instinct_saved_defs(name, def) values ('public.my_admin_id()', d);
end $$;
create or replace function public.my_admin_id()
returns uuid language sql security definer stable set search_path = public as $$
  select id from public.admins where user_id = auth.uid() and active and role <> 'ai_assistant' limit 1;
$$;
revoke all on function public.my_admin_id() from public;
grant execute on function public.my_admin_id() to authenticated;

-- caller identity helpers
create function public.instinct_not_ai() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select not exists (select 1 from public.admins where user_id = auth.uid() and role = 'ai_assistant');
$$;
revoke all on function public.instinct_not_ai() from public, anon;
grant execute on function public.instinct_not_ai() to authenticated;

create function public.instinct_ai_id() returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select id from public.admins where user_id = auth.uid() and active and role = 'ai_assistant' limit 1;
$$;
create function public.instinct_owner_id() returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select a.id from public.admins a join public.administrative_assistant_config c on c.owner_admin_id = a.id
   where c.id = 1 and a.active and a.role <> 'ai_assistant' limit 1;
$$;
create function public.instinct_caller_is_owner() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select auth.uid() is not null and exists (select 1 from public.admins a where a.id = public.instinct_owner_id() and a.user_id = auth.uid());
$$;
-- the caller's note groups (empty for ai_assistant: it has none of these roles)
create function public.instinct_my_groups() returns text[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select array_remove(array[
    case when public.has_role('reception') then 'reception' end,
    case when public.has_role('customer_service') then 'customer_service' end,
    case when public.has_any_role(array['page_manager','designer','approver']) then 'content' end,
    case when public.has_any_role(array['accountant','financial_manager']) then 'finance' end,
    case when public.has_any_role(array['general_manager','super_admin']) then 'management' end
  ]::text[], null);
$$;
revoke all on function public.instinct_ai_id(), public.instinct_owner_id(), public.instinct_caller_is_owner(), public.instinct_my_groups()
  from public, anon, authenticated;

-- 2b. restrictive policy on every RLS-enabled application table -------------------------------------------------------------
do $$
declare r record; cnt int := 0; skipped text := '';
begin
  for r in select c.oid, format('%I.%I', n.nspname, c.relname) t, n.nspname, c.relname, c.relowner from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r', 'p') and c.relrowsecurity
              and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', '_realtime', 'supabase_functions',
                                    'supabase_migrations', 'extensions', 'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks',
                                    'vault', 'cron', 'pgbouncer', '_analytics', 'pg_toast')
              and n.nspname not like 'pg\_%'
              and not (n.nspname = 'public' and c.relname like 'instinct\_%')
              and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'instinct_ai_block')
            order by 2 loop
    if not pg_has_role(current_user, r.relowner, 'USAGE') then skipped := skipped || ' ' || r.t; continue; end if;
    if r.nspname = 'public' and r.relname = 'admins' then
      execute 'create policy instinct_ai_block on public.admins as restrictive for all to authenticated
                 using ((select public.instinct_not_ai()) or user_id = (select auth.uid()))
                 with check ((select public.instinct_not_ai()) or user_id = (select auth.uid()))';
    else
      execute format('create policy instinct_ai_block on %s as restrictive for all to authenticated
                        using ((select public.instinct_not_ai())) with check ((select public.instinct_not_ai()))', r.t);
    end if;
    cnt := cnt + 1;
  end loop;
  if not exists (select 1 from pg_policy where polrelid = 'public.admins'::regclass and polname = 'instinct_ai_block') then
    raise exception 'instinct_ai_block was not created on public.admins';
  end if;
  raise notice 'instinct_ai_block on % tables%', cnt, case when skipped <> '' then '; skipped (not owner):' || skipped else '' end;
end $$;

-- 3-7. tables ---------------------------------------------------------------------------------------------------------------
create table public.instinct_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  body text not null check (char_length(btrim(body)) between 3 and 4000),
  target_role text not null check (target_role in ('all', 'reception', 'customer_service', 'content', 'finance', 'management')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'published')),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references public.admins(id),
  approved_at timestamptz,
  published_by uuid references public.admins(id),
  published_at timestamptz
);
create index instinct_notes_status_idx on public.instinct_notes(status, target_role, published_at desc);

create table public.instinct_threads (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_author_kind text not null default 'staff' check (last_author_kind in ('staff', 'instinct'))
);
create index instinct_threads_staff_idx on public.instinct_threads(staff_id, last_message_at desc);
create index instinct_threads_last_idx on public.instinct_threads(last_message_at desc);

create table public.instinct_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.instinct_threads(id),
  author_id uuid not null references public.admins(id),
  author_kind text not null check (author_kind in ('staff', 'instinct')),
  body text not null check (char_length(btrim(body)) between 2 and 4000),
  created_at timestamptz not null default now()
);
create index instinct_messages_thread_idx on public.instinct_messages(thread_id, created_at);
create index instinct_messages_created_idx on public.instinct_messages(created_at);

create table public.instinct_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.admins(id) on delete cascade,
  kind text not null check (kind in ('new_draft', 'new_question', 'reply')),
  entity_type text not null check (entity_type in ('note', 'thread')),
  entity_id uuid not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index instinct_notifications_recipient_idx on public.instinct_notifications(recipient_id, created_at desc);

create table public.instinct_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('owner', 'instinct', 'staff')),
  action text not null check (action in ('note_create', 'note_edit', 'note_approve', 'note_publish', 'question', 'reply')),
  entity_type text not null check (entity_type in ('note', 'thread')),
  entity_id uuid not null,
  detail jsonb not null default '{}'::jsonb
);
create index instinct_audit_log_entity_idx on public.instinct_audit_log(entity_type, entity_id, at);

create function public.instinct_audit_immutable() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'سجل تدقيق مساعد إنستنكت للإضافة فقط — مفيش تعديل ولا حذف' using errcode = '42501';
end $$;
revoke all on function public.instinct_audit_immutable() from public, anon, authenticated;
create trigger instinct_audit_no_update before update or delete on public.instinct_audit_log for each row execute function public.instinct_audit_immutable();
create trigger instinct_audit_no_truncate before truncate on public.instinct_audit_log for each statement execute function public.instinct_audit_immutable();

do $$ declare t text; begin
  foreach t in array array['public.instinct_notes', 'public.instinct_threads', 'public.instinct_messages', 'public.instinct_notifications', 'public.instinct_audit_log'] loop
    execute format('alter table %s enable row level security', t);
    execute format('revoke all on %s from public, anon, authenticated', t);
  end loop;
end $$;

-- 5. patient-identifier guard -----------------------------------------------------------------------------------------------
create function public.instinct_patient_data_reason(p text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  t text := translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  joined text;
begin
  -- digits split by spaces / dashes / dots / slashes are joined: «010 1234 5678» = «01012345678»
  joined := regexp_replace(t, '([0-9+])[[:space:]./()_-]+(?=[0-9])', '\1', 'g');
  if joined ~ '(01[0125][0-9]{8}|201[0125][0-9]{8})' then
    return 'ممنوع كتابة رقم موبايل في مساعد إنستنكت (ممكن يكون رقم مريض). امسح الرقم واكتب سؤالك من غير بيانات مريض.';
  end if;
  if t ~* 'p[[:space:]_-]*[0-9]{4}[[:space:]_-]*[0-9]{4,6}' then
    return 'ممنوع كتابة كود ملف مريض (P-…) في مساعد إنستنكت. امسح الكود واكتب سؤالك من غير بيانات مريض.';
  end if;
  if joined ~ '[23][0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{7}' then
    return 'ممنوع كتابة رقم قومي في مساعد إنستنكت. امسح الرقم واكتب سؤالك من غير بيانات مريض.';
  end if;
  if t ~ '(مريض|مريضة|المريض|المريضه|العيان|ملف)' and joined ~ '[0-9]{5,}' then
    return 'ممنوع كتابة رقم مريض أو رقم ملف في مساعد إنستنكت. امسح الرقم واكتب سؤالك من غير بيانات مريض.';
  end if;
  return null;
end $$;
revoke all on function public.instinct_patient_data_reason(text) from public, anon;
grant execute on function public.instinct_patient_data_reason(text) to authenticated;

create function public.instinct_check_text(p text) returns void
language plpgsql immutable set search_path = pg_catalog, public as $$
declare why text := public.instinct_patient_data_reason(p);
begin
  if why is not null then raise exception '%', why using errcode = '22023', hint = 'instinct_patient_data'; end if;
end $$;
revoke all on function public.instinct_check_text(text) from public, anon, authenticated;

-- internal writers
create function public.instinct_audit(p_actor uuid, p_kind text, p_action text, p_type text, p_id uuid, p_detail jsonb) returns void
language sql volatile security definer set search_path = pg_catalog, public as $$
  insert into public.instinct_audit_log(actor_id, actor_kind, action, entity_type, entity_id, detail)
  values (p_actor, p_kind, p_action, p_type, p_id, coalesce(p_detail, '{}'::jsonb));
$$;
create function public.instinct_notify(p_recipient uuid, p_kind text, p_type text, p_id uuid, p_message text) returns void
language sql volatile security definer set search_path = pg_catalog, public as $$
  insert into public.instinct_notifications(recipient_id, kind, entity_type, entity_id, message)
  select p_recipient, p_kind, p_type, p_id, left(p_message, 300)
   where p_recipient is not null and exists (select 1 from public.admins a where a.id = p_recipient and a.active);
$$;
revoke all on function public.instinct_audit(uuid, text, text, text, uuid, jsonb), public.instinct_notify(uuid, text, text, uuid, text)
  from public, anon, authenticated;

-- who may open the assistant at all
create function public.instinct_require() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare ai uuid := public.instinct_ai_id(); own boolean := public.instinct_caller_is_owner(); me uuid := public.my_admin_id(); g text[];
begin
  if ai is not null then return jsonb_build_object('id', ai, 'kind', 'instinct', 'owner', false, 'groups', '[]'::jsonb); end if;
  if me is null then raise exception 'سجّل الدخول' using errcode = '42501'; end if;
  g := public.instinct_my_groups();
  if not own and cardinality(g) = 0 then raise exception 'مساعد إنستنكت مش متاح لحسابك' using errcode = '42501'; end if;
  return jsonb_build_object('id', me, 'kind', case when own then 'owner' else 'staff' end, 'owner', own, 'groups', to_jsonb(g));
end $$;
revoke all on function public.instinct_require() from public, anon, authenticated;

create function public.instinct_note_json(n public.instinct_notes) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'target_role', n.target_role, 'status', n.status,
    'created_at', n.created_at, 'updated_at', n.updated_at, 'approved_at', n.approved_at, 'published_at', n.published_at,
    'created_by_name', (select coalesce(a.name, 'مساعد إنستنكت') from public.admins a where a.id = n.created_by));
$$;
revoke all on function public.instinct_note_json(public.instinct_notes) from public, anon, authenticated;

-- RPCs ----------------------------------------------------------------------------------------------------------------------
create function public.instinct_context() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare c jsonb := public.instinct_require();
begin
  return c || jsonb_build_object(
    'can_ask', c->>'kind' <> 'instinct',
    'can_reply', c->>'kind' = 'instinct',
    'can_draft', c->>'kind' = 'instinct',
    'can_decide', (c->>'owner')::boolean,
    'sees_all_threads', c->>'kind' in ('owner', 'instinct'),
    'unread', (select count(*) from public.instinct_notifications where recipient_id = (c->>'id')::uuid and read_at is null));
end $$;

create function public.instinct_notes_list() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare c jsonb := public.instinct_require(); g text[];
begin
  if (c->>'owner')::boolean then
    return coalesce((select jsonb_agg(public.instinct_note_json(n) order by (n.status = 'published'), n.updated_at desc) from public.instinct_notes n), '[]'::jsonb);
  elsif c->>'kind' = 'instinct' then
    return coalesce((select jsonb_agg(public.instinct_note_json(n) order by (n.status = 'published'), n.updated_at desc) from public.instinct_notes n
                      where n.status = 'published' or n.created_by = (c->>'id')::uuid), '[]'::jsonb);
  end if;
  g := array(select jsonb_array_elements_text(c->'groups'));
  return coalesce((select jsonb_agg(public.instinct_note_json(n) order by n.published_at desc) from public.instinct_notes n
                    where n.status = 'published' and (n.target_role = 'all' or n.target_role = any(g))), '[]'::jsonb);
end $$;

-- Instinct creates (p_id null) or edits its own draft; the owner may edit any draft.
create function public.instinct_note_save(p_id uuid, p_title text, p_body text, p_target text) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare c jsonb := public.instinct_require(); me uuid := (c->>'id')::uuid; n public.instinct_notes; owner_id uuid := public.instinct_owner_id();
begin
  p_title := btrim(coalesce(p_title, '')); p_body := btrim(coalesce(p_body, '')); p_target := coalesce(nullif(btrim(p_target), ''), 'all');
  if char_length(p_title) < 3 or char_length(p_title) > 200 then raise exception 'عنوان الملاحظة لازم يكون من 3 لـ 200 حرف' using errcode = '22023'; end if;
  if char_length(p_body) < 3 or char_length(p_body) > 4000 then raise exception 'نص الملاحظة لازم يكون من 3 لـ 4000 حرف' using errcode = '22023'; end if;
  if p_target not in ('all', 'reception', 'customer_service', 'content', 'finance', 'management') then raise exception 'الفئة المستهدفة غير معروفة' using errcode = '22023'; end if;
  perform public.instinct_check_text(p_title || E'\n' || p_body);
  if p_id is null then
    if c->>'kind' <> 'instinct' then raise exception 'كتابة مسودات الملاحظات لمساعد إنستنكت بس' using errcode = '42501'; end if;
    insert into public.instinct_notes(title, body, target_role, created_by) values (p_title, p_body, p_target, me) returning * into n;
    perform public.instinct_audit(me, 'instinct', 'note_create', 'note', n.id, jsonb_build_object('title', n.title, 'body', n.body, 'target_role', n.target_role));
    perform public.instinct_notify(owner_id, 'new_draft', 'note', n.id, 'مسودة ملاحظة جديدة من مساعد إنستنكت: ' || n.title);
  else
    select * into n from public.instinct_notes where id = p_id for update;
    if n.id is null then raise exception 'الملاحظة مش موجودة' using errcode = 'P0002'; end if;
    if n.status <> 'draft' then raise exception 'الملاحظة دي اتعتمدت — مينفعش تتعدل' using errcode = '42501'; end if;
    if not ((c->>'owner')::boolean or (c->>'kind' = 'instinct' and n.created_by = me)) then
      raise exception 'تعديل المسودة لمساعد إنستنكت أو المالك بس' using errcode = '42501';
    end if;
    update public.instinct_notes set title = p_title, body = p_body, target_role = p_target, updated_at = now() where id = n.id returning * into n;
    perform public.instinct_audit(me, case when c->>'kind' = 'instinct' then 'instinct' else 'owner' end, 'note_edit', 'note', n.id,
      jsonb_build_object('title', n.title, 'body', n.body, 'target_role', n.target_role));
  end if;
  return public.instinct_note_json(n);
end $$;

-- ONLY the owner: approve (draft → approved) or publish (draft / approved → published).
create function public.instinct_note_decide(p_id uuid, p_action text) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare me uuid; n public.instinct_notes;
begin
  if not public.instinct_caller_is_owner() then raise exception 'الاعتماد والنشر للمالك بس' using errcode = '42501'; end if;
  me := public.instinct_owner_id();
  select * into n from public.instinct_notes where id = p_id for update;
  if n.id is null then raise exception 'الملاحظة مش موجودة' using errcode = 'P0002'; end if;
  if p_action = 'approve' then
    if n.status <> 'draft' then raise exception 'الملاحظة دي مش مسودة' using errcode = '22023'; end if;
    update public.instinct_notes set status = 'approved', approved_by = me, approved_at = now(), updated_at = now() where id = n.id returning * into n;
    perform public.instinct_audit(me, 'owner', 'note_approve', 'note', n.id, jsonb_build_object('title', n.title));
  elsif p_action = 'publish' then
    if n.status = 'published' then raise exception 'الملاحظة منشورة بالفعل' using errcode = '22023'; end if;
    update public.instinct_notes set status = 'published', approved_by = coalesce(approved_by, me), approved_at = coalesce(approved_at, now()),
      published_by = me, published_at = now(), updated_at = now() where id = n.id returning * into n;
    perform public.instinct_audit(me, 'owner', 'note_publish', 'note', n.id, jsonb_build_object('title', n.title, 'target_role', n.target_role));
  else
    raise exception 'إجراء غير معروف' using errcode = '22023';
  end if;
  return public.instinct_note_json(n);
end $$;

-- staff question: new thread (p_thread null) or a follow-up in one's own thread
create function public.instinct_ask(p_thread uuid, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare c jsonb := public.instinct_require(); me uuid := (c->>'id')::uuid; t public.instinct_threads; m public.instinct_messages;
  owner_id uuid := public.instinct_owner_id(); who text; r record;
begin
  if c->>'kind' = 'instinct' then raise exception 'مساعد إنستنكت بيرد على الأسئلة، مش بيسأل' using errcode = '42501'; end if;
  p_body := btrim(coalesce(p_body, ''));
  if char_length(p_body) < 2 or char_length(p_body) > 2000 then raise exception 'السؤال لازم يكون من 2 لـ 2000 حرف' using errcode = '22023'; end if;
  perform public.instinct_check_text(p_body);
  if p_thread is null then
    insert into public.instinct_threads(staff_id) values (me) returning * into t;
  else
    select * into t from public.instinct_threads where id = p_thread for update;
    if t.id is null or t.staff_id <> me then raise exception 'المحادثة دي مش بتاعتك' using errcode = '42501'; end if;
    update public.instinct_threads set last_message_at = now(), last_author_kind = 'staff' where id = t.id returning * into t;
  end if;
  insert into public.instinct_messages(thread_id, author_id, author_kind, body) values (t.id, me, 'staff', p_body) returning * into m;
  perform public.instinct_audit(me, case when (c->>'owner')::boolean then 'owner' else 'staff' end, 'question', 'thread', t.id,
    jsonb_build_object('message_id', m.id, 'body', m.body));
  select coalesce(name, 'موظف') into who from public.admins where id = me;
  if owner_id is distinct from me then perform public.instinct_notify(owner_id, 'new_question', 'thread', t.id, 'سؤال جديد لمساعد إنستنكت من ' || who); end if;
  for r in select id from public.admins where active and role = 'ai_assistant' loop
    perform public.instinct_notify(r.id, 'new_question', 'thread', t.id, 'سؤال جديد من ' || who);
  end loop;
  return jsonb_build_object('thread_id', t.id, 'message_id', m.id, 'created_at', m.created_at);
end $$;

-- Instinct replies in the same thread
create function public.instinct_reply(p_thread uuid, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare ai uuid := public.instinct_ai_id(); t public.instinct_threads; m public.instinct_messages;
begin
  if ai is null then raise exception 'الرد على الأسئلة لمساعد إنستنكت بس' using errcode = '42501'; end if;
  p_body := btrim(coalesce(p_body, ''));
  if char_length(p_body) < 2 or char_length(p_body) > 4000 then raise exception 'الرد لازم يكون من 2 لـ 4000 حرف' using errcode = '22023'; end if;
  perform public.instinct_check_text(p_body);
  select * into t from public.instinct_threads where id = p_thread for update;
  if t.id is null then raise exception 'المحادثة مش موجودة' using errcode = 'P0002'; end if;
  insert into public.instinct_messages(thread_id, author_id, author_kind, body) values (t.id, ai, 'instinct', p_body) returning * into m;
  update public.instinct_threads set last_message_at = m.created_at, last_author_kind = 'instinct' where id = t.id;
  perform public.instinct_audit(ai, 'instinct', 'reply', 'thread', t.id, jsonb_build_object('message_id', m.id, 'body', m.body));
  perform public.instinct_notify(t.staff_id, 'reply', 'thread', t.id, 'مساعد إنستنكت رد على سؤالك');
  return jsonb_build_object('thread_id', t.id, 'message_id', m.id, 'created_at', m.created_at);
end $$;

create function public.instinct_threads_list() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare c jsonb := public.instinct_require(); all_threads boolean := c->>'kind' in ('owner', 'instinct');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'staff_id', t.staff_id,
      'staff_name', (select coalesce(a.name, 'موظف') from public.admins a where a.id = t.staff_id),
      'created_at', t.created_at, 'last_message_at', t.last_message_at, 'answered', t.last_author_kind = 'instinct',
      'first_question', (select left(m.body, 160) from public.instinct_messages m where m.thread_id = t.id order by m.created_at limit 1),
      'messages', (select count(*) from public.instinct_messages m where m.thread_id = t.id)) order by t.last_message_at desc)
    from (select * from public.instinct_threads x where all_threads or x.staff_id = (c->>'id')::uuid order by x.last_message_at desc limit 200) t), '[]'::jsonb);
end $$;

create function public.instinct_thread(p_thread uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare c jsonb := public.instinct_require(); t public.instinct_threads;
begin
  select * into t from public.instinct_threads where id = p_thread;
  if t.id is null or not (c->>'kind' in ('owner', 'instinct') or t.staff_id = (c->>'id')::uuid) then
    raise exception 'المحادثة دي مش بتاعتك' using errcode = '42501';
  end if;
  return jsonb_build_object('id', t.id, 'staff_name', (select coalesce(a.name, 'موظف') from public.admins a where a.id = t.staff_id),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author_kind', m.author_kind, 'body', m.body, 'created_at', m.created_at)
      order by m.created_at) from public.instinct_messages m where m.thread_id = t.id), '[]'::jsonb));
end $$;

create function public.instinct_notifications_list() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare c jsonb := public.instinct_require();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'entity_type', n.entity_type, 'entity_id', n.entity_id,
      'message', n.message, 'created_at', n.created_at, 'read', n.read_at is not null) order by n.created_at desc)
    from (select * from public.instinct_notifications where recipient_id = (c->>'id')::uuid order by created_at desc limit 50) n), '[]'::jsonb);
end $$;

-- p_ids null = mark all of mine read
create function public.instinct_notifications_read(p_ids uuid[]) returns integer
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare c jsonb := public.instinct_require(); k integer;
begin
  update public.instinct_notifications set read_at = now()
   where recipient_id = (c->>'id')::uuid and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics k = row_count;
  return k;
end $$;

-- Phase 2 polling: everything new for the owner / Instinct since p_since
create function public.instinct_unread_since(p_since timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare c jsonb := public.instinct_require(); since timestamptz := coalesce(p_since, now() - interval '1 day');
begin
  if c->>'kind' not in ('owner', 'instinct') then raise exception 'للمالك ومساعد إنستنكت بس' using errcode = '42501'; end if;
  return jsonb_build_object('since', since, 'now', now(),
    'new_drafts', coalesce((select jsonb_agg(public.instinct_note_json(n) order by n.created_at) from public.instinct_notes n
                            where n.status = 'draft' and n.created_at > since), '[]'::jsonb),
    'status_changes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'status', n.status, 'at', n.updated_at) order by n.updated_at)
                            from public.instinct_notes n where n.status <> 'draft' and n.updated_at > since), '[]'::jsonb),
    'new_questions', coalesce((select jsonb_agg(jsonb_build_object('thread_id', m.thread_id, 'message_id', m.id, 'body', m.body, 'created_at', m.created_at,
                              'staff_name', (select coalesce(a.name, 'موظف') from public.admins a where a.id = m.author_id)) order by m.created_at)
                            from public.instinct_messages m where m.author_kind = 'staff' and m.created_at > since), '[]'::jsonb),
    'unread_notifications', (select count(*) from public.instinct_notifications where recipient_id = (c->>'id')::uuid and read_at is null));
end $$;

-- 8. hidden per-user description: owner + Instinct only. Generated, no free text, no contact data.
create function public.instinct_staff_profiles() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare c jsonb := public.instinct_require();
  labels constant jsonb := '{"page_manager":"مسؤول المحتوى","designer":"مصمم جرافيك","approver":"مسؤول اعتماد","general_manager":"مدير عام",
    "super_admin":"سوبر أدمن","reception":"استقبال","customer_service":"خدمة عملاء","nursing":"تمريض","head_nursing":"رئيس التمريض",
    "doctor_assistant":"مساعد طبيب","sono_doctor":"طبيب سونو","psychology_specialist":"أخصائي نفسية","contract_manager":"مسؤول التعاقدات",
    "accountant":"محاسب","financial_manager":"مدير مالي","digital_agent":"وكيل رقمي"}'::jsonb;
  flags constant jsonb := '{"has_archive_access":"أرشيف المرضى","has_archive_reception_access":"أرشيف المرضى (استقبال)",
    "has_archive_view_only":"أرشيف المرضى (عرض فقط)","has_archive_review_access":"اعتماد ملفات المرضى",
    "has_verification_management_access":"تحقق هوية المرضى","has_hr_access":"الموارد البشرية","has_price_lists_access":"لوائح الأسعار",
    "can_delete_leads":"حذف الليدز","can_approve_doctor_payouts":"اعتماد مستحقات الأطباء"}'::jsonb;
begin
  if c->>'kind' not in ('owner', 'instinct') then raise exception 'الوصف ده للمالك ومساعد إنستنكت بس' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(p order by p->>'name') from (
    select jsonb_build_object('admin_id', a.id, 'name', coalesce(a.name, 'موظف'), 'roles', r.roles, 'permissions', f.perms,
      'description', coalesce(a.name, 'موظف') || ' — الدور: ' || array_to_string(r.roles, '، ')
        || case when cardinality(f.perms) > 0 then ' — صلاحيات إضافية: ' || array_to_string(f.perms, '، ') else '' end) p
      from public.admins a
      cross join lateral (select array_agg(distinct coalesce(labels->>x.role, x.role)) roles from (
          select a.role union select e.role from public.admin_extra_roles e where e.admin_id = a.id) x) r
      cross join lateral (select coalesce(array_agg(coalesce(flags->>e.key, e.key) order by e.key), '{}'::text[]) perms
          from jsonb_each(to_jsonb(a)) e where (e.key like 'has\_%' or e.key like 'can\_%') and e.value = 'true'::jsonb) f
     where a.active and a.role not in ('ai_assistant', 'digital_agent')
       and not coalesce((to_jsonb(a)->>'is_system_identity')::boolean, false)) q), '[]'::jsonb);
end $$;

create function public.instinct_audit_list(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not public.instinct_caller_is_owner() then raise exception 'سجل التدقيق للمالك بس' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'actor_kind', l.actor_kind, 'action', l.action,
      'entity_type', l.entity_type, 'entity_id', l.entity_id, 'detail', l.detail,
      'actor_name', (select coalesce(a.name, 'مساعد إنستنكت') from public.admins a where a.id = l.actor_id)) order by l.id desc)
    from (select * from public.instinct_audit_log order by id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) l), '[]'::jsonb);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.instinct_context()', 'public.instinct_notes_list()', 'public.instinct_note_save(uuid,text,text,text)',
    'public.instinct_note_decide(uuid,text)', 'public.instinct_ask(uuid,text)', 'public.instinct_reply(uuid,text)', 'public.instinct_threads_list()',
    'public.instinct_thread(uuid)', 'public.instinct_notifications_list()', 'public.instinct_notifications_read(uuid[])',
    'public.instinct_unread_since(timestamptz)', 'public.instinct_staff_profiles()', 'public.instinct_audit_list(integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
