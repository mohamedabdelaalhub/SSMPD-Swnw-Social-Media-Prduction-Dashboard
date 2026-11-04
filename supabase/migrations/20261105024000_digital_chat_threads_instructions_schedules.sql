-- Conversational digital team. Independent of existing agent accounts, bookings, HR, finance and WhatsApp.
create table public.digital_chat_threads(
 id uuid primary key default gen_random_uuid(),
 owner_admin_id uuid not null references public.admins(id),
 title text not null check(length(btrim(title)) between 1 and 120),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.digital_chat_participants(
 thread_id uuid not null references public.digital_chat_threads(id) on delete cascade,
 agent_code text not null references public.digital_team_members(code) on delete restrict,
 joined_at timestamptz not null default now(),
 primary key(thread_id,agent_code)
);
create table public.digital_chat_messages(
 id uuid primary key default gen_random_uuid(),
 thread_id uuid not null references public.digital_chat_threads(id) on delete cascade,
 sender_type text not null check(sender_type in ('owner','agent','system')),
 agent_code text references public.digital_team_members(code),
 kind text not null check(kind in ('chat','question','instruction','task','ack','reply','blocker','result','schedule_notice')),
 body text not null check(length(btrim(body)) between 1 and 5000),
 reply_to_id uuid references public.digital_chat_messages(id) on delete set null,
 process_state text not null default 'complete' check(process_state in ('queued','processing','complete','awaiting_runtime','failed')),
 verification text not null default 'advisory' check(verification in ('owner','advisory','system','runtime_unavailable')),
 created_at timestamptz not null default now(),
 check ((sender_type='agent' and agent_code is not null) or (sender_type='owner' and agent_code is null) or sender_type='system')
);
create index digital_chat_messages_thread on public.digital_chat_messages(thread_id,created_at,id);
create index digital_chat_threads_owner on public.digital_chat_threads(owner_admin_id,updated_at desc);
create table public.digital_chat_instructions(
 id uuid primary key default gen_random_uuid(),
 agent_code text not null references public.digital_team_members(code),
 thread_id uuid not null references public.digital_chat_threads(id) on delete cascade,
 message_id uuid not null references public.digital_chat_messages(id) on delete cascade,
 body text not null check(length(body) between 2 and 4000),
 status text not null check(status in ('advisory_active','awaiting_runtime','disabled')),
 created_by uuid not null references public.admins(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(agent_code,message_id)
);
create index digital_chat_instructions_agent on public.digital_chat_instructions(agent_code,status,created_at desc);
create table public.digital_chat_schedules(
 id uuid primary key default gen_random_uuid(),
 agent_code text not null references public.digital_team_members(code),
 thread_id uuid not null references public.digital_chat_threads(id) on delete cascade,
 message_id uuid not null references public.digital_chat_messages(id) on delete cascade,
 prompt text not null check(length(prompt) between 3 and 4000),
 frequency text not null check(frequency in ('daily','weekly')),
 timezone text not null default 'Asia/Dubai' check(timezone='Asia/Dubai'),
 next_run_at timestamptz not null,
 enabled boolean not null default true,
 status text not null default 'advisory_only' check(status in ('advisory_only','awaiting_runtime','paused')),
 last_run_at timestamptz,
 run_count integer not null default 0,
 created_by uuid not null references public.admins(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(agent_code,message_id)
);
create index digital_chat_schedules_due on public.digital_chat_schedules(next_run_at) where enabled=true and status='advisory_only';
do $$
declare tbl text;
begin
 foreach tbl in array array['digital_chat_threads','digital_chat_participants','digital_chat_messages','digital_chat_instructions','digital_chat_schedules'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated',tbl);
  execute format('grant select on public.%I to authenticated',tbl);
 end loop;
end $$;
create policy "Owner reads chat threads" on public.digital_chat_threads for select to authenticated
 using(exists (select 1 from public.admins a join public.administrative_assistant_config c on c.owner_admin_id=a.id
  where c.id=1 and a.id=owner_admin_id and a.active and a.user_id=(select auth.uid())));
create policy "Owner reads chat participants" on public.digital_chat_participants for select to authenticated
 using(exists(select 1 from public.digital_chat_threads t where t.id=thread_id));
create policy "Owner reads chat messages" on public.digital_chat_messages for select to authenticated
 using(exists(select 1 from public.digital_chat_threads t where t.id=thread_id));
create policy "Owner reads standing instructions" on public.digital_chat_instructions for select to authenticated
 using(exists(select 1 from public.digital_chat_threads t where t.id=thread_id));
create policy "Owner reads schedules" on public.digital_chat_schedules for select to authenticated
 using(exists(select 1 from public.digital_chat_threads t where t.id=thread_id));

create or replace function public.digital_chat_owner()
returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
 select a.id from public.admins a join public.administrative_assistant_config c on c.owner_admin_id=a.id
 where c.id=1 and a.user_id=auth.uid() and a.active limit 1
$$;
revoke all on function public.digital_chat_owner() from public,anon,authenticated;
grant execute on function public.digital_chat_owner() to authenticated;

create or replace function public.digital_chat_create(p_agents text[],p_title text default '')
returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare owner_id uuid; tid uuid; agent text; agents text[];
begin
 owner_id:=public.digital_chat_owner();if owner_id is null then raise exception 'Owner only' using errcode='42501';end if;
 select array_agg(distinct v order by v) into agents from unnest(p_agents) v;
 if coalesce(array_length(agents,1),0) not between 1 and 7 then raise exception 'اختر من 1 إلى 7 وكلاء' using errcode='22023';end if;
 if exists(select 1 from unnest(agents) a where not exists(select 1 from public.digital_team_members m where m.code=a and m.active)) then
  raise exception 'وكيل غير متاح' using errcode='22023';
 end if;
 insert into public.digital_chat_threads(owner_admin_id,title)
 values(owner_id,left(coalesce(nullif(btrim(p_title),''),(select string_agg(m.display_name,' و ' order by m.display_name) from public.digital_team_members m where m.code=any(agents))),120))
 returning id into tid;
 foreach agent in array agents loop
  insert into public.digital_chat_participants(thread_id,agent_code) values(tid,agent);
 end loop;
 return tid;
end $$;
revoke all on function public.digital_chat_create(text[],text) from public,anon,authenticated;
grant execute on function public.digital_chat_create(text[],text) to authenticated;

create or replace function public.digital_chat_send(p_thread uuid,p_kind text,p_body text,
 p_save_instruction boolean default false,p_frequency text default null,p_first_run timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare owner_id uuid; msg uuid; agent text; pending_runtime boolean; instructions_count integer:=0; schedules_count integer:=0;
begin
 owner_id:=public.digital_chat_owner();
 if owner_id is null or not exists(select 1 from public.digital_chat_threads where id=p_thread and owner_admin_id=owner_id)
 then raise exception 'المحادثة غير مصرح بها' using errcode='42501';end if;
 if p_kind not in ('chat','question','instruction','task') then raise exception 'نوع رسالة غير مدعوم' using errcode='22023';end if;
 if length(btrim(coalesce(p_body,''))) not between 1 and 4000 then raise exception 'نص الرسالة غير صالح' using errcode='22023';end if;
 if p_save_instruction and p_kind<>'instruction' then raise exception 'الحفظ في التعليمات يتطلب نوع تعليمات' using errcode='22023';end if;
 if p_frequency is not null then
  if p_kind<>'task' or p_frequency not in ('daily','weekly') or p_first_run is null
    or p_first_run<now()+interval '1 minute' or p_first_run>now()+interval '30 days'
  then raise exception 'بيانات المتابعة الدورية غير صالحة' using errcode='22023';end if;
 end if;
 insert into public.digital_chat_messages(thread_id,sender_type,kind,body,process_state,verification)
 values(p_thread,'owner',p_kind,btrim(p_body),'queued','owner') returning id into msg;
 update public.digital_chat_threads set updated_at=now() where id=p_thread;
 for agent in select agent_code from public.digital_chat_participants where thread_id=p_thread loop
  pending_runtime:=agent in ('hapi','claude_creative');
  if p_save_instruction then
   insert into public.digital_chat_instructions(agent_code,thread_id,message_id,body,status,created_by)
   values(agent,p_thread,msg,btrim(p_body),case when pending_runtime then 'awaiting_runtime' else 'advisory_active' end,owner_id);
   instructions_count:=instructions_count+1;
  end if;
  if p_frequency is not null then
   insert into public.digital_chat_schedules(agent_code,thread_id,message_id,prompt,frequency,next_run_at,enabled,status,created_by)
   values(agent,p_thread,msg,btrim(p_body),p_frequency,p_first_run,not pending_runtime,
     case when pending_runtime then 'awaiting_runtime' else 'advisory_only' end,owner_id);
   schedules_count:=schedules_count+1;
  end if;
 end loop;
 return jsonb_build_object('message_id',msg,'standing_instructions',instructions_count,'scheduled_items',schedules_count,
  'executed',false);
end $$;
revoke all on function public.digital_chat_send(uuid,text,text,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.digital_chat_send(uuid,text,text,boolean,text,timestamptz) to authenticated;

create or replace function public.digital_chat_set_instruction(p_id uuid,p_active boolean)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare owner_id uuid;
begin
 owner_id:=public.digital_chat_owner();if owner_id is null then raise exception 'Owner only' using errcode='42501';end if;
 update public.digital_chat_instructions i set status=case when not p_active then 'disabled'
   when i.agent_code in ('hapi','claude_creative') then 'awaiting_runtime'
   else 'advisory_active' end,updated_at=now()
 where id=p_id and exists(select 1 from public.digital_chat_threads t where t.id=i.thread_id and t.owner_admin_id=owner_id);
 return found;
end $$;
revoke all on function public.digital_chat_set_instruction(uuid,boolean) from public,anon,authenticated;
grant execute on function public.digital_chat_set_instruction(uuid,boolean) to authenticated;

create or replace function public.digital_chat_set_schedule(p_id uuid,p_active boolean)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare owner_id uuid;
begin
 owner_id:=public.digital_chat_owner();if owner_id is null then raise exception 'Owner only' using errcode='42501';end if;
 update public.digital_chat_schedules s set enabled=p_active and s.agent_code not in ('hapi','claude_creative'),
 status=case when not p_active then 'paused' when s.agent_code in ('hapi','claude_creative') then 'awaiting_runtime' else 'advisory_only' end,
 next_run_at=case when p_active and next_run_at<=now() then now()+interval '1 day' else next_run_at end,updated_at=now()
 where id=p_id and exists(select 1 from public.digital_chat_threads t where t.id=s.thread_id and t.owner_admin_id=owner_id);
 return found;
end $$;
revoke all on function public.digital_chat_set_schedule(uuid,boolean) from public,anon,authenticated;
grant execute on function public.digital_chat_set_schedule(uuid,boolean) to authenticated;

-- Only service_role can claim scheduled tasks. Advances next occurrence before async processing to avoid duplicates.
create or replace function public.digital_chat_claim_due(p_limit integer default 3)
returns setof public.digital_chat_schedules language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 if current_user<>'service_role' then raise exception 'Service only' using errcode='42501';end if;
 return query with due as (
  select id from public.digital_chat_schedules where enabled and status='advisory_only' and next_run_at<=now()
  order by next_run_at for update skip locked limit greatest(1,least(p_limit,5))
 )
 update public.digital_chat_schedules s set last_run_at=now(),run_count=run_count+1,
 next_run_at=case when s.frequency='daily' then s.next_run_at+interval '1 day' else s.next_run_at+interval '7 days' end,
 updated_at=now() from due where s.id=due.id returning s.*;
end $$;
revoke all on function public.digital_chat_claim_due(integer) from public,anon,authenticated;
grant execute on function public.digital_chat_claim_due(integer) to service_role;
