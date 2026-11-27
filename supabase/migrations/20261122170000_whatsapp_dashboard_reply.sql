-- WhatsApp replies from the dashboard (owner 2026-11-22: «عايز الرد على الواتساب من الداشبورد»).
-- The WhatsApp number is answered by the swnw-agent (Meta callback goes to the agent, not to the dashboard), so:
-- * The agent mirrors every WhatsApp turn (customer, bot, staff) to the whatsapp-sync edge function -> public.social_messages
--   (platform 'whatsapp', conversation_id 'whatsapp:<wa_id>'); bot_state says who is answering right now (ai | human).
-- * «إرسال» / a template / «رجّع للبوت» in the dashboard only QUEUES a row in ops_private.whatsapp_outbox (meta-comments, after
--   its staff-role check). The agent leases rows over its own outbound HTTPS (whatsapp-sync, shared secret), takes the
--   conversation over (so the bot stays silent), sends, and acks sent | failed | window_closed. No inbound port, no new secret.
-- * Free text only inside Meta's 24h window (checked here from the customer's last message, and again in the agent).
--   Outside it: an approved template without variables (list refreshed by the agent into ops_private.whatsapp_templates).
-- * Every function is SECURITY DEFINER, EXECUTE for service_role only (edge functions). Nothing new for anon/authenticated.
-- Rollback: supabase/rollbacks/20261122170000_whatsapp_dashboard_reply.rollback.sql
begin;

alter table public.social_messages add column if not exists bot_state text;
do $$ begin
  alter table public.social_messages add constraint social_messages_bot_state_chk check (bot_state is null or bot_state in ('ai', 'human'));
exception when duplicate_object then null; end $$;

create schema if not exists ops_private;
revoke all on schema ops_private from public, anon, authenticated;

create table if not exists ops_private.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('send', 'template', 'return')),
  conversation_id text not null,
  wa_id text not null check (wa_id ~ '^[0-9]{8,15}$'),
  text text check (text is null or char_length(text) between 1 and 4000),
  template_name text,
  template_language text,
  sent_by uuid references public.admins(id),
  status text not null default 'queued' check (status in ('queued', 'leased', 'sent', 'failed', 'window_closed')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  leased_at timestamptz,
  done_at timestamptz
);
create index if not exists whatsapp_outbox_status_idx on ops_private.whatsapp_outbox (status, created_at);
revoke all on ops_private.whatsapp_outbox from public, anon, authenticated;

create table if not exists ops_private.whatsapp_templates (
  name text not null,
  language text not null,
  category text,
  body text not null default '',
  synced_at timestamptz not null default now(),
  primary key (name, language)
);
revoke all on ops_private.whatsapp_templates from public, anon, authenticated;

-- Lazy clean-up: a lease older than 2 minutes goes back to the queue (3 tries); anything still open after 10 minutes failed
-- (a reply that late would surprise the customer and the staff member).
create or replace function ops_private.whatsapp_outbox_sweep() returns void
language plpgsql security definer set search_path = pg_catalog, ops_private as $$
begin
  update ops_private.whatsapp_outbox set status = 'failed', error = 'الوكيل ما ردّش خلال 10 دقايق — الرسالة ما اتبعتتش', done_at = now()
   where status in ('queued', 'leased') and created_at < now() - interval '10 minutes';
  update ops_private.whatsapp_outbox set status = case when attempts >= 3 then 'failed' else 'queued' end,
         error = case when attempts >= 3 then 'الوكيل ما أكّدش الإرسال' else error end,
         done_at = case when attempts >= 3 then now() end
   where status = 'leased' and leased_at < now() - interval '2 minutes';
end $$;

-- Dashboard (meta-comments, after its role check): queue one command. Returns {ok, id} or {ok:false, error, message}.
create or replace function public.whatsapp_outbox_enqueue(p_type text, p_conversation_id text, p_admin uuid,
  p_text text default null, p_template_name text default null, p_template_language text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, ops_private as $$
declare v_wa text; v_last timestamptz; v_text text := nullif(btrim(coalesce(p_text, '')), ''); v_id uuid;
begin
  perform ops_private.whatsapp_outbox_sweep();
  if p_type not in ('send', 'template', 'return') then return jsonb_build_object('ok', false, 'error', 'نوع غير معروف'); end if;
  if coalesce(p_conversation_id, '') !~ '^whatsapp:[0-9]{8,15}$' then return jsonb_build_object('ok', false, 'error', 'المحادثة مش واتساب'); end if;
  v_wa := substr(p_conversation_id, 10);
  select max(sent_at) into v_last from public.social_messages
   where conversation_id = p_conversation_id and platform = 'whatsapp' and not is_page;
  if v_last is null then return jsonb_build_object('ok', false, 'error', 'مفيش رسالة من العميل في المحادثة دي'); end if;
  if p_type = 'send' then
    if v_text is null then return jsonb_build_object('ok', false, 'error', 'اكتب الرسالة الأول'); end if;
    if char_length(v_text) > 4000 then return jsonb_build_object('ok', false, 'error', 'الرسالة طويلة — الحد 4000 حرف'); end if;
    if v_last < now() - interval '24 hours' then
      return jsonb_build_object('ok', false, 'error', 'WINDOW_CLOSED', 'message', 'عدّى 24 ساعة من آخر رسالة للعميل — ميتا مش بتسمح بالرد إلا بقالب معتمد');
    end if;
  elsif p_type = 'template' then
    if not exists (select 1 from ops_private.whatsapp_templates where name = p_template_name and language = p_template_language) then
      return jsonb_build_object('ok', false, 'error', 'القالب ده مش في قايمة القوالب المعتمدة');
    end if;
    v_text := null;
  else
    v_text := null;
  end if;
  if (select count(*) from ops_private.whatsapp_outbox where created_at > now() - interval '1 minute') >= 30 then
    return jsonb_build_object('ok', false, 'error', 'رسايل كتير في دقيقة — استنى شوية');
  end if;
  insert into ops_private.whatsapp_outbox (type, conversation_id, wa_id, text, template_name, template_language, sent_by)
  values (p_type, p_conversation_id, v_wa, v_text,
          case when p_type = 'template' then p_template_name end, case when p_type = 'template' then p_template_language end, p_admin)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Dashboard: what happened to a queued command (the composer waits for it).
create or replace function public.whatsapp_outbox_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, ops_private as $$
declare r ops_private.whatsapp_outbox;
begin
  perform ops_private.whatsapp_outbox_sweep();
  select * into r from ops_private.whatsapp_outbox where id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_strip_nulls(jsonb_build_object('status', r.status, 'error', r.error));
end $$;

-- Dashboard template picker (read-only).
create or replace function public.whatsapp_templates_list() returns jsonb
language sql stable security definer set search_path = pg_catalog, ops_private as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'language', language, 'category', category, 'text', body) order by name, language), '[]'::jsonb)
    from ops_private.whatsapp_templates
$$;

-- Agent (whatsapp-sync edge function): lease | ack | templates.
create or replace function public.whatsapp_outbox_api(p_action text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, ops_private as $$
declare v_id uuid; v_status text; v_out jsonb; r ops_private.whatsapp_outbox;
begin
  perform ops_private.whatsapp_outbox_sweep();
  if p_action = 'lease' then
    with picked as (
      select id from ops_private.whatsapp_outbox where status = 'queued' order by created_at
       limit least(greatest(coalesce((p_payload->>'limit')::int, 10), 1), 20) for update skip locked),
    upd as (
      update ops_private.whatsapp_outbox o set status = 'leased', leased_at = now(), attempts = attempts + 1
        from picked where o.id = picked.id
      returning o.id, o.type, o.wa_id, o.text, o.template_name, o.template_language, o.sent_by, o.created_at)
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'type', type, 'wa_id', wa_id, 'text', text,
             'template_name', template_name, 'template_language', template_language, 'sent_by', sent_by)) order by created_at), '[]'::jsonb)
      into v_out from upd;
    return jsonb_build_object('ok', true, 'commands', v_out);
  end if;

  if p_action = 'templates' then
    if jsonb_typeof(p_payload->'templates') <> 'array' then return jsonb_build_object('ok', false, 'reason', 'templates'); end if;
    delete from ops_private.whatsapp_templates;
    insert into ops_private.whatsapp_templates (name, language, category, body)
    select distinct on (left(t->>'name', 120), left(t->>'language', 20))
           left(t->>'name', 120), left(t->>'language', 20), left(t->>'category', 40), left(coalesce(t->>'text', ''), 1024)
      from jsonb_array_elements(p_payload->'templates') t
     where coalesce(t->>'name', '') <> '' and coalesce(t->>'language', '') <> '';
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'ack' then
    begin v_id := (p_payload->>'id')::uuid; exception when others then v_id := null; end;
    v_status := p_payload->>'status';
    if v_id is null or v_status not in ('sent', 'failed', 'window_closed') then return jsonb_build_object('ok', false, 'reason', 'id/status'); end if;
    update ops_private.whatsapp_outbox set status = v_status, error = left(p_payload->>'error', 300), done_at = now()
     where id = v_id and status = 'leased' returning * into r;
    if not found then return jsonb_build_object('ok', false, 'reason', 'not leased'); end if;
    if v_status = 'sent' then
      -- who answers this conversation now (the agent's own mirror carries it too; this makes the chip flip at once)
      update public.social_messages set bot_state = case when r.type = 'return' then 'ai' else 'human' end, updated_at = now()
       where id = (select id from public.social_messages where conversation_id = r.conversation_id order by sent_at desc nulls last limit 1);
    end if;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'action');
end $$;

revoke all on function ops_private.whatsapp_outbox_sweep() from public, anon, authenticated;
revoke all on function public.whatsapp_outbox_enqueue(text, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_outbox_get(uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_templates_list() from public, anon, authenticated;
revoke all on function public.whatsapp_outbox_api(text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_outbox_enqueue(text, text, uuid, text, text, text) to service_role;
grant execute on function public.whatsapp_outbox_get(uuid) to service_role;
grant execute on function public.whatsapp_templates_list() to service_role;
grant execute on function public.whatsapp_outbox_api(text, jsonb) to service_role;

commit;
