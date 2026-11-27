-- Website forms («اتصل بنا» / الوظايف) → dashboard. Owner 2026-11-27: «موافق على الفورمات للداشبورد».
-- The new site (on the server, doc 14) posts to the edge function website-request-ingest (secret header); nothing is written to Masa.
--   * public.website_requests: kind contact / job / internship / partner, fields jsonb (whitelisted keys, size capped),
--     status new / reviewed / done, unique request_id (idempotent retries), ip_hash (rate limit; never the raw IP).
--     RLS on, no direct access for anon / authenticated.
--   * public.website_request_ingest(...): service role only. Validates, rate limits (10 per IP-hash per hour), idempotent.
--   * public.website_requests_list(workspace, status, limit) / website_requests_mark(workspace, id, status): reception / admin
--     through clinic_reception.access ('view' to read, 'book' to mark).
-- Rollback: supabase/rollbacks/20261127010000_website_requests.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.access(uuid,text)') is null then raise exception 'مكونات الاستقبال غير موجودة'; end if;
  if to_regclass('public.website_requests') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table public.website_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique check (request_id ~ '^[A-Za-z0-9:._-]{8,80}$'),
  kind text not null check (kind in ('contact', 'job', 'internship', 'partner')),
  fields jsonb not null check (jsonb_typeof(fields) = 'object' and length(fields::text) <= 6000),
  status text not null default 'new' check (status in ('new', 'reviewed', 'done')),
  ip_hash text check (ip_hash is null or length(ip_hash) between 16 and 128),
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz
);
create index website_requests_status_created on public.website_requests (status, created_at desc);
create index website_requests_ip_created on public.website_requests (ip_hash, created_at desc) where ip_hash is not null;
alter table public.website_requests enable row level security;
revoke all on public.website_requests from public, anon, authenticated;

create function public.website_request_ingest(p_request_id text, p_kind text, p_fields jsonb, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare existing uuid; new_id uuid; clean jsonb := '{}'::jsonb; k text; v text;
  allowed text[] := array['name', 'phone', 'email', 'subject', 'message', 'position', 'experience', 'university', 'company', 'city', 'age'];
begin
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9:._-]{8,80}$' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if p_kind is null or p_kind not in ('contact', 'job', 'internship', 'partner') then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  select id into existing from public.website_requests where request_id = p_request_id;
  if existing is not null then return jsonb_build_object('ok', true, 'id', existing, 'created', false); end if;
  if p_ip_hash is not null and (select count(*) from public.website_requests where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited'); end if;
  for k, v in select key, btrim(value #>> '{}') from jsonb_each(p_fields) where jsonb_typeof(value) in ('string', 'number') loop
    if k = any (allowed) and v <> '' then
      clean := clean || jsonb_build_object(k, left(v, case when k = 'message' then 2000 else 300 end));
    end if;
  end loop;
  if clean = '{}'::jsonb or not (clean ? 'message' or clean ? 'phone' or clean ? 'email') then
    return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  insert into public.website_requests (request_id, kind, fields, ip_hash) values (p_request_id, p_kind, clean, p_ip_hash)
    on conflict (request_id) do nothing returning id into new_id;
  if new_id is null then
    select id into existing from public.website_requests where request_id = p_request_id;
    return jsonb_build_object('ok', true, 'id', existing, 'created', false);
  end if;
  return jsonb_build_object('ok', true, 'id', new_id, 'created', true);
end $$;
revoke all on function public.website_request_ingest(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.website_request_ingest(text, text, jsonb, text) to service_role;

create function public.website_requests_list(p_workspace uuid, p_status text default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_reception.access(p_workspace, 'view');
begin
  if p_status is not null and p_status not in ('new', 'reviewed', 'done') then raise exception 'حالة غير صحيحة'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select r.id, r.kind, r.fields, r.status, r.created_at, r.reviewed_at from public.website_requests r
     where p_status is null or r.status = p_status order by r.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb);
end $$;
revoke all on function public.website_requests_list(uuid, text, integer) from public, anon;
grant execute on function public.website_requests_list(uuid, text, integer) to authenticated;

create function public.website_requests_mark(p_workspace uuid, p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_reception.access(p_workspace, 'book'); n integer;
begin
  if p_status is null or p_status not in ('new', 'reviewed', 'done') then raise exception 'حالة غير صحيحة'; end if;
  update public.website_requests set status = p_status, reviewed_by = case when p_status = 'new' then null else me end,
    reviewed_at = case when p_status = 'new' then null else now() end where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'الطلب غير موجود'; end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end $$;
revoke all on function public.website_requests_mark(uuid, uuid, text) from public, anon;
grant execute on function public.website_requests_mark(uuid, uuid, text) to authenticated;

commit;
