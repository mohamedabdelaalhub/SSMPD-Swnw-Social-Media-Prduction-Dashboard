-- WhatsApp templates created from the dashboard (owner 2026-11-24: «زرار أضيف بيه قوالب واتساب بسهولة»).
-- Same no-new-secret pattern as the outbox (20261122170000): the dashboard only QUEUES a request; the swnw WhatsApp agent
-- (which holds the WhatsApp token) leases it, POSTs /{waba_id}/message_templates, acks, and later reports Meta's review
-- status. Owner/super_admin only (checked here and in meta-comments). Parameter-free templates only (v1).
-- Every function is SECURITY DEFINER, EXECUTE for service_role only. Nothing for anon/authenticated.
-- Rollback: supabase/rollbacks/20261124230000_whatsapp_template_requests.rollback.sql
begin;

create schema if not exists ops_private;
revoke all on schema ops_private from public, anon, authenticated;

create table if not exists ops_private.whatsapp_template_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '^[a-z][a-z0-9_]{2,100}$'),
  language text not null default 'ar' check (language in ('ar', 'ar_EG')),
  category text not null check (category in ('UTILITY', 'MARKETING')),
  body text not null check (char_length(body) between 10 and 1024),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'LEASED', 'PENDING', 'APPROVED', 'REJECTED', 'FAILED')),
  meta_template_id text,
  reason text,
  attempts int not null default 0,
  submitted_by uuid not null references public.admins(id),
  submitted_at timestamptz not null default now(),
  leased_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (name, language)
);
revoke all on ops_private.whatsapp_template_requests from public, anon, authenticated;

-- Audit trail: who asked for what and when, and what happened to it.
create table if not exists ops_private.whatsapp_template_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  request_id uuid,
  admin_id uuid,
  event text not null,
  detail text
);
revoke all on ops_private.whatsapp_template_audit from public, anon, authenticated;

create or replace function ops_private.whatsapp_template_sweep() returns void
language plpgsql security definer set search_path = pg_catalog, ops_private as $$
begin
  update ops_private.whatsapp_template_requests set status = 'FAILED', reason = 'الوكيل ما ردّش خلال 10 دقايق — ما اتقدّمش لميتا', updated_at = now()
   where status in ('QUEUED', 'LEASED') and submitted_at < now() - interval '10 minutes';
  update ops_private.whatsapp_template_requests set status = case when attempts >= 3 then 'FAILED' else 'QUEUED' end,
         reason = case when attempts >= 3 then 'الوكيل ما أكّدش التقديم' else reason end, updated_at = now()
   where status = 'LEASED' and leased_at < now() - interval '2 minutes';
end $$;

-- Dashboard (meta-comments, after its super_admin check): queue one template. Returns {ok, id, name} or {ok:false, error}.
create or replace function public.whatsapp_template_submit(p_admin uuid, p_category text, p_body text, p_slug text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, ops_private as $$
declare v_body text := btrim(coalesce(p_body, '')); v_name text; v_id uuid; v_digits text; v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
begin
  perform ops_private.whatsapp_template_sweep();
  if not exists (select 1 from public.admins a where a.id = p_admin and a.active
                  and (a.role = 'super_admin' or exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role = 'super_admin'))) then
    return jsonb_build_object('ok', false, 'error', 'تقديم القوالب للمالك بس');
  end if;
  if p_category not in ('UTILITY', 'MARKETING') then return jsonb_build_object('ok', false, 'error', 'اختار نوع القالب: خدمي أو تسويقي'); end if;
  if char_length(v_body) < 10 then return jsonb_build_object('ok', false, 'error', 'نص القالب قصير — اكتب جملة كاملة'); end if;
  if char_length(v_body) > 1024 then return jsonb_build_object('ok', false, 'error', 'نص القالب طويل — الحد 1024 حرف'); end if;
  if v_body like '%{{%' or v_body like '%}}%' then return jsonb_build_object('ok', false, 'error', 'القوالب من غير متغيرات {{ }} في الإصدار ده'); end if;
  -- no phone numbers / file numbers: any run of 8+ digits once separators are removed (Arabic-Indic digits included)
  v_digits := regexp_replace(translate(v_body, '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[\s\-\.\(\)\+/]', '', 'g');
  if v_digits ~ '[0-9]{8,}' then return jsonb_build_object('ok', false, 'error', 'ممنوع أرقام تليفون أو أرقام ملفات في القالب'); end if;
  if exists (select 1 from ops_private.whatsapp_template_requests r where r.body = v_body and r.status in ('QUEUED', 'LEASED', 'PENDING', 'APPROVED')) then
    return jsonb_build_object('ok', false, 'error', 'القالب ده متقدّم قبل كده');
  end if;
  if (select count(*) from ops_private.whatsapp_template_requests where submitted_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'قوالب كتير في ساعة — استنى شوية');
  end if;
  if v_slug is not null and v_slug !~ '^[a-z0-9_]{3,40}$' then v_slug := null; end if;
  v_name := 'sono_' || coalesce(v_slug, lower(left(p_category, 3)) || '_' || to_char(now(), 'YYMMDD') || '_' || substr(md5(v_body || clock_timestamp()::text), 1, 4)) || '_ar';
  begin
    insert into ops_private.whatsapp_template_requests (name, language, category, body, submitted_by)
    values (v_name, 'ar', p_category, v_body, p_admin) returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'الاسم ده مستخدم — جرّب تاني');
  end;
  insert into ops_private.whatsapp_template_audit (request_id, admin_id, event, detail) values (v_id, p_admin, 'submitted', v_name || ' / ' || p_category);
  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_name);
end $$;

-- Dashboard: requests with their review status (newest first).
create or replace function public.whatsapp_template_requests_list() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, ops_private as $$
begin
  perform ops_private.whatsapp_template_sweep();
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', r.id, 'name', r.name, 'language', r.language, 'category', r.category,
           'text', r.body, 'status', r.status, 'reason', r.reason, 'submitted_by', a.name, 'submitted_at', r.submitted_at)) order by r.submitted_at desc)
      from (select * from ops_private.whatsapp_template_requests order by submitted_at desc limit 50) r
      left join public.admins a on a.id = r.submitted_by), '[]'::jsonb);
end $$;

-- Agent (whatsapp-sync edge function): lease | ack | sync.
create or replace function public.whatsapp_template_api(p_action text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, ops_private as $$
declare v_id uuid; v_status text; v_out jsonb; r ops_private.whatsapp_template_requests; s jsonb; v_new text; v_reason text;
begin
  perform ops_private.whatsapp_template_sweep();
  if p_action = 'lease' then
    with picked as (
      select id from ops_private.whatsapp_template_requests where status = 'QUEUED' order by submitted_at
       limit least(greatest(coalesce((p_payload->>'limit')::int, 5), 1), 10) for update skip locked),
    upd as (
      update ops_private.whatsapp_template_requests t set status = 'LEASED', leased_at = now(), attempts = attempts + 1, updated_at = now()
        from picked where t.id = picked.id
      returning t.id, t.name, t.language, t.category, t.body, t.submitted_at)
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'language', language, 'category', category, 'text', body) order by submitted_at), '[]'::jsonb)
      into v_out from upd;
    return jsonb_build_object('ok', true, 'requests', v_out);
  end if;

  if p_action = 'ack' then
    begin v_id := (p_payload->>'id')::uuid; exception when others then v_id := null; end;
    v_status := p_payload->>'status';
    if v_id is null or v_status not in ('PENDING', 'APPROVED', 'REJECTED', 'FAILED') then return jsonb_build_object('ok', false, 'reason', 'id/status'); end if;
    update ops_private.whatsapp_template_requests
       set status = v_status, meta_template_id = left(p_payload->>'meta_id', 80), reason = left(p_payload->>'error', 300), updated_at = now()
     where id = v_id and status = 'LEASED' returning * into r;
    if not found then return jsonb_build_object('ok', false, 'reason', 'not leased'); end if;
    insert into ops_private.whatsapp_template_audit (request_id, event, detail) values (v_id, 'ack:' || v_status, left(p_payload->>'error', 300));
    return jsonb_build_object('ok', true);
  end if;

  -- Meta's own review status for the templates we submitted: [{name, language, status, reason}]
  if p_action = 'sync' then
    if jsonb_typeof(p_payload->'statuses') <> 'array' then return jsonb_build_object('ok', false, 'reason', 'statuses'); end if;
    for s in select * from jsonb_array_elements(p_payload->'statuses') loop
      v_new := case upper(coalesce(s->>'status', ''))
        when 'APPROVED' then 'APPROVED' when 'PENDING' then 'PENDING' when 'IN_APPEAL' then 'PENDING'
        when 'REJECTED' then 'REJECTED' when 'PAUSED' then 'REJECTED' when 'DISABLED' then 'REJECTED' else null end;
      continue when v_new is null;
      v_reason := nullif(left(coalesce(s->>'reason', ''), 300), '');
      if v_new = 'REJECTED' and v_reason is null then v_reason := 'ميتا رفضت القالب (' || upper(s->>'status') || ')'; end if;
      update ops_private.whatsapp_template_requests
         set status = v_new, reason = case when v_new = 'REJECTED' then v_reason end, updated_at = now()
       where name = left(s->>'name', 120) and language = left(s->>'language', 20) and status in ('PENDING', 'APPROVED', 'REJECTED')
         and status <> v_new
      returning * into r;
      if found then
        insert into ops_private.whatsapp_template_audit (request_id, event, detail) values (r.id, 'status:' || v_new, v_reason);
        if v_new = 'APPROVED' then  -- usable in the conversation picker at once (the agent's refresh keeps it afterwards)
          insert into ops_private.whatsapp_templates (name, language, category, body) values (r.name, r.language, r.category, r.body)
          on conflict (name, language) do update set category = excluded.category, body = excluded.body, synced_at = now();
        else
          delete from ops_private.whatsapp_templates where name = r.name and language = r.language;
        end if;
      end if;
    end loop;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'action');
end $$;

revoke all on function ops_private.whatsapp_template_sweep() from public, anon, authenticated;
revoke all on function public.whatsapp_template_submit(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_template_requests_list() from public, anon, authenticated;
revoke all on function public.whatsapp_template_api(text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_template_submit(uuid, text, text, text) to service_role;
grant execute on function public.whatsapp_template_requests_list() to service_role;
grant execute on function public.whatsapp_template_api(text, jsonb) to service_role;

commit;
