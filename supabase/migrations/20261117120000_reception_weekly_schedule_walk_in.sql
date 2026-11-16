-- Owner (2026-11-16): «نعمل الاتنين» — (1) a weekly schedule per doctor that keeps reception availability filled on its
-- own (live availability ran out ~Dec 10 and nobody should enter days by hand), and (2) «حضور بدون ميعاد»: book a patient
-- who is at the desk now with a doctor, even when the doctor's availability wasn't entered.

alter table clinic_reception.availability add column if not exists source text not null default 'manual' check (source in ('manual','weekly','walk_in'));

create table if not exists clinic_reception.weekly_slots(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references clinic_reception.workspaces(id),
 provider_id uuid not null references clinic_reception.providers(id),
 dow smallint not null check (dow between 0 and 6),          -- 0 = Sunday … 6 = Saturday (Postgres dow)
 starts time not null, ends time not null,                     -- ends <= starts means the shift ends after midnight
 created_by uuid references public.admins(id), created_at timestamptz not null default now(),
 check (starts<>ends), unique(provider_id,dow,starts));
alter table clinic_reception.weekly_slots enable row level security;
revoke all on clinic_reception.weekly_slots from public,anon,authenticated;

-- Fill availability from the weekly schedule for the next p_days (Cairo), never touching manual rows and never
-- creating a window that overlaps an existing one.
create or replace function clinic_reception.weekly_generate(p_workspace uuid,p_provider uuid default null,p_days int default 28)
returns int language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date;n int:=0;r record;st timestamptz;en timestamptz;today date:=(now() at time zone 'Africa/Cairo')::date;
begin
 if p_days<1 or p_days>92 then raise exception 'المدة من ١ لـ ٩٢ يوم';end if;
 for d in select generate_series(today,today+p_days-1,interval '1 day')::date loop
  for r in select w.* from clinic_reception.weekly_slots w join clinic_reception.providers p on p.id=w.provider_id and p.active
           where w.workspace_id=p_workspace and (p_provider is null or w.provider_id=p_provider) and w.dow=extract(dow from d) loop
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

-- For the server's daily timer: every live workspace, 28 days ahead.
create or replace function clinic_reception.weekly_generate_all(p_days int default 28) returns int language plpgsql security definer set search_path=pg_catalog,public as $$
declare w uuid;n int:=0;begin
 for w in select id from clinic_reception.workspaces where mode='live' loop n:=n+clinic_reception.weekly_generate(w,null,p_days);end loop;return n;end $$;
revoke all on function clinic_reception.weekly_generate_all(int) from public,anon,authenticated;

-- Managers: list / save a doctor's week (replaces it, drops future generated windows with no booking, regenerates) /
-- propose a week from the current availability for doctors that have none.
create or replace function public.clinic_reception_weekly(p_workspace uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;prov uuid;x jsonb;n int:=0;s time;e time;dw int;
begin
 me:=clinic_reception.access(p_workspace,case when p_action='list' then 'view' else 'manage' end);
 if p_action='list' then
  return jsonb_build_object('slots',coalesce((select jsonb_agg(jsonb_build_object('provider_id',provider_id,'dow',dow,'starts',to_char(starts,'HH24:MI'),'ends',to_char(ends,'HH24:MI')) order by provider_id,dow,starts) from clinic_reception.weekly_slots where workspace_id=p_workspace),'[]'));
 elsif p_action='save' then
  prov:=(p_payload->>'provider_id')::uuid;
  if not exists(select 1 from clinic_reception.providers where id=prov and workspace_id=p_workspace) then raise exception 'اختر الطبيب';end if;
  if jsonb_typeof(p_payload->'slots') is distinct from 'array' or jsonb_array_length(p_payload->'slots')>21 then raise exception 'راجع أيام الجدول';end if;
  delete from clinic_reception.weekly_slots where provider_id=prov;
  for x in select * from jsonb_array_elements(p_payload->'slots') loop
   dw:=(x->>'dow')::int;
   if dw is null or dw not between 0 and 6 or coalesce(x->>'starts','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(x->>'ends','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or x->>'starts'=x->>'ends' then raise exception 'راجع مواعيد البداية والنهاية';end if;
   insert into clinic_reception.weekly_slots(workspace_id,provider_id,dow,starts,ends,created_by) values(p_workspace,prov,dw,(x->>'starts')::time,(x->>'ends')::time,me);
  end loop;
  delete from clinic_reception.availability a where a.provider_id=prov and a.source='weekly' and a.starts_at>now()
   and not exists(select 1 from clinic_reception.appointments ap where ap.provider_id=prov and ap.status not in ('cancelled','no_show') and ap.starts_at<a.ends_at and ap.ends_at>a.starts_at);
  n:=clinic_reception.weekly_generate(p_workspace,prov,28);
  insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id) values(p_workspace,me,'weekly_save',prov);
  return jsonb_build_object('id',prov,'generated',n);
 elsif p_action='propose' then
  -- For each doctor with no week yet: the most frequent (start,end) per weekday in the coming availability.
  for x in select jsonb_build_object('p',q.provider_id,'d',q.wd,'s',q.st,'e',q.en) from (
     select distinct on (g.provider_id,g.wd) g.* from (
       select a.provider_id,extract(dow from (a.starts_at at time zone 'Africa/Cairo'))::int wd,
         to_char(a.starts_at at time zone 'Africa/Cairo','HH24:MI') st,to_char(a.ends_at at time zone 'Africa/Cairo','HH24:MI') en,count(*) c
       from clinic_reception.availability a join clinic_reception.providers p on p.id=a.provider_id and p.active
       where a.workspace_id=p_workspace and a.ends_at>now() and a.source<>'walk_in'
         and not exists(select 1 from clinic_reception.weekly_slots w where w.provider_id=a.provider_id)
       group by 1,2,3,4) g
     order by g.provider_id,g.wd,g.c desc) q loop
   if x->>'s'<>x->>'e' then
    insert into clinic_reception.weekly_slots(workspace_id,provider_id,dow,starts,ends,created_by) values(p_workspace,(x->>'p')::uuid,(x->>'d')::int,(x->>'s')::time,(x->>'e')::time,me) on conflict do nothing;n:=n+1;
   end if;
  end loop;
  perform clinic_reception.weekly_generate(p_workspace,null,28);
  insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id) values(p_workspace,me,'weekly_propose',null);
  return jsonb_build_object('created',n);
 elsif p_action='generate' then
  return jsonb_build_object('generated',clinic_reception.weekly_generate(p_workspace,null,coalesce((p_payload->>'days')::int,28)));
 end if;
 raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_reception_weekly(uuid,text,jsonb) from public,anon;
grant execute on function public.clinic_reception_weekly(uuid,text,jsonb) to authenticated;

-- «حضور بدون ميعاد»: the first free time from now (5-minute steps, within 4 hours) for that doctor and duration; a
-- walk-in availability window is added for exactly that time, then the normal booking runs (all its checks apply).
do $$begin
 if to_regprocedure('clinic_reception.command_before_walk_in(uuid,text,jsonb,uuid)') is null then
  alter function public.clinic_reception_command(uuid,text,jsonb,uuid) rename to command_before_walk_in;
  alter function public.command_before_walk_in(uuid,text,jsonb,uuid) set schema clinic_reception;
 end if;
end $$;
revoke all on function clinic_reception.command_before_walk_in(uuid,text,jsonb,uuid) from public,anon,authenticated;

create or replace function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;prev jsonb;mins int;t timestamptz;e timestamptz;limit_at timestamptz;prov uuid;b jsonb;
begin
 if p_action<>'walk_in' then return clinic_reception.command_before_walk_in(p_workspace,p_action,p_payload,p_token);end if;
 me:=clinic_reception.access(p_workspace,'book');
 select response into prev from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
 if found then return prev;end if;
 prov:=nullif(p_payload->>'provider_id','')::uuid;
 if prov is null or not exists(select 1 from clinic_reception.providers where id=prov and workspace_id=p_workspace and active) then raise exception 'اختر الطبيب';end if;
 mins:=clinic_reception.booking_minutes(p_workspace,p_payload);
 if mins is null or mins<5 then select minutes into mins from clinic_reception.services where id=nullif(p_payload->>'service_id','')::uuid and workspace_id=p_workspace;end if;
 if mins is null then raise exception 'اختر الخدمة';end if;
 t:=to_timestamp(ceil(extract(epoch from now())/300)*300);limit_at:=now()+interval '4 hours';
 while t<limit_at and exists(select 1 from clinic_reception.appointments a where a.provider_id=prov and a.status not in ('cancelled','no_show') and a.starts_at<t+make_interval(mins=>mins) and a.ends_at>t) loop
  t:=t+interval '5 minutes';
 end loop;
 if t>=limit_at then raise exception 'الدكتور محجوز بالكامل في الـ٤ ساعات الجاية؛ اختار دكتور تاني أو ميعاد لاحق';end if;
 e:=t+make_interval(mins=>mins);
 if not exists(select 1 from clinic_reception.availability a where a.provider_id=prov and a.starts_at<=t and a.ends_at>=e) then
  insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at,source) values(p_workspace,prov,t,e,'walk_in') on conflict (provider_id,starts_at) do update set ends_at=greatest(clinic_reception.availability.ends_at,excluded.ends_at);
 end if;
 b:=(p_payload-'walk_in')||jsonb_build_object('starts_at',t,'source',coalesce(nullif(p_payload->>'source',''),'walk_in'));
 return clinic_reception.command_before_walk_in(p_workspace,'book',b,p_token)||jsonb_build_object('starts_at',t,'walk_in',true);
end $$;
revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid) to authenticated;
