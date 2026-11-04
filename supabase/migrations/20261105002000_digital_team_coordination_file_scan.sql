-- Additive SWNW digital-agent coordination and automatic task-attachment scanning.
-- No changes to human admins, Claude capabilities, WhatsApp or booking flows.
create table if not exists public.digital_team_dispatches (
 id uuid primary key default gen_random_uuid(),
 batch_id uuid not null default gen_random_uuid(),
 parent_dispatch_id uuid references public.digital_team_dispatches(id) on delete set null,
 from_agent_code text references public.digital_team_members(code),
 recipient_code text not null references public.digital_team_members(code),
 created_by uuid references public.admins(id) on delete set null,
 message_kind text not null check(message_kind in ('question','instruction','task','handoff')),
 body text not null check(char_length(btrim(body)) between 3 and 4000),
 state text not null default 'queued' check(state in
  ('queued','acknowledged','analyzing','analysis_complete','awaiting_runtime','blocked','failed','execution_verified')),
 execution_scope text not null default 'advisory_only' check(execution_scope in ('advisory_only','runtime_authorized')),
 analysis text,
 blocked_reason text,
 receipt_at timestamptz,
 analysis_at timestamptz,
 runtime_execution_at timestamptz,
 retry_count integer not null default 0 check(retry_count between 0 and 10),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (state <> 'execution_verified' or (runtime_execution_at is not null and execution_scope='runtime_authorized'))
);
create index if not exists dt_dispatch_created on public.digital_team_dispatches(created_at desc);
create index if not exists dt_dispatch_batch on public.digital_team_dispatches(batch_id,created_at);

create table if not exists public.digital_team_events (
 id uuid primary key default gen_random_uuid(),
 dispatch_id uuid not null references public.digital_team_dispatches(id) on delete cascade,
 from_agent_code text references public.digital_team_members(code),
 to_agent_code text references public.digital_team_members(code),
 message_type text not null check(message_type in
   ('question','instruction','task','acknowledgement','answer','status','handoff_request','handoff_answer','analysis_complete','blocked','runtime_receipt','execution_report')),
 content text not null check(char_length(btrim(content)) between 2 and 6000),
 provenance text not null check(provenance in ('owner','agent_ai','system','external_verified')),
 execution_verified boolean not null default false,
 created_at timestamptz not null default now(),
 check (not execution_verified or provenance='external_verified'),
 check (message_type<>'execution_report' or provenance='external_verified')
);
create index if not exists dt_events_created on public.digital_team_events(created_at desc);
create index if not exists dt_events_dispatch on public.digital_team_events(dispatch_id,created_at);

alter table public.digital_team_dispatches enable row level security;
alter table public.digital_team_events enable row level security;
revoke all on public.digital_team_dispatches, public.digital_team_events from public,anon,authenticated;
grant select on public.digital_team_dispatches,public.digital_team_events to authenticated;
create policy "Owner views digital team dispatches" on public.digital_team_dispatches for select to authenticated
using (exists(
 select 1 from public.administrative_assistant_config c join public.admins a on a.id=c.owner_admin_id
 where c.id=1 and a.active and a.user_id=(select auth.uid())
));
create policy "Owner views digital team events" on public.digital_team_events for select to authenticated
using (exists(
 select 1 from public.administrative_assistant_config c join public.admins a on a.id=c.owner_admin_id
 where c.id=1 and a.active and a.user_id=(select auth.uid())
));

create or replace function public.digital_team_send(p_targets text[], p_kind text, p_body text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare actor uuid; owner_id uuid; batch uuid:=gen_random_uuid(); target text; new_id uuid; ids jsonb:='[]'::jsonb;
begin
 select id into actor from public.admins where user_id=auth.uid() and active limit 1;
 select owner_admin_id into owner_id from public.administrative_assistant_config where id=1;
 if actor is null or actor is distinct from owner_id then raise exception 'المرسل يجب أن يكون المالك' using errcode='42501'; end if;
 if p_kind not in ('question','instruction','task') then raise exception 'نوع التوجيه غير مدعوم' using errcode='22023'; end if;
 if char_length(btrim(coalesce(p_body,''))) not between 3 and 4000 then raise exception 'راجع نص الرسالة' using errcode='22023'; end if;
 if coalesce(array_length(p_targets,1),0) not between 1 and 7 then raise exception 'اختر من 1 إلى 7 وكلاء' using errcode='22023'; end if;
 for target in select distinct unnest(p_targets) loop
   if not exists(select 1 from public.digital_team_members where code=target and active) then
     raise exception 'مستلم غير موجود: %',target using errcode='22023';
   end if;
   insert into public.digital_team_dispatches(batch_id,recipient_code,created_by,message_kind,body)
    values(batch,target,actor,p_kind,btrim(p_body)) returning id into new_id;
   insert into public.digital_team_events(dispatch_id,to_agent_code,message_type,content,provenance)
    values(new_id,target,p_kind,btrim(p_body),'owner');
   ids:=ids||jsonb_build_array(new_id);
 end loop;
 return jsonb_build_object('batch_id',batch,'dispatch_ids',ids,'count',jsonb_array_length(ids),
   'message','تم تسجيل الرسائل وإرسالها إلى صندوق التنسيق. التنفيذ الخارجي ليس مفعلا.');
end $$;
revoke all on function public.digital_team_send(text[],text,text) from public,anon,authenticated;
grant execute on function public.digital_team_send(text[],text,text) to authenticated;

-- Independent jobs. The scanner does not change task status or the original submission.
create table if not exists public.task_file_scan_jobs (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete cascade,
 work_result_id uuid references public.task_work_results(id) on delete cascade,
 task_attachment_id uuid references public.task_attachments(id) on delete cascade,
 drive_file_id text not null check(length(drive_file_id) between 5 and 200),
 file_name text not null check(length(file_name) between 1 and 300),
 mime_type text,
 state text not null default 'pending' check(state in
  ('pending','processing','scanned','needs_access','unsupported','restricted','retry','failed')),
 attempt_count integer not null default 0 check(attempt_count between 0 and 10),
 claimed_at timestamptz,
 next_retry_at timestamptz,
 scanned_at timestamptz,
 summary text,
 extracted_rows integer,
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (work_result_id is not null or task_attachment_id is not null)
);
create unique index if not exists task_file_scan_work_unique on public.task_file_scan_jobs(work_result_id,drive_file_id) where work_result_id is not null;
create unique index if not exists task_file_scan_comment_unique on public.task_file_scan_jobs(task_attachment_id) where task_attachment_id is not null;
create index if not exists task_file_scan_state_idx on public.task_file_scan_jobs(state,created_at);
alter table public.task_file_scan_jobs enable row level security;
revoke all on public.task_file_scan_jobs from public,anon,authenticated;
grant select on public.task_file_scan_jobs to authenticated;
create policy "Owner sees task scan status" on public.task_file_scan_jobs for select to authenticated
using (exists(
 select 1 from public.administrative_assistant_config c join public.admins a on a.id=c.owner_admin_id
 where c.id=1 and a.active and a.user_id=(select auth.uid())
));

create or replace function public.task_file_queue_from_result() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare attachment jsonb; fid text;
begin
 if jsonb_typeof(new.attachments) <> 'array' then return new; end if;
 for attachment in select value from jsonb_array_elements(new.attachments) loop
   fid:=attachment->>'file_id';
   if fid ~ '^[A-Za-z0-9_-]{5,200}$' then
    insert into public.task_file_scan_jobs(task_id,work_result_id,drive_file_id,file_name,mime_type)
    values(new.task_id,new.id,fid,left(coalesce(attachment->>'name','مرفق'),300),left(attachment->>'mime',150))
    on conflict do nothing;
   end if;
 end loop;
 return new;
end $$;
revoke all on function public.task_file_queue_from_result() from public,anon,authenticated;
create trigger task_file_autoscan_work after insert on public.task_work_results
for each row execute function public.task_file_queue_from_result();

create or replace function public.task_file_queue_from_comment() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.drive_file_id ~ '^[A-Za-z0-9_-]{5,200}$' then
  insert into public.task_file_scan_jobs(task_id,task_attachment_id,drive_file_id,file_name,mime_type)
  values(new.task_id,new.id,new.drive_file_id,left(new.file_name,300),left(new.mime_type,150))
  on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function public.task_file_queue_from_comment() from public,anon,authenticated;
create trigger task_file_autoscan_comment after insert on public.task_attachments
for each row execute function public.task_file_queue_from_comment();

insert into public.task_file_scan_jobs(task_id,work_result_id,drive_file_id,file_name,mime_type)
select w.task_id,w.id,a->>'file_id',left(coalesce(a->>'name','مرفق'),300),left(a->>'mime',150)
from public.task_work_results w cross join lateral jsonb_array_elements(coalesce(w.attachments,'[]'::jsonb)) a
where (a->>'file_id') ~ '^[A-Za-z0-9_-]{5,200}$'
on conflict do nothing;
insert into public.task_file_scan_jobs(task_id,task_attachment_id,drive_file_id,file_name,mime_type)
select a.task_id,a.id,a.drive_file_id,left(a.file_name,300),left(a.mime_type,150)
from public.task_attachments a
where a.drive_file_id ~ '^[A-Za-z0-9_-]{5,200}$'
on conflict do nothing;

-- Mark already independently verified file evidence as reviewed, without rescanning historical work.
update public.task_file_scan_jobs j set state='scanned',scanned_at=e.extraction_at,
 summary='يوجد مقتطف موثق من Google Drive لهذا التسليم.',updated_at=now()
from public.task_attachment_evidence e
where j.work_result_id=e.work_result_id and j.drive_file_id=e.drive_file_id
 and e.verification_state='verified_content';
