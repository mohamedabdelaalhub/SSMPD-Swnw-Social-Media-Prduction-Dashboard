-- الليدز التلقائي + مزامنة صرف Meta الفعلي + تنبيهات حدود الصرف (80% / 100%)
-- مسودة للمراجعة — لسه ما اتطبقتش على أي قاعدة.

-- ========== ١) استقبال الليدز تلقائياً ==========
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source = any (array['whatsapp','messenger','instagram','phone','clinic','doctor_referral']));

-- منع التكرار: كل حدث (رسالة أولى) يتسجل مرة واحدة بس
create table if not exists public.lead_ingest_events (
  event_id   text primary key,
  lead_id    uuid references public.leads(id) on delete set null,
  source     text not null,
  was_new    boolean not null,
  created_at timestamptz not null default now()
);
alter table public.lead_ingest_events enable row level security;  -- بدون policies = service_role بس

create or replace function public.normalize_phone_eg(raw text) returns text
 language sql immutable as $$
  with s as (select regexp_replace(coalesce(raw,''), '[\s\-\(\)‎‏‪-‮]', '', 'g') x),
       t as (select regexp_replace(x, '^00', '+') x from s)
  select case
    when x = '' then null
    when x ~ '^01[0125][0-9]{8}$' then '+2' || x
    when x ~ '^1[0125][0-9]{8}$'  then '+20' || x
    when left(x,1) = '+' then x
    else '+' || regexp_replace(x, '^0+', '')
  end from t
$$;

create or replace function public.ingest_lead(
  p_event_id text, p_source text, p_name text, p_phone text, p_message text,
  p_received_at timestamptz default now(),
  p_ad_id text default null, p_adset_id text default null, p_campaign_id text default null
) returns table(lead_id uuid, was_new boolean)
 language plpgsql security definer set search_path to 'public' as $$
declare ph text; existing uuid; new_id uuid; ev record;
begin
  if p_source not in ('whatsapp','messenger','instagram') then raise exception 'bad source'; end if;
  if coalesce(p_event_id,'') = '' then raise exception 'event_id required'; end if;
  select * into ev from public.lead_ingest_events where event_id = p_event_id;
  if found then return query select ev.lead_id, false; return; end if;

  ph := public.normalize_phone_eg(p_phone);
  -- نفس الشخص، ليد لسه شغال (مش مقفول) آخر 30 يوم => ما نعملش ليد جديد، بس نكمّل معرّف الإعلان لو ناقص
  if ph is not null then
    select l.id into existing from public.leads l
     where l.phone_normalized = ph
       and l.current_status not in ('service_done','rejected','no_response','invalid_number')
       and l.received_at > now() - interval '30 days'
     order by l.received_at desc limit 1;
  end if;

  if existing is not null then
    update public.leads set
      meta_ad_id = coalesce(meta_ad_id, p_ad_id), meta_adset_id = coalesce(meta_adset_id, p_adset_id),
      meta_campaign_id = coalesce(meta_campaign_id, p_campaign_id),
      acquisition_type = coalesce(acquisition_type, case when p_ad_id is not null then 'ad' end)
     where id = existing;
    insert into public.lead_ingest_events(event_id, lead_id, source, was_new) values (p_event_id, existing, p_source, false);
    return query select existing, false; return;
  end if;

  insert into public.leads(customer_name, phone_raw, phone_normalized, source, message_text, received_at,
                           current_status, acquisition_type, meta_ad_id, meta_adset_id, meta_campaign_id)
  values (coalesce(nullif(trim(p_name),''), 'عميل جديد'), p_phone, ph, p_source, left(p_message, 1000),
          coalesce(p_received_at, now()), 'new',
          case when p_ad_id is not null then 'ad' end, p_ad_id, p_adset_id, p_campaign_id)
  returning id into new_id;
  insert into public.lead_ingest_events(event_id, lead_id, source, was_new) values (p_event_id, new_id, p_source, true);
  return query select new_id, true;
end $$;
revoke all on function public.ingest_lead(text,text,text,text,text,timestamptz,text,text,text) from public, anon, authenticated;
grant execute on function public.ingest_lead(text,text,text,text,text,timestamptz,text,text,text) to service_role;

-- ========== ٢) صرف Meta الفعلي اليومي ==========
create table if not exists public.meta_ads_daily (
  ad_account_id text not null,
  day           date not null,
  ad_id         text not null,
  ad_name       text,
  campaign_id   text, campaign_name text, adset_id text,
  brand         text check (brand is null or brand in ('sono','dr_dina')),
  spend         numeric not null default 0,
  impressions   bigint not null default 0,
  reach         bigint not null default 0,
  clicks        bigint not null default 0,
  msg_started   integer not null default 0,
  leads         integer not null default 0,
  synced_at     timestamptz not null default now(),
  primary key (ad_account_id, day, ad_id)
);
create index if not exists meta_ads_daily_day_idx on public.meta_ads_daily(day);
alter table public.meta_ads_daily enable row level security;
create policy meta_ads_daily_read on public.meta_ads_daily for select to authenticated using (public.can_manage_all_content());

create table if not exists public.meta_ads_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','failed')),
  rows_upserted integer, error text
);
alter table public.meta_ads_sync_runs enable row level security;
create policy meta_ads_sync_runs_read on public.meta_ads_sync_runs for select to authenticated using (public.can_manage_all_content());

-- حالة الحدود بالصرف الفعلي. صرف بدون صفحة معروفة (brand null) بيتحسب على كل الحدود (تحفظ).
create or replace function public.ads_actual_limits_status()
 returns table(id uuid, label text, brand text, period text, amount numeric, window_start date, window_end date, spent numeric, pct integer)
 language plpgsql stable security definer set search_path to 'public' as $$
declare l public.ads_spend_limits%rowtype; ws date; we date; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  for l in select * from public.ads_spend_limits x where x.active order by x.created_at loop
    if l.period = 'custom' then ws := l.starts_on; we := l.ends_on;
    elsif l.period = 'day' then ws := today; we := today;
    elsif l.period = 'week' then ws := today - ((extract(dow from today)::int + 1) % 7); we := ws + 6;
    else ws := date_trunc('month', today)::date; we := (date_trunc('month', today) + interval '1 month - 1 day')::date;
    end if;
    id := l.id; label := l.label; brand := l.brand; period := l.period; amount := l.amount;
    window_start := ws; window_end := we;
    select coalesce(sum(d.spend),0) into spent from public.meta_ads_daily d
      where d.day between ws and we and (l.brand is null or d.brand is null or d.brand = l.brand);
    pct := case when l.amount > 0 then floor(100 * spent / l.amount)::int else 100 end;
    return next;
  end loop;
end $$;
revoke all on function public.ads_actual_limits_status() from public, anon;
grant execute on function public.ads_actual_limits_status() to authenticated, service_role;

-- تنبيه مرة واحدة لكل (حد، نافذة، نسبة)
create table if not exists public.ads_limit_alerts (
  limit_id uuid not null references public.ads_spend_limits(id) on delete cascade,
  window_start date not null, threshold integer not null check (threshold in (80,100)),
  spent numeric not null, sent_at timestamptz not null default now(),
  primary key (limit_id, window_start, threshold)
);
alter table public.ads_limit_alerts enable row level security;
create policy ads_limit_alerts_read on public.ads_limit_alerts for select to authenticated using (public.can_manage_all_content());

create or replace function public.ads_new_limit_alerts()
 returns table(label text, threshold integer, spent numeric, amount numeric, window_start date, window_end date)
 language plpgsql security definer set search_path to 'public' as $$
declare s record; t integer;
begin
  for s in select * from public.ads_actual_limits_status() loop
    foreach t in array array[80,100] loop
      if s.pct >= t then
        begin
          insert into public.ads_limit_alerts(limit_id, window_start, threshold, spent) values (s.id, s.window_start, t, s.spent);
          label := s.label; threshold := t; spent := s.spent; amount := s.amount; window_start := s.window_start; window_end := s.window_end;
          return next;
        exception when unique_violation then null;
        end;
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.ads_new_limit_alerts() from public, anon, authenticated;
grant execute on function public.ads_new_limit_alerts() to service_role;

-- ========== ٣) عدّاد "محادثات جديدة مقابل ليدز مسجلة" (اليوم بتوقيت القاهرة) ==========
create or replace function public.lead_capture_gap(p_day date default (now() at time zone 'Africa/Cairo')::date)
 returns table(conversations integer, leads_logged integer, gap integer, stale_leads integer)
 language sql stable security definer set search_path to 'public' as $$
  with c as (select count(distinct conversation_id)::int n from public.social_messages
              where not is_page and (sent_at at time zone 'Africa/Cairo')::date = p_day),
       l as (select count(*)::int n from public.leads where (received_at at time zone 'Africa/Cairo')::date = p_day),
       s as (select count(*)::int n from public.leads
              where current_status in ('new','in_progress') and (updated_at at time zone 'Africa/Cairo')::date < p_day)
  select c.n, l.n, greatest(c.n - l.n, 0), s.n from c, l, s
$$;
revoke all on function public.lead_capture_gap(date) from public, anon;
grant execute on function public.lead_capture_gap(date) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ========== ٤) توكن قراءة Meta (يقراه السيرفر بس، زي youtube_app_config) ==========
create table if not exists public.meta_ads_config (
  id integer primary key check (id = 1),
  ad_account_id text not null default '750860566902977',
  access_token text not null,
  updated_at timestamptz not null default now(), updated_by uuid references public.admins(id)
);
alter table public.meta_ads_config enable row level security;  -- بدون policies: service_role بس، ومحدش من الواجهة يقدر يقراه

-- ========== ٥) تذكير الاستقبال اليومي (9 بالليل بتوقيت القاهرة) عبر task_notifications ==========
alter table public.task_notifications drop constraint if exists task_notifications_kind_check;
alter table public.task_notifications add constraint task_notifications_kind_check
  check (kind in ('assigned','status','review','returned','overdue','comment','due_soon','lead_reminder'));

-- بيشتغل ساعتين بالـUTC (18 و19) وبينفذ فقط لما الساعة في القاهرة = 21، فيمشي مع التوقيت الصيفي.
-- ما بيبعتش حاجة لو مفيش نقص. تذكير واحد بس لكل موظف في اليوم.
create or replace function public.lead_reminders_run(p_force boolean default false) returns integer
 language plpgsql security definer set search_path to 'public' as $$
declare cairo timestamp := now() at time zone 'Africa/Cairo'; d date := (now() at time zone 'Africa/Cairo')::date;
        g record; n integer := 0; r record; msg text;
begin
  if not p_force and extract(hour from cairo) <> 21 then return 0; end if;
  select * into g from public.lead_capture_gap(d);
  -- موظفو الاستقبال: لو فيه محادثات اليوم ما اتسجلش لها ليد
  if g.gap > 0 then
    for r in select a.id from public.admins a where a.active and a.role = 'reception' loop
      msg := 'تذكير الليدز: النهارده ' || g.conversations || ' محادثة جديدة و' || g.leads_logged || ' ليد مسجّل. سجّل الناقص قبل ما تقفل.';
      insert into public.task_notifications(recipient_id, task_id, kind, message, reference_date)
        select r.id, null, 'lead_reminder', msg, d
         where not exists (select 1 from public.task_notifications t where t.recipient_id = r.id and t.kind = 'lead_reminder' and t.reference_date = d);
      if found then n := n + 1; end if;
    end loop;
  end if;
  -- المسؤول عن ليدز لسه (جديد/جاري) ومتحدّثتش النهارده
  for r in select l.assigned_to as id, count(*)::int c from public.leads l
            where l.assigned_to is not null and l.current_status in ('new','in_progress')
              and (l.updated_at at time zone 'Africa/Cairo')::date < d group by l.assigned_to loop
    msg := 'تذكير الليدز: عندك ' || r.c || ' ليد محتاج تحديث حالة.';
    insert into public.task_notifications(recipient_id, task_id, kind, message, reference_date)
      select r.id, null, 'lead_reminder', msg, d
       where not exists (select 1 from public.task_notifications t where t.recipient_id = r.id and t.kind = 'lead_reminder' and t.reference_date = d);
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.lead_reminders_run(boolean) from public, anon, authenticated;
grant execute on function public.lead_reminders_run(boolean) to service_role;

-- الجدولة (pg_cron). بتتسجل بس لو الإضافة موجودة، ومفيش فيها أي سر.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('lead-reminders-21-cairo', '2 18,19 * * *', 'select public.lead_reminders_run()');
  end if;
end $$;
