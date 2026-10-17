-- Additive result storage. Original task permissions, state/timing triggers and reviews remain authoritative.
create table if not exists public.task_work_results (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete cascade,
 author_id uuid not null references public.admins(id),
 request_id uuid not null,
 body text not null default '' check(length(body)<=50000),
 link text not null default '' check(length(link)<=2000),
 attachments jsonb not null default '[]'::jsonb check(jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=10),
 status text not null check(status in ('in_progress','review')),
 created_at timestamptz not null default now(),
 unique(author_id,request_id)
);
create index if not exists task_work_results_task_idx on public.task_work_results(task_id,created_at desc);
alter table public.task_work_results enable row level security;
revoke all on public.task_work_results from public,anon,authenticated;
grant select on public.task_work_results to authenticated;
do $$begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='task_work_results' and policyname='work_task_read') then
  create policy work_task_read on public.task_work_results for select to authenticated
   using(public.finance_module_allowed('tasks','view') and public.task_can_access(task_id));
 end if;
end$$;

create or replace function public.task_submit_work(p_task_id uuid,p_request_id uuid,p_status text,p_body text,p_link text,p_attachments jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.my_admin_id();task public.tasks%rowtype;prior public.task_work_results%rowtype;item jsonb;result_id uuid;
 body text:=trim(coalesce(p_body,''));link text:=trim(coalesce(p_link,''));atts jsonb:=coalesce(p_attachments,'[]'::jsonb);summary text;
begin
 if auth.uid() is null or actor is null or not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية تحديث المهام';end if;
 select * into task from public.tasks where id=p_task_id for update;
 if not found or task.assignee_id is distinct from actor or not public.task_can_access(p_task_id) then raise exception 'المهمة غير مسندة إليك';end if;
 if p_request_id is null or p_status is null or p_status not in ('in_progress','review') then raise exception 'طلب التسليم غير صالح';end if;
 -- Retry a committed result without repeating updates, notifications, files, or first-delivery timing.
 select * into prior from public.task_work_results where author_id=actor and request_id=p_request_id;
 if found then
  if prior.task_id<>p_task_id or prior.status<>p_status or prior.body<>body or prior.link<>link or prior.attachments<>atts then raise exception 'مفتاح التسليم مستخدم لنتيجة أخرى';end if;
  return prior.id;
 end if;
 if task.status in ('done','review') then raise exception 'المهمة مكتملة أو بانتظار المراجعة';end if;
 if length(body)>50000 or length(link)>2000 or jsonb_typeof(atts)<>'array' or jsonb_array_length(atts)>10 then raise exception 'راجع طول النص والرابط وعدد الملفات';end if;
 if body='' and link='' and jsonb_array_length(atts)=0 then raise exception 'اكتب شغلك أو أضف ملفًا أو رابطًا';end if;
 if link<>'' and link !~ '^https?://[^[:space:]]+$' then raise exception 'رابط الشغل غير صالح';end if;
 for item in select * from jsonb_array_elements(atts) loop
  if jsonb_typeof(item)<>'object' or coalesce(item->>'url','') !~ '^https://(drive|docs)[.]google[.]com/[^[:space:]]+$'
     or length(trim(coalesce(item->>'name','')))=0 or length(item->>'name')>200
     or coalesce(item->>'size','') !~ '^[0-9]{1,8}$' or (item->>'size')::bigint>10485760 then
   raise exception 'بيانات المرفق غير صالحة';
  end if;
 end loop;
 if p_status='review' and exists(select 1 from public.tasks where parent_task_id=p_task_id and status<>'done') then raise exception 'سلّم المراحل وانتظر اعتمادها قبل تسليم المهمة الرئيسية';end if;
 insert into public.task_work_results(task_id,author_id,request_id,body,link,attachments,status)
 values(p_task_id,actor,p_request_id,body,link,atts,p_status) returning id into result_id;
 summary:=case when p_status='review' then 'تسليم الشغل للمدير' else 'حفظ تقدم العمل' end||E'\n'||left(coalesce(nullif(body,''),'تم إرفاق نتيجة العمل'),1600)
  ||case when link<>'' then E'\nرابط الشغل داخل نتائج المهمة.' else '' end
  ||case when jsonb_array_length(atts)>0 then E'\nالمرفقات داخل نتائج المهمة: '||jsonb_array_length(atts)::text else '' end;
 perform public.task_set_status(p_task_id,p_status,summary);
 return result_id;
end$$;
revoke all on function public.task_submit_work(uuid,uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.task_submit_work(uuid,uuid,text,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
