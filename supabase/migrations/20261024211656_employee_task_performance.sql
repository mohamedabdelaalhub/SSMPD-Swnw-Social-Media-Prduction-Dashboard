-- Read-only task coaching. No employee ratings, payroll decisions, new grants or notifications are written.
create or replace function public.employee_task_performance(p_period text default 'month',p_from date default null,p_to date default null,p_admin uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.my_admin_id(); subject uuid:=coalesce(p_admin,actor); today date:=(now() at time zone 'Africa/Cairo')::date; first_day date; last_day date; lo timestamptz; hi timestamptz; result jsonb;
begin
 if auth.uid() is null or actor is null or not public.finance_module_allowed('tasks','view') then raise exception 'ليس لديك صلاحية عرض المهام' using errcode='42501';end if;
 if subject<>actor and not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'يمكنك متابعة إنجاز مهامك فقط' using errcode='42501';end if;
 if not exists(select 1 from public.admins where id=subject and active) then raise exception 'حساب الموظف غير متاح';end if;
 case p_period
 when 'day' then first_day:=today;last_day:=today;
 when 'week' then first_day:=today-6;last_day:=today;
 when 'month' then first_day:=date_trunc('month',today)::date;last_day:=today;
 when 'all' then first_day:=null;last_day:=today;
 when 'custom' then
  if p_from is null or p_to is null or p_from>p_to or p_to>today then raise exception 'اختر فترة تنتهي اليوم أو قبله';end if;
  first_day:=p_from;last_day:=p_to;
 else raise exception 'فترة غير صالحة';end case;
 lo:=coalesce(first_day::timestamp at time zone 'Africa/Cairo','-infinity'::timestamptz);
 hi:=least(now(),(last_day+1)::timestamp at time zone 'Africa/Cairo');
 with source as materialized (
  select t.*,p.archived_at from public.tasks t join public.task_projects p on p.id=t.project_id
  where t.assignee_id=subject and (p.archived_at is null or t.status='done')
   and not exists(select 1 from public.tasks child where child.parent_task_id=t.id)
 ), cohort as materialized (
  select * from source t where t.created_at<=hi and (
   (t.due_at>=lo and t.due_at<=hi)
   or (t.status='done' and t.completed_at>=lo and t.completed_at<=hi)
   or (t.status='review' and t.latest_submitted_at>=lo and t.latest_submitted_at<=hi)
   or (last_day=today and t.due_at<lo and t.status not in ('done'))
  )
 ), counts as (
  select count(*) n,count(*) filter(where status='done') done,count(*) filter(where status='review') review,
   count(*) filter(where status not in ('done','review') and due_at<hi) late,
   count(*) filter(where status='revision') revision,count(*) filter(where status='blocked') blocked,
   count(*) filter(where due_at<lo and status<>'done') carryover,
   count(*) filter(where status in ('done','review') and first_submitted_at is not null and first_submission_due_at is not null) timed,
   count(*) filter(where status in ('done','review') and first_submitted_at<=first_submission_due_at) on_time
  from cohort
 ), actions as (
  select t.*,case when status='blocked' then 'اطلب مساعدة وحدد العائق داخل المهمة'
    when status='revision' then 'راجع ملاحظة المدير وعدّل المطلوب ثم سلّم للمراجعة'
    when status='review' then 'بانتظار اعتماد المدير، لا تحتاج إعادة تسليم'
    when due_at is null then 'اتفق مع المسؤول على موعد تسليم وسجّله في المهمة'
    when status='todo' then 'افتح المطلوب وابدأ ثم سجّل تقدمك'
    else 'أكمل المطلوب وأرفق النتيجة ثم سلّم للمراجعة' end action,
   case when status='blocked' then 0 when status='revision' then 1 when due_at<now() and status<>'review' then 2 when status='review' then 5 when due_at is null then 4 else 3 end rank
  from source t where t.archived_at is null and t.status<>'done'
   and (t.id in(select id from cohort) or (last_day=today and (t.due_at is null or t.due_at<now()+interval '7 days')))
 )
 select jsonb_build_object('period',p_period,'from',first_day,'to',last_day,'generated_at',now(),'admin_id',subject,
  'sample',n,'score',case when n>=3 then round((done*100.0+review*75.0)/n) else null end,
  'done',done,'review',review,'late',late,'revision',revision,'blocked',blocked,'carryover',carryover,'timed',timed,'on_time',on_time,
  'undated',(select count(*) from source where due_at is null and status not in ('done','review')),
  'actions_total',(select count(*) from actions),
  'actions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',left(title,180),'status',status,'due_at',due_at,'action',action,'return_note',left(return_note,500)) order by rank,due_at nulls last,id) from (select * from actions order by rank,due_at nulls last,id limit 8) a),'[]'::jsonb),
  'completed_in_period',(select count(*) from source where status='done' and completed_at>=lo and completed_at<=hi)
 ) into result from counts;
 return result;
end $$;
revoke all on function public.employee_task_performance(text,date,date,uuid) from public,anon;
grant execute on function public.employee_task_performance(text,date,date,uuid) to authenticated;
notify pgrst,'reload schema';
