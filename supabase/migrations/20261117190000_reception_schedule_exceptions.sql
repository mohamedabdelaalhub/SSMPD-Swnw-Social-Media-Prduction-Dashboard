-- Owner 2026-11-17: temporary changes to a doctor's schedule («الاستثناء المؤقت»): for a day, a week or a month the doctor is either
-- away (kind 'off') or works different hours (kind 'hours'); when the period ends the weekly schedule simply takes over again.
--  * clinic_reception.schedule_exceptions: one row per change (provider, from..to, kind, slots, reason); cancel keeps the row (audit).
--  * Adding one removes the doctor's coming availability windows on those days (weekly/manual/exception; walk-in windows stay),
--    adds the exception hours for 'hours', and returns the bookings that now fall outside them so reception can call the patients.
--  * weekly_generate skips any day covered by an active exception, so the nightly timer does not put the old hours back.
--  * Cancelling removes the exception windows and regenerates the weekly schedule for that doctor.
-- No booking is moved or cancelled automatically. Access: list = view, add/cancel = manage (same as the weekly schedule).
begin;
do $$ begin
  if to_regprocedure('clinic_reception.weekly_generate(uuid,uuid,integer)') is null then raise exception 'طبّق ملف الجدول الأسبوعي الأول (20261117120000)'; end if;
  if to_regclass('clinic_reception.schedule_exceptions') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.availability drop constraint if exists availability_source_check;
alter table clinic_reception.availability add constraint availability_source_check check (source in ('manual','weekly','walk_in','exception'));

create table clinic_reception.schedule_exceptions(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  provider_id uuid not null references clinic_reception.providers(id),
  from_date date not null, to_date date not null,
  kind text not null check (kind in ('off','hours')),
  slots jsonb not null default '[]'::jsonb,
  reason text not null check (length(trim(reason)) between 3 and 300),
  created_by uuid not null references public.admins(id), created_at timestamptz not null default now(),
  cancelled_by uuid references public.admins(id), cancelled_at timestamptz,
  check (to_date >= from_date and to_date - from_date <= 92),
  check ((kind = 'off') = (slots = '[]'::jsonb))
);
create index schedule_exceptions_provider_idx on clinic_reception.schedule_exceptions(provider_id, from_date, to_date) where cancelled_at is null;
alter table clinic_reception.schedule_exceptions enable row level security;
revoke all on clinic_reception.schedule_exceptions from public, anon, authenticated;

create or replace function clinic_reception.exception_covers(p_provider uuid, p_day date) returns boolean language sql stable set search_path = pg_catalog, public as $$
  select exists(select 1 from clinic_reception.schedule_exceptions e where e.provider_id = p_provider and e.cancelled_at is null and p_day between e.from_date and e.to_date)
$$;
revoke all on function clinic_reception.exception_covers(uuid,date) from public, anon, authenticated;

-- Same body as 20261117120000, plus: skip days covered by an active exception.
create or replace function clinic_reception.weekly_generate(p_workspace uuid,p_provider uuid default null,p_days int default 28)
returns int language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date;n int:=0;r record;st timestamptz;en timestamptz;today date:=(now() at time zone 'Africa/Cairo')::date;
begin
 if p_days<1 or p_days>92 then raise exception 'المدة من ١ لـ ٩٢ يوم';end if;
 for d in select generate_series(today,today+p_days-1,interval '1 day')::date loop
  for r in select w.* from clinic_reception.weekly_slots w join clinic_reception.providers p on p.id=w.provider_id and p.active
           where w.workspace_id=p_workspace and (p_provider is null or w.provider_id=p_provider) and w.dow=extract(dow from d) loop
   if clinic_reception.exception_covers(r.provider_id,d) then continue;end if;
   st:=(d+r.starts) at time zone 'Africa/Cairo';
   en:=((d+case when r.ends<=r.starts then 1 else 0 end)+r.ends) at time zone 'Africa/Cairo';
   if en<=now() then continue;end if;
   if not exists(select 1 from clinic_reception.availability a where a.provider_id=r.provider_id and a.starts_at<en and a.ends_at>st) then
    insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at,source) values(p_workspace,r.provider_id,st,en,'weekly') on conflict do nothing;
    if found then n:=n+1;end if;
   end if;
  end loop;
 end loop;
 return n;
end $$;
revoke all on function clinic_reception.weekly_generate(uuid,uuid,int) from public,anon,authenticated;

create or replace function public.clinic_reception_schedule_exception(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; ex clinic_reception.schedule_exceptions%rowtype; prov uuid; f date; t date; k text; sl jsonb := '[]'::jsonb; x jsonb;
  d date; st timestamptz; en timestamptz; removed int := 0; added int := 0; today date := (now() at time zone 'Africa/Cairo')::date; affected jsonb;
begin
  me := clinic_reception.access(p_workspace, case when p_action = 'list' then 'view' else 'manage' end);
  if p_action = 'list' then
    return jsonb_build_object('exceptions', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'provider_id', e.provider_id, 'provider_name', p.name,
      'from', e.from_date, 'to', e.to_date, 'kind', e.kind, 'slots', e.slots, 'reason', e.reason, 'created_at', e.created_at) order by e.from_date, p.name)
      from clinic_reception.schedule_exceptions e join clinic_reception.providers p on p.id = e.provider_id
      where e.workspace_id = p_workspace and e.cancelled_at is null and e.to_date >= today), '[]'));

  elsif p_action = 'add' then
    prov := nullif(p_payload->>'provider_id', '')::uuid; f := nullif(p_payload->>'from', '')::date; t := nullif(p_payload->>'to', '')::date; k := p_payload->>'kind';
    if not exists(select 1 from clinic_reception.providers where id = prov and workspace_id = p_workspace) then raise exception 'اختر الطبيب'; end if;
    if f is null or t is null or t < f then raise exception 'راجع تاريخ البداية والنهاية'; end if;
    if f < today then raise exception 'تاريخ البداية لازم يكون النهارده أو بعده'; end if;
    if t - f > 92 then raise exception 'الاستثناء أقصاه ٣ شهور'; end if;
    if k not in ('off', 'hours') then raise exception 'اختار: مش موجود ولا ساعات مختلفة'; end if;
    if length(trim(coalesce(p_payload->>'reason', ''))) < 3 then raise exception 'اكتب السبب'; end if;
    if k = 'hours' then
      if jsonb_typeof(p_payload->'slots') is distinct from 'array' or jsonb_array_length(p_payload->'slots') not between 1 and 3 then raise exception 'اكتب الساعات الجديدة (فترة أو اتنين)'; end if;
      for x in select * from jsonb_array_elements(p_payload->'slots') loop
        if coalesce(x->>'starts', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(x->>'ends', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or x->>'starts' = x->>'ends' then raise exception 'راجع مواعيد البداية والنهاية'; end if;
        sl := sl || jsonb_build_array(jsonb_build_object('starts', x->>'starts', 'ends', x->>'ends'));
      end loop;
    end if;
    if exists(select 1 from clinic_reception.schedule_exceptions e where e.provider_id = prov and e.cancelled_at is null and e.from_date <= t and e.to_date >= f) then
      raise exception 'فيه استثناء تاني للدكتور ده في نفس الفترة؛ الغيه الأول';
    end if;
    insert into clinic_reception.schedule_exceptions(workspace_id, provider_id, from_date, to_date, kind, slots, reason, created_by)
      values (p_workspace, prov, f, t, k, sl, trim(p_payload->>'reason'), me) returning * into ex;
    -- Remove the coming availability on those days (walk-in windows stay: a patient is already at the desk).
    with gone as (delete from clinic_reception.availability a where a.provider_id = prov and a.source <> 'walk_in' and a.ends_at > now()
        and (a.starts_at at time zone 'Africa/Cairo')::date between f and t returning 1) select count(*) into removed from gone;
    if k = 'hours' then
      for d in select generate_series(f, t, interval '1 day')::date loop
        for x in select * from jsonb_array_elements(sl) loop
          st := (d + (x->>'starts')::time) at time zone 'Africa/Cairo';
          en := ((d + case when (x->>'ends')::time <= (x->>'starts')::time then 1 else 0 end) + (x->>'ends')::time) at time zone 'Africa/Cairo';
          if en <= now() then continue; end if;
          if not exists(select 1 from clinic_reception.availability a where a.provider_id = prov and a.starts_at < en and a.ends_at > st) then
            insert into clinic_reception.availability(workspace_id, provider_id, starts_at, ends_at, source) values (p_workspace, prov, st, en, 'exception');
            added := added + 1;
          end if;
        end loop;
      end loop;
    end if;
    -- Bookings on those days that are no longer inside any availability window: reception must call these patients.
    select coalesce(jsonb_agg(jsonb_build_object('id', ap.id, 'starts_at', ap.starts_at, 'patient', pt.name, 'phone', pt.phone) order by ap.starts_at), '[]') into affected
      from clinic_reception.appointments ap left join clinic_reception.patients pt on pt.id = ap.patient_id
      where ap.provider_id = prov and ap.status = 'booked' and ap.starts_at > now() and (ap.starts_at at time zone 'Africa/Cairo')::date between f and t
        and not exists(select 1 from clinic_reception.availability a where a.provider_id = prov and a.starts_at <= ap.starts_at and a.ends_at >= ap.ends_at);
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id) values (p_workspace, me, 'schedule_exception_add', ex.id);
    return jsonb_build_object('id', ex.id, 'removed', removed, 'added', added, 'affected', affected);

  elsif p_action = 'cancel' then
    select * into ex from clinic_reception.schedule_exceptions where id = nullif(p_payload->>'id', '')::uuid and workspace_id = p_workspace for update;
    if not found or ex.cancelled_at is not null then raise exception 'الاستثناء مش موجود أو اتلغى'; end if;
    update clinic_reception.schedule_exceptions set cancelled_by = me, cancelled_at = now() where id = ex.id;
    with gone as (delete from clinic_reception.availability a where a.provider_id = ex.provider_id and a.source = 'exception' and a.ends_at > now()
        and (a.starts_at at time zone 'Africa/Cairo')::date between ex.from_date and ex.to_date
        and not exists(select 1 from clinic_reception.appointments ap where ap.provider_id = ex.provider_id and ap.status not in ('cancelled','no_show') and ap.starts_at < a.ends_at and ap.ends_at > a.starts_at)
        returning 1) select count(*) into removed from gone;
    added := clinic_reception.weekly_generate(p_workspace, ex.provider_id, 28);
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id) values (p_workspace, me, 'schedule_exception_cancel', ex.id);
    return jsonb_build_object('id', ex.id, 'removed', removed, 'added', added);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_reception_schedule_exception(uuid,text,jsonb) from public, anon;
grant execute on function public.clinic_reception_schedule_exception(uuid,text,jsonb) to authenticated;
commit;
