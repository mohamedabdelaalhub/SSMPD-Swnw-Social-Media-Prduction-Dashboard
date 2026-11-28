-- «اسأل المساعد» — phase 1 server (owner approved the UX5 mockup docs/ui-references/mockups/assistant-chat.html, 2026-11-28).
-- The assistant EXPLAINS («أعمل إزاي») and OPENS REQUESTS; it never edits data or moves money.
--   staff_assistant.requests        one row per staff request (from the chat), with the owner's decision and status
--   staff_assistant.request_events  timeline (اتفتح / اتوافق / بيتنفذ / نزل …) — who and when, no patient data
--   staff_assistant.settings        enabled + monthly budget (USD) → daily question cap
--   staff_assistant.usage_daily     questions + tokens + estimated cost per day (NO question or answer text, ever)
--   bucket 'assistant-shots'        private screenshots: own folder <admin id>/…; read by the folder owner or super_admin.
--                                   Phase 1: the image is stored with the request only — never sent to the model.
-- RPCs (public, the user's JWT):
--   staff:        staff_assistant_request_create / _my_requests / _request_seen / _request_reply
--   super_admin:  staff_assistant_all_requests / _decide / _set_status / _annotate / _settings
--   edge function assistant-answer: staff_assistant_usage_take (as the user: reserves one question under the cap) and
--                                   staff_assistant_usage_record (service role only: adds tokens / cost to today's row)
-- Notifications: rows in the existing public.staff_notifications (new kind 'assistant_request' + request_id column).
-- Context is redacted on the server too (names / phones dropped, phone-like digit runs masked, file_no kept).
-- Rollback: supabase/rollbacks/20261128200000_staff_assistant.rollback.sql
begin;

do $$ begin
  if to_regclass('staff_assistant.requests') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('public.my_admin_id()') is null or to_regprocedure('public.has_role(text)') is null then
    raise exception 'my_admin_id / has_role غير موجودة'; end if;
end $$;

create schema staff_assistant;
revoke all on schema staff_assistant from public, anon, authenticated;

create table staff_assistant.requests(
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity unique,
  admin_id uuid not null references public.admins(id),
  screen text not null default '' check (char_length(screen) <= 200),
  text text not null check (char_length(btrim(text)) between 3 and 2000),
  image_path text check (image_path is null or char_length(image_path) <= 300),
  context jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'need_info', 'approved', 'rejected', 'in_progress', 'shipped')),
  category text check (category is null or category in ('data_fix', 'improvement', 'question', 'bug')),
  proposal text check (proposal is null or char_length(proposal) <= 2000),
  impact text check (impact is null or char_length(impact) <= 500),
  touches_money boolean,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  status_note text check (status_note is null or char_length(status_note) <= 1000),
  staff_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_admin_idx on staff_assistant.requests(admin_id, updated_at desc);
create index requests_status_idx on staff_assistant.requests(status, updated_at desc);

create table staff_assistant.request_events(
  id bigint generated always as identity primary key,
  request_id uuid not null references staff_assistant.requests(id) on delete cascade,
  status text not null,
  note text,
  by_admin uuid references public.admins(id),
  at timestamptz not null default now()
);
create index request_events_req_idx on staff_assistant.request_events(request_id, at);

create table staff_assistant.settings(
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  monthly_budget_usd numeric(10, 2) not null default 20 check (monthly_budget_usd >= 0),
  est_cost_per_question_usd numeric(10, 5) not null default 0.0015 check (est_cost_per_question_usd > 0),
  updated_by uuid references public.admins(id),
  updated_at timestamptz not null default now()
);
insert into staff_assistant.settings(id) values (true);

create table staff_assistant.usage_daily(
  day date primary key,
  questions integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  refused integer not null default 0
);

alter table staff_assistant.requests enable row level security;
alter table staff_assistant.request_events enable row level security;
alter table staff_assistant.settings enable row level security;
alter table staff_assistant.usage_daily enable row level security;
revoke all on all tables in schema staff_assistant from public, anon, authenticated;

-- notifications: reuse public.staff_notifications (the employee reads only their own rows — existing RLS)
alter table public.staff_notifications add column if not exists request_id uuid;
do $$ declare k text; begin
  select pg_get_constraintdef(c.oid) into k from pg_constraint c
   where c.conrelid = 'public.staff_notifications'::regclass and c.conname = 'staff_notifications_kind_check';
  if k is not null and k not like '%assistant_request%' then
    execute 'alter table public.staff_notifications drop constraint staff_notifications_kind_check';
    execute 'alter table public.staff_notifications add constraint staff_notifications_kind_check '
         || replace(k, '])', ', ''assistant_request''::text])');
  end if;
end $$;

-- ---------------------------------------------------------------- helpers
create function staff_assistant.today() returns date language sql stable set search_path = pg_catalog as $$
  select (now() at time zone 'Africa/Cairo')::date $$;

-- context sent with a request / a question: patient names and phones never leave as text; file_no stays
create function staff_assistant.redact(p jsonb) returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare k text; v jsonb; out jsonb;
begin
  if p is null then return '{}'::jsonb; end if;
  if jsonb_typeof(p) = 'object' then
    out := '{}'::jsonb;
    for k, v in select * from jsonb_each(p) loop
      if k <> 'file_no' and lower(k) ~ '(name|phone|mobile|tel|whatsapp|national|address|email)' then continue; end if;
      out := out || jsonb_build_object(k, case when k = 'file_no' then to_jsonb(left(v #>> '{}', 40)) else staff_assistant.redact(v) end);
    end loop;
    return out;
  elsif jsonb_typeof(p) = 'array' then
    return coalesce((select jsonb_agg(staff_assistant.redact(x)) from jsonb_array_elements(p) x), '[]'::jsonb);
  elsif jsonb_typeof(p) = 'string' then
    return to_jsonb(left(regexp_replace(p #>> '{}', '[0-9٠-٩+][0-9٠-٩ -]{6,}[0-9٠-٩]', '•••', 'g'), 500));
  end if;
  return p;
end $$;

create function staff_assistant.is_owner() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.has_role('super_admin') $$;

create function staff_assistant.event(p_req uuid, p_status text, p_note text) returns void language sql security definer
set search_path = pg_catalog, public as $$
  insert into staff_assistant.request_events(request_id, status, note, by_admin) values (p_req, p_status, left(p_note, 1000), public.my_admin_id()) $$;

create function staff_assistant.status_label(p text) returns text language sql immutable set search_path = pg_catalog as $$
  select case p when 'new' then 'اتفتح' when 'need_info' then 'محتاج توضيح منك' when 'approved' then 'اتوافق'
    when 'rejected' then 'اترفض' when 'in_progress' then 'بيتنفذ' when 'shipped' then 'نزل' else p end $$;

create function staff_assistant.notify(r staff_assistant.requests) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  insert into public.staff_notifications(recipient_admin_id, kind, title, request_id)
  values (r.admin_id, 'assistant_request', left('طلب ' || r.number || ': ' || staff_assistant.status_label(r.status)
    || case when coalesce(r.status_note, r.decision_note, '') <> '' then ' — ' || coalesce(nullif(r.status_note, ''), r.decision_note) else '' end, 200), r.id);
end $$;

create function staff_assistant.row_json(r staff_assistant.requests, p_owner boolean) returns jsonb language sql stable security definer
set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', r.id, 'number', r.number, 'screen', r.screen, 'text', r.text, 'status', r.status,
      'decision_note', r.decision_note, 'status_note', r.status_note, 'created_at', r.created_at, 'updated_at', r.updated_at,
      'unseen', r.staff_seen_at is null or r.staff_seen_at < r.updated_at,
      'timeline', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at) order by e.at) from staff_assistant.request_events e where e.request_id = r.id), '[]'::jsonb))
    || case when p_owner then jsonb_build_object('image_path', r.image_path, 'category', r.category, 'proposal', r.proposal, 'impact', r.impact,
         'touches_money', r.touches_money, 'context', r.context,
         'staff_name', (select coalesce(to_jsonb(a)->>'name', to_jsonb(a)->>'email') from public.admins a where a.id = r.admin_id),
         'staff_role', (select a.role from public.admins a where a.id = r.admin_id)) else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------- staff
create function public.staff_assistant_request_create(p_screen text, p_text text, p_image_path text default null, p_context jsonb default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); r staff_assistant.requests;
begin
  if me is null or not exists (select 1 from public.admins where id = me and active) then raise exception 'سجّل دخول الأول'; end if;
  if char_length(btrim(coalesce(p_text, ''))) < 3 then raise exception 'اكتب المشكلة أو الطلب'; end if;
  if char_length(p_text) > 2000 then raise exception 'الطلب طويل — اختصره (2000 حرف)'; end if;
  if nullif(p_image_path, '') is not null and split_part(p_image_path, '/', 1) <> me::text then raise exception 'الصورة لازم تكون من فولدرك'; end if;
  if (select count(*) from staff_assistant.requests where admin_id = me and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'طلبات كتير في ساعة — استنى شوية'; end if;
  insert into staff_assistant.requests(admin_id, screen, text, image_path, context)
  values (me, left(coalesce(p_screen, ''), 200), btrim(p_text), nullif(p_image_path, ''), staff_assistant.redact(coalesce(p_context, '{}'::jsonb)))
  returning * into r;
  perform staff_assistant.event(r.id, 'new', null);
  update staff_assistant.requests set staff_seen_at = now() where id = r.id;
  return jsonb_build_object('id', r.id, 'number', r.number, 'status', r.status);
end $$;

create function public.staff_assistant_my_requests() returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(staff_assistant.row_json(r, false) order by r.updated_at desc), '[]'::jsonb)
    from (select * from staff_assistant.requests where admin_id = public.my_admin_id() order by updated_at desc limit 100) r
$$;

create function public.staff_assistant_request_seen(p_id uuid) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update staff_assistant.requests set staff_seen_at = now() where id = p_id and admin_id = public.my_admin_id();
  if not found then raise exception 'الطلب مش موجود'; end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.staff_assistant_request_reply(p_id uuid, p_text text) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r staff_assistant.requests;
begin
  select * into r from staff_assistant.requests where id = p_id and admin_id = public.my_admin_id() for update;
  if not found then raise exception 'الطلب مش موجود'; end if;
  if r.status <> 'need_info' then raise exception 'الطلب ده مش مستني توضيح'; end if;
  if char_length(btrim(coalesce(p_text, ''))) < 2 then raise exception 'اكتب التوضيح'; end if;
  update staff_assistant.requests set status = 'new', text = left(text || E'\n— توضيح: ' || btrim(p_text), 2000), updated_at = now(), staff_seen_at = now() where id = p_id;
  perform staff_assistant.event(p_id, 'new', left(btrim(p_text), 1000));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- owner (super_admin)
create function public.staff_assistant_all_requests(p_day date default null) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare t date := staff_assistant.today();
begin
  if not staff_assistant.is_owner() then raise exception 'للمالك بس'; end if;
  return jsonb_build_object(
    'summary', jsonb_build_object(
      'new_today', (select count(*) from staff_assistant.requests where (created_at at time zone 'Africa/Cairo')::date = t),
      'waiting', (select count(*) from staff_assistant.requests where status in ('new', 'need_info')),
      'in_progress', (select count(*) from staff_assistant.requests where status in ('approved', 'in_progress')),
      'shipped', (select count(*) from staff_assistant.requests where status = 'shipped')),
    'requests', coalesce((select jsonb_agg(staff_assistant.row_json(r, true) order by (r.status in ('new', 'need_info')) desc, r.updated_at desc)
      from staff_assistant.requests r
      where case when p_day is not null then (r.created_at at time zone 'Africa/Cairo')::date = p_day
                 else r.status not in ('shipped', 'rejected') or r.updated_at > now() - interval '7 days' end), '[]'::jsonb));
end $$;

create function public.staff_assistant_decide(p_id uuid, p_decision text, p_note text default null) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r staff_assistant.requests; st text;
begin
  if not staff_assistant.is_owner() then raise exception 'للمالك بس'; end if;
  st := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' when 'need_info' then 'need_info' end;
  if st is null then raise exception 'القرار: موافق / لأ / محتاج توضيح'; end if;
  if st in ('rejected', 'need_info') and char_length(btrim(coalesce(p_note, ''))) < 2 then raise exception 'اكتب السبب أو السؤال للموظف'; end if;
  select * into r from staff_assistant.requests where id = p_id for update;
  if not found then raise exception 'الطلب مش موجود'; end if;
  if r.status not in ('new', 'need_info') then raise exception 'الطلب ده اتاخد فيه قرار قبل كده'; end if;
  update staff_assistant.requests set status = st, decision_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = p_id returning * into r;
  perform staff_assistant.event(p_id, st, p_note);
  perform staff_assistant.notify(r);
  return jsonb_build_object('ok', true, 'status', r.status);
end $$;

create function public.staff_assistant_set_status(p_id uuid, p_status text, p_note text default null) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r staff_assistant.requests;
begin
  if not staff_assistant.is_owner() then raise exception 'للمالك بس'; end if;
  if p_status not in ('in_progress', 'shipped') then raise exception 'الحالة: بيتنفذ / نزل'; end if;
  select * into r from staff_assistant.requests where id = p_id for update;
  if not found then raise exception 'الطلب مش موجود'; end if;
  if not (r.status = 'approved' or (r.status = 'in_progress' and p_status = 'shipped')) then raise exception 'لازم الطلب يتوافق عليه الأول'; end if;
  update staff_assistant.requests set status = p_status, status_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), status_note), updated_at = now() where id = p_id returning * into r;
  perform staff_assistant.event(p_id, p_status, p_note);
  perform staff_assistant.notify(r);
  return jsonb_build_object('ok', true, 'status', r.status);
end $$;

create function public.staff_assistant_annotate(p_id uuid, p_payload jsonb) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not staff_assistant.is_owner() then raise exception 'للمالك بس'; end if;
  if p_payload ? 'category' and nullif(p_payload->>'category', '') is not null and p_payload->>'category' not in ('data_fix', 'improvement', 'question', 'bug') then
    raise exception 'النوع: data_fix / improvement / question / bug'; end if;
  update staff_assistant.requests set
    category = case when p_payload ? 'category' then nullif(p_payload->>'category', '') else category end,
    proposal = case when p_payload ? 'proposal' then left(nullif(btrim(p_payload->>'proposal'), ''), 2000) else proposal end,
    impact = case when p_payload ? 'impact' then left(nullif(btrim(p_payload->>'impact'), ''), 500) else impact end,
    touches_money = case when p_payload ? 'touches_money' then (p_payload->>'touches_money')::boolean else touches_money end
  where id = p_id;
  if not found then raise exception 'الطلب مش موجود'; end if;
  return jsonb_build_object('ok', true);
end $$;

create function staff_assistant.daily_cap() returns integer language sql stable security definer set search_path = pg_catalog, public as $$
  select floor(s.monthly_budget_usd / 30 / s.est_cost_per_question_usd)::int from staff_assistant.settings s $$;

create function public.staff_assistant_settings(p_action text default 'get', p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare s staff_assistant.settings; u staff_assistant.usage_daily;
begin
  if not staff_assistant.is_owner() then raise exception 'للمالك بس'; end if;
  if p_action = 'set' then
    update staff_assistant.settings set
      enabled = coalesce((p_payload->>'enabled')::boolean, enabled),
      monthly_budget_usd = coalesce(nullif(p_payload->>'monthly_budget_usd', '')::numeric, monthly_budget_usd),
      updated_by = public.my_admin_id(), updated_at = now();
  elsif p_action <> 'get' then raise exception 'get / set';
  end if;
  select * into s from staff_assistant.settings;
  select * into u from staff_assistant.usage_daily where day = staff_assistant.today();
  return jsonb_build_object('enabled', s.enabled, 'monthly_budget_usd', s.monthly_budget_usd, 'daily_cap', staff_assistant.daily_cap(),
    'today', jsonb_build_object('questions', coalesce(u.questions, 0), 'cost_usd', coalesce(u.cost_usd, 0), 'refused', coalesce(u.refused, 0)));
end $$;

-- ---------------------------------------------------------------- edge function assistant-answer
-- as the asking user: is the assistant on, is today under the cap? reserves one question atomically. No text stored.
create function public.staff_assistant_usage_take() returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); s staff_assistant.settings; u staff_assistant.usage_daily; t date := staff_assistant.today(); cap int;
begin
  if me is null or not exists (select 1 from public.admins where id = me and active) then raise exception 'سجّل دخول الأول'; end if;
  select * into s from staff_assistant.settings;
  insert into staff_assistant.usage_daily(day) values (t) on conflict (day) do nothing;
  select * into u from staff_assistant.usage_daily where day = t for update;
  cap := staff_assistant.daily_cap();
  if not s.enabled then
    update staff_assistant.usage_daily set refused = refused + 1 where day = t;
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if u.questions >= cap or u.cost_usd >= s.monthly_budget_usd / 30 then
    update staff_assistant.usage_daily set refused = refused + 1 where day = t;
    return jsonb_build_object('ok', false, 'reason', 'cap');
  end if;
  update staff_assistant.usage_daily set questions = questions + 1 where day = t;
  return jsonb_build_object('ok', true, 'remaining', cap - u.questions - 1,
    'role', (select role from public.admins where id = me),
    'roles', coalesce((select jsonb_agg(r.role) from public.admin_extra_roles r where r.admin_id = me), '[]'::jsonb));
end $$;

-- service role only: tokens + estimated cost (Haiku 5.5 list prices per MTok: in 0.10, out 0.50, cache read 0.01, cache write 0.125)
create function public.staff_assistant_usage_record(p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint)
returns void language sql security definer set search_path = pg_catalog, public as $$
  insert into staff_assistant.usage_daily(day, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
  values (staff_assistant.today(), greatest(p_input, 0), greatest(p_output, 0), greatest(p_cache_read, 0), greatest(p_cache_write, 0),
          (greatest(p_input, 0) * 0.10 + greatest(p_output, 0) * 0.50 + greatest(p_cache_read, 0) * 0.01 + greatest(p_cache_write, 0) * 0.125) / 1000000.0)
  on conflict (day) do update set
    input_tokens = staff_assistant.usage_daily.input_tokens + excluded.input_tokens,
    output_tokens = staff_assistant.usage_daily.output_tokens + excluded.output_tokens,
    cache_read_tokens = staff_assistant.usage_daily.cache_read_tokens + excluded.cache_read_tokens,
    cache_write_tokens = staff_assistant.usage_daily.cache_write_tokens + excluded.cache_write_tokens,
    cost_usd = staff_assistant.usage_daily.cost_usd + excluded.cost_usd
$$;

-- ---------------------------------------------------------------- private screenshots bucket
create function public.assistant_shot_allowed(p_name text, p_write boolean) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select case when p_write then split_part(p_name, '/', 1) = public.my_admin_id()::text
              else split_part(p_name, '/', 1) = public.my_admin_id()::text or public.has_role('super_admin') end $$;
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('assistant-shots', 'assistant-shots', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute 'drop policy if exists assistant_shots_insert on storage.objects';
    execute 'drop policy if exists assistant_shots_select on storage.objects';
    execute 'create policy assistant_shots_insert on storage.objects for insert to authenticated with check (bucket_id = ''assistant-shots'' and public.assistant_shot_allowed(name, true))';
    execute 'create policy assistant_shots_select on storage.objects for select to authenticated using (bucket_id = ''assistant-shots'' and public.assistant_shot_allowed(name, false))';
  end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on all functions in schema staff_assistant from public, anon, authenticated;
revoke all on function public.staff_assistant_request_create(text, text, text, jsonb), public.staff_assistant_my_requests(),
  public.staff_assistant_request_seen(uuid), public.staff_assistant_request_reply(uuid, text), public.staff_assistant_all_requests(date),
  public.staff_assistant_decide(uuid, text, text), public.staff_assistant_set_status(uuid, text, text), public.staff_assistant_annotate(uuid, jsonb),
  public.staff_assistant_settings(text, jsonb), public.staff_assistant_usage_take(), public.staff_assistant_usage_record(bigint, bigint, bigint, bigint),
  public.assistant_shot_allowed(text, boolean) from public, anon;
grant execute on function public.staff_assistant_request_create(text, text, text, jsonb), public.staff_assistant_my_requests(),
  public.staff_assistant_request_seen(uuid), public.staff_assistant_request_reply(uuid, text), public.staff_assistant_all_requests(date),
  public.staff_assistant_decide(uuid, text, text), public.staff_assistant_set_status(uuid, text, text), public.staff_assistant_annotate(uuid, jsonb),
  public.staff_assistant_settings(text, jsonb), public.staff_assistant_usage_take(), public.assistant_shot_allowed(text, boolean) to authenticated;
revoke all on function public.staff_assistant_usage_record(bigint, bigint, bigint, bigint) from authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.staff_assistant_usage_record(bigint, bigint, bigint, bigint) to service_role';
  end if;
end $$;

commit;
