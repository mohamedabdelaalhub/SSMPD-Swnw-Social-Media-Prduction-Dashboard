-- Rotating reception TV QR for patient check-in.
-- Applied to project uuijfbpgvtdxgaosqpxo on 2026-10-30.

create table if not exists clinic_reception.display_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists display_sessions_workspace_active_idx
  on clinic_reception.display_sessions(workspace_id, expires_at desc)
  where revoked_at is null;
create index if not exists display_sessions_workspace_idx
  on clinic_reception.display_sessions(workspace_id);

create table if not exists clinic_reception.display_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references clinic_reception.display_sessions(id) on delete cascade,
  workspace_id uuid not null references clinic_reception.workspaces(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists display_qr_tokens_session_created_idx
  on clinic_reception.display_qr_tokens(session_id, created_at desc);
create index if not exists display_qr_tokens_token_idx
  on clinic_reception.display_qr_tokens(token);
create index if not exists display_qr_tokens_workspace_idx
  on clinic_reception.display_qr_tokens(workspace_id);

create or replace function public.clinic_reception_display_session(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  me uuid;
  s clinic_reception.journey_settings%rowtype;
  ds clinic_reception.display_sessions%rowtype;
begin
  me := clinic_reception.access(p_workspace,'view');
  select * into s from clinic_reception.journey_settings where workspace_id=p_workspace;
  if not coalesce(s.qr_enabled,true) then
    raise exception 'تسجيل الوصول بالـ QR غير مفعل';
  end if;

  select * into ds
  from clinic_reception.display_sessions
  where workspace_id=p_workspace
    and revoked_at is null
    and expires_at > now() + interval '1 day'
  order by created_at desc
  limit 1;

  if ds.id is null then
    insert into clinic_reception.display_sessions(workspace_id,expires_at,created_by)
    values(p_workspace,now()+interval '30 days',me)
    returning * into ds;
  end if;

  return jsonb_build_object(
    'display_token',ds.token,
    'expires_at',ds.expires_at,
    'workspace_id',ds.workspace_id
  );
end
$function$;

revoke all on function public.clinic_reception_display_session(uuid) from public, anon;
grant execute on function public.clinic_reception_display_session(uuid) to authenticated, service_role;

create or replace function public.clinic_reception_display_qr_rotate(p_display_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  ds clinic_reception.display_sessions%rowtype;
  s clinic_reception.journey_settings%rowtype;
  q clinic_reception.display_qr_tokens%rowtype;
begin
  select * into ds
  from clinic_reception.display_sessions
  where token=p_display_token
    and revoked_at is null
    and expires_at>now();
  if not found then raise exception 'رابط شاشة تسجيل الوصول غير صالح أو انتهت صلاحيته'; end if;

  select * into s from clinic_reception.journey_settings where workspace_id=ds.workspace_id;
  if not coalesce(s.qr_enabled,true) then raise exception 'تسجيل الوصول بالـ QR غير مفعل'; end if;

  update clinic_reception.display_sessions set last_seen_at=now() where id=ds.id;
  delete from clinic_reception.display_qr_tokens where expires_at < now()-interval '1 hour';

  select * into q
  from clinic_reception.display_qr_tokens
  where session_id=ds.id and expires_at>now()+interval '1 minute'
  order by created_at desc
  limit 1;

  if q.id is null then
    insert into clinic_reception.display_qr_tokens(session_id,workspace_id,expires_at)
    values(ds.id,ds.workspace_id,now()+interval '4 minutes')
    returning * into q;
  end if;

  return jsonb_build_object(
    'qr_token',q.token,
    'expires_at',q.expires_at,
    'refresh_at',q.created_at+interval '3 minutes'
  );
end
$function$;

revoke all on function public.clinic_reception_display_qr_rotate(uuid) from public;
grant execute on function public.clinic_reception_display_qr_rotate(uuid) to anon, authenticated, service_role;

create or replace function public.clinic_reception_checkin_candidates_screen(
  p_screen_token uuid,
  p_phone text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  ws uuid;
  s clinic_reception.journey_settings%rowtype;
  dist double precision;
  result jsonb;
begin
  select q.workspace_id into ws
  from clinic_reception.display_qr_tokens q
  join clinic_reception.display_sessions ds on ds.id=q.session_id
  where q.token=p_screen_token
    and q.expires_at>now()
    and ds.revoked_at is null
    and ds.expires_at>now();
  if ws is null then raise exception 'الكود اتجدد. امسح الكود الظاهر على الشاشة مرة أخرى'; end if;

  select * into s from clinic_reception.journey_settings where workspace_id=ws;
  if not coalesce(s.qr_enabled,true) then raise exception 'تسجيل الوصول بالـ QR غير مفعل'; end if;
  if coalesce(s.location_required,true) then
    if s.clinic_lat is null or s.clinic_lng is null then raise exception 'موقع المركز لم يتم اعتماده بعد لتسجيل الوصول بالـ QR'; end if;
    if p_lat is null or p_lng is null then raise exception 'فعّل الموقع لإكمال تسجيل الوصول'; end if;
    dist:=6371000*2*asin(sqrt(power(sin(radians(p_lat-s.clinic_lat)/2),2)+cos(radians(s.clinic_lat))*cos(radians(p_lat))*power(sin(radians(p_lng-s.clinic_lng)/2),2)));
    if dist>s.radius_meters+least(coalesce(p_accuracy,0),100) then raise exception 'أنت خارج نطاق المركز المسموح لتسجيل الوصول'; end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('appointment_id',a.id,'starts_at',a.starts_at,'provider_name',pr.name,'service_name',sv.name) order by a.starts_at),'[]'::jsonb)
  into result
  from clinic_reception.appointments a
  join clinic_reception.workspaces w on w.id=a.workspace_id and w.mode='live'
  join clinic_reception.patients p on p.id=a.patient_id
  join clinic_reception.providers pr on pr.id=a.provider_id
  join clinic_reception.services sv on sv.id=a.service_id
  where a.workspace_id=ws
    and regexp_replace(p.phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g')
    and length(regexp_replace(p_phone,'[^0-9]','','g'))>=8
    and (a.starts_at at time zone 'Africa/Cairo')::date=clinic_reception.today()
    and a.status in ('booked','arrived');
  return result;
end
$function$;

revoke all on function public.clinic_reception_checkin_candidates_screen(uuid,text,double precision,double precision,double precision) from public;
grant execute on function public.clinic_reception_checkin_candidates_screen(uuid,text,double precision,double precision,double precision) to anon, authenticated, service_role;

create or replace function public.clinic_reception_checkin_static_screen(
  p_screen_token uuid,
  p_appointment uuid,
  p_phone text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  ws uuid;
  ap_ws uuid;
begin
  select q.workspace_id into ws
  from clinic_reception.display_qr_tokens q
  join clinic_reception.display_sessions ds on ds.id=q.session_id
  where q.token=p_screen_token
    and q.expires_at>now()
    and ds.revoked_at is null
    and ds.expires_at>now();
  if ws is null then raise exception 'الكود اتجدد. امسح الكود الظاهر على الشاشة مرة أخرى'; end if;

  select workspace_id into ap_ws from clinic_reception.appointments where id=p_appointment;
  if ap_ws is null or ap_ws<>ws then raise exception 'الحجز غير متاح لهذا الكود'; end if;

  return public.clinic_reception_checkin_static(p_appointment,p_phone,p_lat,p_lng,p_accuracy);
end
$function$;

revoke all on function public.clinic_reception_checkin_static_screen(uuid,uuid,text,double precision,double precision,double precision) from public;
grant execute on function public.clinic_reception_checkin_static_screen(uuid,uuid,text,double precision,double precision,double precision) to anon, authenticated, service_role;
