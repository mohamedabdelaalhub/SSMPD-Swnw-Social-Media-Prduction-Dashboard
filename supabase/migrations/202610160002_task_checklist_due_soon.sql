-- المهام: تنبيه "الموعد خلال 24 ساعة" + قوائم مهام صغيرة (checklist). مُطبَّق على القاعدة الحية.
alter table public.task_notifications drop constraint if exists task_notifications_kind_check;
alter table public.task_notifications add constraint task_notifications_kind_check
  check (kind in ('assigned','status','review','returned','overdue','comment','due_soon'));

create or replace function public.task_notify_due_soon() returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  insert into public.task_notifications(recipient_id, task_id, kind, message, reference_date)
    select t.assignee_id, t.id, 'due_soon', 'موعد المهمة خلال 24 ساعة: ' || t.title, current_date
      from public.tasks t
     where t.assignee_id is not null and t.status <> 'done'
       and t.due_at > now() and t.due_at <= now() + interval '24 hours'
    on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.task_notify_due_soon() from public, anon, authenticated;
select cron.schedule('ssmpd-task-due-soon', '0 * * * *', $c$select public.task_notify_due_soon();$c$);

create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 300),
  done boolean not null default false,
  done_by uuid references public.admins(id),
  done_at timestamptz,
  sort_order integer not null default 0,
  removed_at timestamptz,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now()
);
create index if not exists task_checklist_task_idx on public.task_checklist_items(task_id, sort_order, created_at);
alter table public.task_checklist_items enable row level security;
drop policy if exists task_checklist_read on public.task_checklist_items;
create policy task_checklist_read on public.task_checklist_items for select using (public.task_can_access(task_id));
-- الدوال: task_checklist_list / _counts / _add / _toggle / _remove (SECURITY DEFINER، حذف ناعم عبر removed_at) — انظر القاعدة الحية.
