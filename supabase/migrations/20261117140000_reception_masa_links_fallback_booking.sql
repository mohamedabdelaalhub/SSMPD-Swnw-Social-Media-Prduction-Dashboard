-- Masa doctor ↔ dashboard provider mapping, and fallback booking for when the Masa bridge is down.
-- Owner approvals (2026-11-16): «موافق تضيف الدكاترة الناقصين للداشبورد», «وموافق على نظام الحجز الاحتياطي على الداشبورد»,
-- «الداشبورد هو الصح في الأسماء بتاعة الدكاترة» (dashboard names are canonical; Masa spellings are variants).
--
-- 1. clinic_reception.masa_doctor_links: one row per Masa doctor id (never match on name at runtime: Masa has two
--    «داليا سعيد», 1130 dermatology and 1132 orthodontics, both the same dashboard provider).
-- 2. clinic_reception.fallback_bookings: bookings the WhatsApp agent (and later the website) takes while Masa is down.
--    A booking holds its slot from the dashboard availability (weekly schedule) and is never placed over an
--    appointment or another hold (per-doctor advisory lock). Reception sees them; the agent replays them to Masa
--    with the same BookingRequestId; a refusal from Masa marks the booking 'conflict' for reception.
-- 3. A trigger stops reception booking over a held slot (all paths: book, reschedule, walk-in).
-- Nothing here calls Masa or sends messages. The API is for the service role only (edge function booking-fallback).

create or replace function clinic_reception.masa_norm(p text) returns text language sql immutable as $$
  select translate(regexp_replace(regexp_replace(coalesce(p,''),'^\s*(د|ا|أ)\s*[./]\s*',''),'\s+','','g'),'أإآىةـ','ااايه')
$$;

create table if not exists clinic_reception.masa_doctor_links(
  masa_doctor_id int primary key check (masa_doctor_id > 0),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  provider_id uuid references clinic_reception.providers(id),
  masa_name text not null,
  masa_specialization_id int,
  status text not null default 'pending' check (status in ('linked','inactive','pending')),
  note text,
  updated_by uuid references public.admins(id),
  updated_at timestamptz not null default now(),
  check ((status = 'linked') = (provider_id is not null))
);
create index if not exists masa_doctor_links_provider_idx on clinic_reception.masa_doctor_links(provider_id);
alter table clinic_reception.masa_doctor_links enable row level security;
revoke all on clinic_reception.masa_doctor_links from public, anon, authenticated;

-- Seed: Masa catalog of 2026-11-16 (56 doctors; 1097 and 1113 left the centre and are excluded by the agent).
-- target = dashboard name when it differs; 'inactive' = owner said 2026-11-16 the doctor no longer works here.
create or replace function clinic_reception.masa_link_seed(p_workspace uuid) returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record; n int := 0; hits uuid[];
begin
  for r in select * from (values
    (1054,'امل علي',397,null::text,null::text),(1055,'احمد على',397,null,null),(1059,'احمد مصطفى',397,null,null),
    (1061,'شريف ابراهيم',399,null,null),(1062,'احمد الخولى',399,null,null),(1063,'محمد سعد حلمى',399,null,'inactive'),
    (1064,'ابانوب مجدى',399,null,null),(1065,'احمد سمير',400,null,null),(1066,'امنية السيد',400,null,null),
    (1068,'محمد قدرى',401,null,null),(1069,'ماهيتاب مجدي',401,null,'inactive'),(1074,'مريم القس',403,null,null),
    (1075,'ا/ لينا الحسيني',403,'لينا الحسيني',null),(1077,'مى اللبودى',403,null,'inactive'),(1079,'الهام قدرى',404,null,null),
    (1080,'سما نبيل',405,'سما نبيل عارف',null),(1081,'يحيى زكريا',405,'يحي زكريا',null),(1083,'هاجر شاهين',406,null,'inactive'),
    (1084,'محمد حلمى',407,null,'inactive'),(1088,'بلال الصفتي',398,null,null),(1092,'معتز الهجين',409,null,null),
    (1093,'مريم عبد الوهاب',409,null,'inactive'),(1095,'دينا حسنى',413,'دينا حسني',null),(1096,'غادة قدري',409,null,'inactive'),
    (1098,'جيهان شحاته',404,null,'inactive'),(1099,'آية مفتاح',402,null,null),(1102,'احمد السيد عبادة',397,null,'inactive'),
    (1103,'محمد عبد الفتاح عباس',398,null,'inactive'),(1105,'عبد الرحمن الطوخى',409,null,'inactive'),
    (1106,'اسراء محمد السيد',409,null,'inactive'),(1107,'تقى خميس',409,null,null),(1112,'هانى شاكر',399,null,null),
    (1114,'مصطفى محمد',412,null,null),(1115,'احمد عبد الفتاح',402,null,null),(1116,'عمر خالد احمد',397,'عمر خالد',null),
    (1117,'احمد محمد ابو طالب',398,'محمد أبو طالب',null),(1118,'هاجر محى',409,null,null),
    (1119,'ايمن احمد عبد الله',398,'أيمن عبدالله',null),(1120,'وفاء مصطفى',405,null,'inactive'),(1121,'احمد عادل',408,null,null),
    (1122,'احمد عبد العزيز',417,null,'inactive'),(1123,'محمد محمود',399,null,'inactive'),(1126,'محمد فتحي',402,'محمد أحمد فتحي',null),
    (1127,'خلود شلتوت',400,null,null),(1128,'عبد الرحمن رمضان',412,'عبد الرحمن رمضان عبد الرسول',null),(1129,'رحاب ربيع',404,null,'inactive'),
    (1130,'داليا سعيد',400,null,null),(1131,'شادي حسام عبد الفتاح',400,'شادي حسام',null),(1132,'داليا سعيد',409,null,null),
    (1133,'حسين محمد',401,null,null),(1134,'محمد عبد الرحمن',407,null,null),(1135,'محمد عبد الشافي',407,null,null),
    (1137,'شيماء خليفة علي',400,'شيماء خليفة',null),(1138,'عبد المؤمن بركات',397,null,'inactive'),(1144,'احمد رشيدي',409,'أحمد الرشيدي',null),
    (1146,'راضي منصور',406,null,null)
  ) v(mid,mname,spec,target,state) loop
    if r.state = 'inactive' then
      insert into clinic_reception.masa_doctor_links(masa_doctor_id,workspace_id,masa_name,masa_specialization_id,status,note)
      values (r.mid,p_workspace,r.mname,r.spec,'inactive','المالك 2026-11-16: لا يعمل بالمركز حالياً') on conflict do nothing;
    else
      select array_agg(p.id) into hits from clinic_reception.providers p
       where p.workspace_id = p_workspace and p.active and clinic_reception.masa_norm(p.name) = clinic_reception.masa_norm(coalesce(r.target,r.mname));
      if hits is null then  -- e.g. «د.هاجر محي» (1118) is switched off on the dashboard: link her anyway; the fallback refuses until she is active
        select array_agg(p.id) into hits from clinic_reception.providers p
         where p.workspace_id = p_workspace and clinic_reception.masa_norm(p.name) = clinic_reception.masa_norm(coalesce(r.target,r.mname));
      end if;
      insert into clinic_reception.masa_doctor_links(masa_doctor_id,workspace_id,provider_id,masa_name,masa_specialization_id,status,note)
      values (r.mid,p_workspace,case when cardinality(hits)=1 then hits[1] end,r.mname,r.spec,
              case when cardinality(hits)=1 then 'linked' else 'pending' end,
              case when cardinality(hits)>1 then 'أكثر من طبيب بنفس الاسم — يحتاج ربط يدوي' when hits is null then 'لا يوجد طبيب بالاسم على الداشبورد' end)
      on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function clinic_reception.masa_link_seed(uuid) from public, anon, authenticated;

-- Live workspace only (dc6e99a1…). Add راضي منصور (owner 2026-11-16: شغال، أورام → «الكيماوي»), then seed the links.
do $$ declare ws uuid; br text; begin
  select id into ws from clinic_reception.workspaces where mode = 'live' and id::text like 'dc6e99a1-%';
  if ws is null then return; end if;
  select branch into br from clinic_reception.providers where workspace_id = ws and active group by branch order by count(*) desc limit 1;
  if not exists (select 1 from clinic_reception.providers where workspace_id = ws and clinic_reception.masa_norm(name) = clinic_reception.masa_norm('راضي منصور')) then
    insert into clinic_reception.providers(workspace_id,name,department,branch) values (ws,'د.راضي منصور','الكيماوي',coalesce(br,'حدائق الأهرام'));
  end if;
  perform clinic_reception.masa_link_seed(ws);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
create table if not exists clinic_reception.fallback_bookings(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  booking_request_id text not null unique check (length(booking_request_id) between 1 and 200),
  source text not null check (source in ('whatsapp','website')),
  channel text,
  wa_id text,
  masa_doctor_id int not null references clinic_reception.masa_doctor_links(masa_doctor_id),
  masa_specialization_id int,
  provider_id uuid not null references clinic_reception.providers(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  customer_name text not null check (length(trim(customer_name)) between 2 and 120),
  phone text not null check (phone ~ '^\+?[0-9]{8,15}$'),
  customer_age int check (customer_age between 0 and 120),
  needed_service text not null default 'كشف',
  status text not null default 'pending' check (status in ('pending','replayed','conflict','cancel_pending','cancelled')),
  official_booking_id text,
  last_error text,
  attempts int not null default 0,
  lease_until timestamptz,
  reception_confirmed_at timestamptz,
  reception_confirmed_by uuid references public.admins(id),
  slot_released_at timestamptz,
  slot_released_by uuid references public.admins(id),
  cancel_reason text,
  cancelled_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  replayed_at timestamptz,
  check (ends_at > starts_at)
);
create index if not exists fallback_bookings_provider_idx on clinic_reception.fallback_bookings(provider_id, starts_at);
create index if not exists fallback_bookings_status_idx on clinic_reception.fallback_bookings(status, starts_at);
alter table clinic_reception.fallback_bookings enable row level security;
revoke all on clinic_reception.fallback_bookings from public, anon, authenticated;

-- A booking holds its slot until it is cancelled or reception releases it (booked it as a normal appointment).
create or replace function clinic_reception.fallback_holds(b clinic_reception.fallback_bookings) returns boolean language sql immutable as $$
  select b.status in ('pending','replayed','conflict') and b.slot_released_at is null
$$;

create or replace function clinic_reception.slot_lock(p_provider uuid) returns void language plpgsql as $$
begin perform pg_advisory_xact_lock(hashtextextended('rx-slot:' || p_provider::text, 0)); end $$;

create or replace function clinic_reception.slot_busy(p_provider uuid, p_start timestamptz, p_end timestamptz, p_skip uuid default null)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_reception.appointments a where a.provider_id = p_provider
                   and a.status not in ('cancelled','no_show') and a.starts_at < p_end and a.ends_at > p_start)
      or exists (select 1 from clinic_reception.fallback_bookings f where f.provider_id = p_provider
                   and clinic_reception.fallback_holds(f) and f.starts_at < p_end and f.ends_at > p_start and f.id is distinct from p_skip)
$$;

create or replace function clinic_reception.center_closed(p_day date) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare hit boolean := false;
begin
  if to_regclass('clinic_people.center_closures') is null then return false; end if;
  execute 'select exists(select 1 from clinic_people.center_closures c where c.status = ''approved'' and $1 between c.from_date and c.to_date)' into hit using p_day;
  return coalesce(hit, false);
end $$;

-- Is [p_start,p_end) bookable for the fallback: future, inside one availability window, inside clinic hours
-- 08:00–24:00 Cairo of the same day, centre open.
create or replace function clinic_reception.fallback_slot_ok(p_provider uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select p_start > now() + interval '15 minutes'
     and (p_start at time zone 'Africa/Cairo')::time >= time '08:00'
     and p_end <= (((p_start at time zone 'Africa/Cairo')::date + 1)::timestamp at time zone 'Africa/Cairo')
     and not clinic_reception.center_closed((p_start at time zone 'Africa/Cairo')::date)
     and exists (select 1 from clinic_reception.availability v where v.provider_id = p_provider and v.starts_at <= p_start and v.ends_at >= p_end)
$$;

-- Reception cannot place an appointment over a held fallback slot (book, reschedule, walk-in, any path).
create or replace function clinic_reception.appointments_respect_fallback() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare f record;
begin
  if new.status in ('cancelled','no_show') then return new; end if;
  if tg_op = 'UPDATE' and old.provider_id = new.provider_id and old.starts_at = new.starts_at and old.ends_at = new.ends_at
     and old.status not in ('cancelled','no_show') then return new; end if;
  perform clinic_reception.slot_lock(new.provider_id);
  select * into f from clinic_reception.fallback_bookings b where b.provider_id = new.provider_id and clinic_reception.fallback_holds(b)
     and b.starts_at < new.ends_at and b.ends_at > new.starts_at order by b.starts_at limit 1;
  if found then
    raise exception 'الميعاد ده محجوز حجز احتياطي (واتساب/الموقع) الساعة % — افتح «الحجوزات الاحتياطية» وفكّ الحجز لو هتسجله كموعد عادي، أو اختار وقت تاني',
      to_char(f.starts_at at time zone 'Africa/Cairo', 'HH24:MI');
  end if;
  return new;
end $$;
drop trigger if exists appointments_respect_fallback on clinic_reception.appointments;
create trigger appointments_respect_fallback before insert or update of provider_id, starts_at, ends_at, status on clinic_reception.appointments
  for each row execute function clinic_reception.appointments_respect_fallback();

create or replace function clinic_reception.fallback_row(f clinic_reception.fallback_bookings) returns jsonb language sql stable
security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('fallback_booking_id', f.id, 'booking_request_id', f.booking_request_id, 'status', f.status,
    'source', f.source, 'channel', f.channel, 'wa_id', f.wa_id, 'masa_doctor_id', f.masa_doctor_id,
    'masa_specialization_id', f.masa_specialization_id, 'provider_id', f.provider_id,
    'doctor_name', (select name from clinic_reception.providers where id = f.provider_id),
    'department', (select department from clinic_reception.providers where id = f.provider_id),
    'starts_at', f.starts_at, 'ends_at', f.ends_at,
    'appointment_date', to_char(f.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
    'appointment_time', to_char(f.starts_at at time zone 'Africa/Cairo', 'HH24:MI'),
    'customer_name', f.customer_name, 'phone', f.phone, 'customer_age', f.customer_age, 'needed_service', f.needed_service,
    'official_booking_id', f.official_booking_id, 'last_error', f.last_error, 'attempts', f.attempts,
    'reception_confirmed', f.reception_confirmed_at is not null, 'slot_released', f.slot_released_at is not null,
    'created_at', f.created_at, 'replayed_at', f.replayed_at)
$$;

create or replace function clinic_reception.fallback_cancel(f clinic_reception.fallback_bookings, p_reason text, p_by uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if f.status in ('cancelled','cancel_pending') then return jsonb_build_object('ok', true, 'status', f.status); end if;
  update clinic_reception.fallback_bookings set
    status = case when f.status = 'replayed' then 'cancel_pending' else 'cancelled' end,
    lease_until = null, cancel_reason = left(nullif(trim(p_reason), ''), 300), cancelled_by = p_by, updated_at = now()
  where id = f.id returning * into f;
  return jsonb_build_object('ok', true, 'status', f.status);
end $$;

-- Service-role API (edge function booking-fallback). Errors come back as {ok:false,error:<code>}.
create or replace function clinic_reception.fallback_api(p_op text, p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare l clinic_reception.masa_doctor_links; pr clinic_reception.providers; f clinic_reception.fallback_bookings;
  d0 date; nd int; mins int; t timestamptz; e timestamptz; out jsonb := '[]'; out2 jsonb; v record; cnt int := 0; lim int;
  src text; rid text; ph text;
begin
  p := coalesce(p, '{}');
  if p_op = 'health' then return jsonb_build_object('ok', true, 'now', now()); end if;

  if p_op in ('slots','book') then
    if nullif(p->>'masa_doctor_id', '') is not null then
      select * into l from clinic_reception.masa_doctor_links where masa_doctor_id = (p->>'masa_doctor_id')::int;
      if not found then return jsonb_build_object('ok', false, 'error', 'unknown_doctor'); end if;
      if l.status <> 'linked' then return jsonb_build_object('ok', false, 'error', 'doctor_not_linked', 'link_status', l.status); end if;
      select * into pr from clinic_reception.providers where id = l.provider_id;
    elsif nullif(p->>'provider_id', '') is not null and p_op = 'slots' then
      select * into pr from clinic_reception.providers where id = (p->>'provider_id')::uuid;
      select * into l from clinic_reception.masa_doctor_links where provider_id = pr.id and status = 'linked' order by masa_doctor_id limit 1;
    else
      return jsonb_build_object('ok', false, 'error', 'doctor_required');
    end if;
    if pr.id is null or not pr.active then return jsonb_build_object('ok', false, 'error', 'doctor_inactive'); end if;
    mins := coalesce(nullif(p->>(case when p_op = 'slots' then 'slot_minutes' else 'minutes' end), '')::int, 20);
    if mins < 5 or mins > 120 then return jsonb_build_object('ok', false, 'error', 'invalid_minutes'); end if;
  end if;

  if p_op = 'slots' then
    d0 := coalesce(nullif(p->>'date_from', '')::date, (now() at time zone 'Africa/Cairo')::date);
    nd := least(greatest(coalesce(nullif(p->>'days', '')::int, 7), 1), 14);
    for v in select a.starts_at, a.ends_at from clinic_reception.availability a
              where a.provider_id = pr.id and a.ends_at > greatest(now(), (d0::timestamp at time zone 'Africa/Cairo'))
                and a.starts_at < ((d0 + nd)::timestamp at time zone 'Africa/Cairo') order by a.starts_at loop
      t := v.starts_at;
      while t + make_interval(mins => mins) <= v.ends_at and cnt < 300 loop
        e := t + make_interval(mins => mins);
        if t >= (d0::timestamp at time zone 'Africa/Cairo') and t < ((d0 + nd)::timestamp at time zone 'Africa/Cairo')
           and clinic_reception.fallback_slot_ok(pr.id, t, e) and not clinic_reception.slot_busy(pr.id, t, e) then
          out := out || jsonb_build_object('starts_at', t, 'appointment_date', to_char(t at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
                                           'appointment_time', to_char(t at time zone 'Africa/Cairo', 'HH24:MI'));
          cnt := cnt + 1;
        end if;
        t := e;
      end loop;
    end loop;
    return jsonb_build_object('ok', true, 'provider_id', pr.id, 'masa_doctor_id', l.masa_doctor_id, 'doctor_name', pr.name,
      'department', pr.department, 'slot_minutes', mins, 'slots', out);
  end if;

  if p_op = 'book' then
    rid := nullif(trim(p->>'booking_request_id'), '');
    if rid is null then return jsonb_build_object('ok', false, 'error', 'booking_request_id_required'); end if;
    src := coalesce(nullif(p->>'source', ''), 'whatsapp');
    if src not in ('whatsapp','website') then return jsonb_build_object('ok', false, 'error', 'invalid_source'); end if;
    if nullif(p->>'starts_at', '') is not null then
      t := (p->>'starts_at')::timestamptz;
    elsif nullif(p->>'appointment_date', '') is not null and nullif(p->>'appointment_time', '') is not null then
      t := ((p->>'appointment_date')::date + (p->>'appointment_time')::time) at time zone 'Africa/Cairo';
    else
      return jsonb_build_object('ok', false, 'error', 'time_required');
    end if;
    e := t + make_interval(mins => mins);
    ph := regexp_replace(coalesce(p->>'phone', ''), '[\s()-]', '', 'g');
    if ph !~ '^\+?[0-9]{8,15}$' then return jsonb_build_object('ok', false, 'error', 'invalid_phone'); end if;
    if length(trim(coalesce(p->>'customer_name', ''))) not between 2 and 120 then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
    if nullif(p->>'customer_age', '') is not null and (p->>'customer_age')::int not between 0 and 120 then
      return jsonb_build_object('ok', false, 'error', 'invalid_age');
    end if;
    perform clinic_reception.slot_lock(pr.id);
    select * into f from clinic_reception.fallback_bookings where booking_request_id = rid;
    if found then
      if f.masa_doctor_id = l.masa_doctor_id and f.starts_at = t then return jsonb_build_object('ok', true, 'duplicate', true) || clinic_reception.fallback_row(f); end if;
      return jsonb_build_object('ok', false, 'error', 'booking_request_id_reused');
    end if;
    if not clinic_reception.fallback_slot_ok(pr.id, t, e) then return jsonb_build_object('ok', false, 'error', 'slot_unavailable'); end if;
    if clinic_reception.slot_busy(pr.id, t, e) then return jsonb_build_object('ok', false, 'error', 'slot_taken'); end if;
    insert into clinic_reception.fallback_bookings(workspace_id, booking_request_id, source, channel, wa_id, masa_doctor_id, masa_specialization_id,
        provider_id, starts_at, ends_at, customer_name, phone, customer_age, needed_service)
      values (l.workspace_id, rid, src, left(nullif(p->>'channel', ''), 40), left(nullif(p->>'wa_id', ''), 40), l.masa_doctor_id,
        coalesce(nullif(p->>'masa_specialization_id', '')::int, l.masa_specialization_id), pr.id, t, e, trim(p->>'customer_name'), ph,
        nullif(p->>'customer_age', '')::int, coalesce(left(nullif(trim(p->>'needed_service'), ''), 80), 'كشف'))
      returning * into f;
    return jsonb_build_object('ok', true) || clinic_reception.fallback_row(f);
  end if;

  if p_op in ('cancel','status','replay_result') then
    select * into f from clinic_reception.fallback_bookings where booking_request_id = nullif(trim(p->>'booking_request_id'), '') for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if p_op = 'status' then return jsonb_build_object('ok', true) || clinic_reception.fallback_row(f); end if;
    if p_op = 'cancel' then return clinic_reception.fallback_cancel(f, coalesce(p->>'reason', 'إلغاء من ' || f.source), null); end if;
    -- replay_result: kind 'book' (default) or 'cancel'; outcome ok | conflict (Masa refused: 400/409/422) | error (try again)
    if coalesce(p->>'kind', 'book') = 'cancel' then
      if f.status <> 'cancel_pending' then return jsonb_build_object('ok', false, 'error', 'not_cancel_pending', 'status', f.status); end if;
      update clinic_reception.fallback_bookings set status = case when (p->>'ok')::boolean then 'cancelled' else status end,
        last_error = case when (p->>'ok')::boolean then null else left(p->>'error', 300) end, lease_until = null, updated_at = now()
       where id = f.id returning * into f;
    else
      if f.status <> 'pending' then return jsonb_build_object('ok', true, 'ignored', true) || clinic_reception.fallback_row(f); end if;
      if coalesce((p->>'ok')::boolean, false) then
        if nullif(p->>'official_booking_id', '') is null then return jsonb_build_object('ok', false, 'error', 'official_booking_id_required'); end if;
        update clinic_reception.fallback_bookings set status = 'replayed', official_booking_id = left(p->>'official_booking_id', 80),
          replayed_at = now(), last_error = null, lease_until = null, updated_at = now() where id = f.id returning * into f;
      elsif coalesce(p->>'outcome', '') = 'conflict' then
        update clinic_reception.fallback_bookings set status = 'conflict', last_error = left(coalesce(p->>'error', 'Masa refused the slot'), 300),
          lease_until = null, updated_at = now() where id = f.id returning * into f;
      else
        update clinic_reception.fallback_bookings set last_error = left(coalesce(p->>'error', 'error'), 300), lease_until = null, updated_at = now()
         where id = f.id returning * into f;
      end if;
    end if;
    return jsonb_build_object('ok', true) || clinic_reception.fallback_row(f);
  end if;

  if p_op = 'pending_replay' then
    lim := least(greatest(coalesce(nullif(p->>'limit', '')::int, 20), 1), 50);
    with c as (select id from clinic_reception.fallback_bookings
                where status in ('pending','cancel_pending') and (lease_until is null or lease_until < now())
                  and (status = 'cancel_pending' or starts_at > now())
                order by created_at limit lim for update skip locked),
         u as (update clinic_reception.fallback_bookings b set lease_until = now() + interval '5 minutes', attempts = b.attempts + 1, updated_at = now()
                from c where b.id = c.id returning b.*)
    select coalesce(jsonb_agg(clinic_reception.fallback_row(u.*) order by u.created_at) filter (where u.status = 'pending'), '[]'),
           coalesce(jsonb_agg(clinic_reception.fallback_row(u.*) order by u.created_at) filter (where u.status = 'cancel_pending'), '[]')
      into out, out2 from u;
    return jsonb_build_object('ok', true, 'bookings', out, 'cancels', out2);
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown_op');
end $$;
revoke all on function clinic_reception.fallback_api(text, jsonb) from public, anon, authenticated;

create or replace function public.clinic_reception_fallback_api(p_op text, p_payload jsonb) returns jsonb
language sql security definer set search_path = pg_catalog, public as $$ select clinic_reception.fallback_api(p_op, p_payload) $$;
revoke all on function public.clinic_reception_fallback_api(text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema clinic_reception to service_role;
    grant execute on function public.clinic_reception_fallback_api(text, jsonb) to service_role;
  end if;
end $$;

-- Reception / managers (dashboard): list and handle fallback bookings; managers see and fix the Masa links.
create or replace function public.clinic_reception_fallback(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; f clinic_reception.fallback_bookings; p jsonb := coalesce(p_payload, '{}'); pv uuid; st text;
begin
  if p_action = 'list' then
    perform clinic_reception.access(p_workspace, 'view');
    return jsonb_build_object('bookings', (select coalesce(jsonb_agg(clinic_reception.fallback_row(b) order by b.starts_at), '[]')
      from clinic_reception.fallback_bookings b where b.workspace_id = p_workspace
       and (b.status in ('pending','conflict','cancel_pending') or b.starts_at > now() - interval '1 day')
       and not (b.status = 'cancelled' and b.updated_at < now() - interval '1 day')));
  elsif p_action = 'links' then
    perform clinic_reception.access(p_workspace, 'manage');
    return jsonb_build_object('links', (select coalesce(jsonb_agg(jsonb_build_object('masa_doctor_id', k.masa_doctor_id, 'masa_name', k.masa_name,
      'status', k.status, 'provider_id', k.provider_id, 'doctor_name', pr.name, 'note', k.note) order by k.status, k.masa_name), '[]')
      from clinic_reception.masa_doctor_links k left join clinic_reception.providers pr on pr.id = k.provider_id where k.workspace_id = p_workspace));
  elsif p_action = 'link_set' then
    me := clinic_reception.access(p_workspace, 'manage');
    pv := nullif(p->>'provider_id', '')::uuid;
    st := case when pv is not null then 'linked' when p->>'status' = 'inactive' then 'inactive' else 'pending' end;
    if pv is not null and not exists (select 1 from clinic_reception.providers where id = pv and workspace_id = p_workspace) then raise exception 'اختر طبيب من الداشبورد'; end if;
    update clinic_reception.masa_doctor_links set provider_id = pv, status = st, note = left(nullif(trim(p->>'note'), ''), 300), updated_by = me, updated_at = now()
     where masa_doctor_id = (p->>'masa_doctor_id')::int and workspace_id = p_workspace;
    if not found then raise exception 'رقم طبيب ماسا غير موجود'; end if;
    return jsonb_build_object('ok', true, 'status', st);
  elsif p_action in ('confirm','release','cancel') then
    me := clinic_reception.access(p_workspace, 'book');
    select * into f from clinic_reception.fallback_bookings where id = (p->>'id')::uuid and workspace_id = p_workspace for update;
    if not found then raise exception 'الحجز غير موجود'; end if;
    if p_action = 'cancel' then
      if nullif(trim(p->>'reason'), '') is null then raise exception 'اكتب سبب الإلغاء'; end if;
      return clinic_reception.fallback_cancel(f, p->>'reason', me);
    end if;
    if f.status in ('cancelled','cancel_pending') then raise exception 'الحجز ده اتلغى'; end if;
    if p_action = 'confirm' then
      update clinic_reception.fallback_bookings set reception_confirmed_at = coalesce(reception_confirmed_at, now()), reception_confirmed_by = coalesce(reception_confirmed_by, me), updated_at = now() where id = f.id;
    else
      update clinic_reception.fallback_bookings set slot_released_at = coalesce(slot_released_at, now()), slot_released_by = coalesce(slot_released_by, me), updated_at = now() where id = f.id;
    end if;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_reception_fallback(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_fallback(uuid, text, jsonb) to authenticated;

revoke all on function clinic_reception.masa_norm(text) from public, anon, authenticated;
revoke all on function clinic_reception.fallback_holds(clinic_reception.fallback_bookings) from public, anon, authenticated;
revoke all on function clinic_reception.slot_lock(uuid) from public, anon, authenticated;
revoke all on function clinic_reception.slot_busy(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function clinic_reception.center_closed(date) from public, anon, authenticated;
revoke all on function clinic_reception.fallback_slot_ok(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function clinic_reception.fallback_row(clinic_reception.fallback_bookings) from public, anon, authenticated;
revoke all on function clinic_reception.fallback_cancel(clinic_reception.fallback_bookings, text, uuid) from public, anon, authenticated;
revoke all on function clinic_reception.appointments_respect_fallback() from public, anon, authenticated;
