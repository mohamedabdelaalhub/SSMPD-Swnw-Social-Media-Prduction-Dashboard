-- The lead behind a chat (owner 2026-11-22): «عايز لما الموظف يتواصل مع المريض في الشات يبقي فيه اوبشن يظهرلي علي الشمال
-- انه اتعمله ليد وتفاصيل الليد وحالته ولما ادوس عليه يفتحلي الليد في الداشبورد».
-- Before this there was no direct link: WhatsApp leads match only by phone, Messenger/Instagram only when the bot's booking flow
-- made the lead (messenger_flow_state.lead_id). And the inbox roles (page_manager/approver) cannot read leads under leads RLS.
-- * social_conversation_leads: explicit chat -> lead link (one lead per conversation). No direct client access.
-- * social_conversation_lead(conv): limited summary for inbox staff (social_comments_access()): link -> bot flow -> ingest event
--   -> WhatsApp phone. can_open = the caller could open it in the leads module under the existing leads RLS.
-- * social_conversation_lead_create(conv, phone, service): creates the lead from the chat (or links the open duplicate by phone,
--   same 30-day rule as ingest_lead), auto-assigns customer service like leads-create, links it, returns the summary.
-- Rollback: supabase/rollbacks/20261122180000_social_conversation_leads.rollback.sql
begin;

create table if not exists public.social_conversation_leads (
  conversation_id text primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  linked_by uuid references public.admins(id),
  linked_at timestamptz not null default now()
);
create index if not exists social_conversation_leads_lead_idx on public.social_conversation_leads (lead_id);
alter table public.social_conversation_leads enable row level security;
revoke all on public.social_conversation_leads from public, anon, authenticated;

create or replace function public.social_conversation_lead_id(p_conversation_id text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid; v_plat text; v_phone text;
begin
  select lead_id into v from social_conversation_leads where conversation_id = p_conversation_id;
  if v is not null and exists (select 1 from leads where id = v) then return v; end if;
  if to_regclass('public.messenger_flow_state') is not null then
    execute 'select lead_id from public.messenger_flow_state where conversation_id = $1' into v using p_conversation_id;
    if v is not null and exists (select 1 from leads where id = v) then return v; end if;
  end if;
  if to_regclass('public.lead_ingest_events') is not null then
    execute 'select lead_id from public.lead_ingest_events where event_id like ''%:flow:'' || $1 order by 1 limit 1' into v using p_conversation_id;
    if v is not null and exists (select 1 from leads where id = v) then return v; end if;
  end if;
  if p_conversation_id ~ '^whatsapp:[0-9]{8,15}$' then
    v_phone := public.normalize_phone_eg(substr(p_conversation_id, 10));
    select id into v from leads where phone_normalized = v_phone order by created_at desc limit 1;
    return v;
  end if;
  return null;
end $$;

create or replace function public.social_conversation_lead_summary(p_lead uuid, p_conversation_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'name', l.customer_name,
    'phone', case when p_conversation_id like 'whatsapp:%' or public.is_super() or public.has_role('general_manager') then l.phone_normalized end,
    'source', l.source, 'status', l.current_status, 'acquisition', l.acquisition_type,
    'campaign', coalesce(nullif(l.utm_campaign, ''), l.meta_campaign_id),
    'assigned', (select coalesce(nullif(a.name, ''), 'موظف') from admins a where a.id = l.assigned_to),
    'created_at', l.created_at, 'updated_at', l.updated_at,
    'last_attempt', (select jsonb_build_object('at', t.attempt_date, 'result', t.result) from lead_attempts t where t.lead_id = l.id order by t.attempt_date desc limit 1),
    'linked', exists (select 1 from social_conversation_leads s where s.conversation_id = p_conversation_id and s.lead_id = l.id),
    'can_open', public.is_super() or public.has_role('general_manager') or public.has_role('reception')
                or (public.has_role('customer_service') and l.assigned_to = public.my_admin_id()))
  from leads l where l.id = p_lead
$$;

-- Inbox: the lead behind this conversation, or {"lead": null}.
create or replace function public.social_conversation_lead(p_conversation_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if not public.social_comments_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v := public.social_conversation_lead_id(p_conversation_id);
  return jsonb_build_object('lead', case when v is null then null else public.social_conversation_lead_summary(v, p_conversation_id) end);
end $$;

-- Inbox: «اعمل ليد» from the chat.
create or replace function public.social_conversation_lead_create(p_conversation_id text, p_phone text default null, p_service text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_last record; v_src text; v_phone_raw text; v_phone text; v_lead uuid; v_assign uuid; v_me uuid := public.my_admin_id(); v_found boolean := false;
  v_closed text[] := array['service_done', 'rejected', 'no_response', 'invalid_number'];
begin
  if not public.social_comments_access() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v_lead := public.social_conversation_lead_id(p_conversation_id);
  if v_lead is not null then
    insert into social_conversation_leads (conversation_id, lead_id, linked_by) values (p_conversation_id, v_lead, v_me)
    on conflict (conversation_id) do nothing;
    return jsonb_build_object('ok', true, 'existing', true, 'lead', public.social_conversation_lead_summary(v_lead, p_conversation_id));
  end if;
  select platform, sender_name, message, conversation_url into v_last from social_messages
   where conversation_id = p_conversation_id and not is_page order by sent_at desc nulls last limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'المحادثة مش موجودة'); end if;
  v_src := case v_last.platform when 'facebook' then 'messenger' when 'instagram' then 'instagram' when 'whatsapp' then 'whatsapp' end;
  if v_src is null then return jsonb_build_object('ok', false, 'error', 'المنصة دي مش مدعومة'); end if;
  if p_service is not null and p_service not in ('checkup','consultation','radiology','lab','nursing','physiotherapy','treatment','dental','speech_therapy','psychiatry','cosmetic_laser','emergency','other') then
    return jsonb_build_object('ok', false, 'error', 'الخدمة مش معروفة');
  end if;
  v_phone_raw := nullif(btrim(coalesce(p_phone, '')), '');
  if v_phone_raw is null and v_src = 'whatsapp' then v_phone_raw := '+' || substr(p_conversation_id, 10); end if;
  if v_phone_raw is not null and length(regexp_replace(translate(v_phone_raw, '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'رقم التليفون ناقص');
  end if;
  v_phone_raw := translate(v_phone_raw, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  v_phone := public.normalize_phone_eg(v_phone_raw);
  -- open lead with the same phone in the last 30 days: link it instead of a duplicate (same rule as ingest_lead)
  if v_phone is not null then
    select id into v_lead from leads where phone_normalized = v_phone and not (current_status = any (v_closed))
       and coalesce(received_at, created_at) > now() - interval '30 days' order by created_at desc limit 1;
  end if;
  v_found := v_lead is not null;
  if v_lead is null then
    select a.id into v_assign from admins a
     where a.active and (a.role = 'customer_service' or exists (select 1 from admin_extra_roles x where x.admin_id = a.id and x.role = 'customer_service'))
     order by (select count(*) from leads l where l.assigned_to = a.id and not (l.current_status = any (v_closed))), a.created_at limit 1;
    insert into leads (customer_name, phone_raw, phone_normalized, source, message_text, received_at, received_by, interested_service, assigned_to, current_status, acquisition_type)
    values (coalesce(nullif(btrim(v_last.sender_name), ''), 'عميل جديد'), v_phone_raw, v_phone, v_src,
            left(coalesce(v_last.message, '') || coalesce(E'\n\nالمحادثة: ' || v_last.conversation_url, ''), 1000), now(), v_me, p_service, v_assign,
            case when v_phone is null then 'missing_data' else 'new' end, 'organic')
    returning id into v_lead;
  end if;
  insert into social_conversation_leads (conversation_id, lead_id, linked_by) values (p_conversation_id, v_lead, v_me)
  on conflict (conversation_id) do update set lead_id = excluded.lead_id, linked_by = excluded.linked_by, linked_at = now();
  return jsonb_build_object('ok', true, 'existing', v_found, 'lead', public.social_conversation_lead_summary(v_lead, p_conversation_id));
end $$;

revoke all on function public.social_conversation_lead_id(text) from public, anon, authenticated;
revoke all on function public.social_conversation_lead_summary(uuid, text) from public, anon, authenticated;
revoke all on function public.social_conversation_lead(text) from public, anon;
revoke all on function public.social_conversation_lead_create(text, text, text) from public, anon;
grant execute on function public.social_conversation_lead(text) to authenticated;
grant execute on function public.social_conversation_lead_create(text, text, text) to authenticated;

commit;
