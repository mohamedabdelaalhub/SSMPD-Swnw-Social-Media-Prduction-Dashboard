-- Administrative Assistant task review automation and useful-run reporting.
-- Keeps the general assistant in approval mode while task review has a scoped pre-approved delegation.

insert into public.administrative_assistant_rules(
  title,instruction,scope,action_type,conditions,approval_mode,active,created_by,approved_by,approved_at
)
select
  'مراجعة المهام تلقائيًا',
  'راجع المهام المسلّمة والمتأخرة. اعتمد المكتمل، وأعد الناقص بتعليمات محددة، وعلّق على المتأخر. ارفع للمالك أي قرار مالي أو قانوني أو طبي أو قرار نشر أو حالة لا يمكن التحقق من مرفقاتها.',
  'tasks',
  'task_review_auto',
  jsonb_build_object(
    'review_submitted',true,
    'nudge_overdue',true,
    'owner_decisions_required',jsonb_build_array('finance','legal','medical','publishing','unreadable_attachment')
  ),
  'preapproved',true,c.owner_admin_id,c.owner_admin_id,now()
from public.administrative_assistant_config c
where c.id=1
  and not exists(
    select 1 from public.administrative_assistant_rules r
    where r.action_type='task_review_auto' and r.active
  );

do $$
declare
  v_rule uuid;
  v_secret text;
  v_job record;
begin
  select id into v_rule
  from public.administrative_assistant_rules
  where action_type='task_review_auto' and active and approval_mode='preapproved'
  order by created_at desc limit 1;

  if v_rule is null then
    raise exception 'task_review_auto rule missing';
  end if;

  v_secret := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  update public.administrative_assistant_rules
  set conditions=coalesce(conditions,'{}'::jsonb) || jsonb_build_object(
        'cron_secret_hash',encode(digest(v_secret,'sha256'),'hex')
      ),
      updated_at=now()
  where id=v_rule;

  for v_job in select jobid from cron.job where jobname='assistant-task-review-10m' loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'assistant-task-review-10m',
    '*/10 * * * *',
    format($cmd$
      select net.http_post(
        url := 'https://uuijfbpgvtdxgaosqpxo.supabase.co/functions/v1/assistant-review-tasks',
        headers := jsonb_build_object(
          'X-Assistant-Cron', %L,
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 150000
      );
    $cmd$,v_secret)
  );
end $$;

create or replace function public.administrative_assistant_dashboard()
returns jsonb
language sql
stable security definer
set search_path to 'pg_catalog','public'
as $$
  select case when public.business_manager() then jsonb_build_object(
    'config',(select to_jsonb(c) from public.administrative_assistant_config c where id=1),
    'counts',jsonb_build_object(
      'pending',(select count(*) from public.administrative_assistant_requests where status in ('pending','reviewing')),
      'waiting_owner',(select count(*) from public.administrative_assistant_requests where status='waiting_owner'),
      'urgent',(select count(*) from public.administrative_assistant_requests where priority in ('urgent','critical') and status not in ('closed','executed','rejected'))
    ),
    'requests',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
      from (select * from public.administrative_assistant_requests
            where status not in ('closed','executed','rejected')
            order by created_at desc limit 50) x),
    'rules',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb)
      from public.administrative_assistant_rules r where active),
    'claude_pending',(select count(*) from public.claude_task_requests where status in ('pending','processing')),
    'task_overdue',(select count(*) from public.tasks where status not in ('done','approved','completed') and due_at is not null and due_at < now()),
    'payroll_attention',(select count(*) from jsonb_array_elements(public.administrative_assistant_payroll_audit(date_trunc('month',current_date)::date)) e where coalesce((e->>'requires_owner_review')::boolean,false)),
    'payroll_pending',(select count(*) from clinic_finance.business_requests where kind='payroll' and status='pending' and coalesce(nullif(payload->>'month','')::date,date_trunc('month',created_at)::date)=date_trunc('month',current_date)::date),
    'task_review_last',coalesce(
      (select detail from public.administrative_assistant_audit
       where event_type='task_review_run'
         and (coalesce((detail->>'approved')::int,0)+coalesce((detail->>'returned')::int,0)+coalesce((detail->>'needs_owner')::int,0)+coalesce((detail->>'overdue_nudged')::int,0))>0
       order by at desc limit 1),
      (select detail from public.administrative_assistant_audit where event_type='task_review_run' order by at desc limit 1)
    )
  ) else jsonb_build_object('error','forbidden') end;
$$;
