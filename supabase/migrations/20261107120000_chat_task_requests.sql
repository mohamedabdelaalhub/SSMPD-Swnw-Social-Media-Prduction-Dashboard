-- طلبات مهام من شات الفريق لـ Claude Creative (2026-11-07)
-- المستخدم يضغط «حوّل إلى مهمة» في الشات ⇒ صف في chat_task_requests (بصلاحياته هو).
-- Claude Creative (المهمة المجدولة كل ساعة) يقرأ الطلبات المعلقة، يختار المشروع والشخص المناسب، وينشئ المهمة
-- بـ claude_task_create (بنفس العدّادات والحراسة: لازم المسؤول عضو في المشروع) ثم يقفل الطلب.
-- لا صلاحيات جديدة لأي وكيل ولا تغيير على claude_task_create. إضافي فقط (جدول + دالة).

create table if not exists public.chat_task_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.admins(id) on delete cascade,
  title text not null check (length(trim(title)) between 2 and 160),
  body text not null check (length(trim(body)) between 5 and 8000),
  hint text check (hint is null or length(hint) <= 300),
  source text not null default 'server-chat',
  status text not null default 'pending' check (status in ('pending','working','done','failed','rejected')),
  note text,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_task_requests_open on public.chat_task_requests(created_at) where status in ('pending','working');
create index if not exists chat_task_requests_user_day on public.chat_task_requests(requested_by, created_at);
alter table public.chat_task_requests enable row level security;
drop policy if exists chat_task_requests_read on public.chat_task_requests;
create policy chat_task_requests_read on public.chat_task_requests for select to authenticated
  using (public.can_manage_all_content() or requested_by = public.my_admin_id());
-- لا سياسات كتابة: الإدخال من الدالة أدناه فقط، وتحديث الحالة من Claude Creative بصلاحية الخادم (MCP SQL) فقط.

create or replace function public.chat_task_request_submit(p_title text, p_body text, p_hint text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare me uuid := public.my_admin_id(); v_id uuid;
begin
  if me is null then raise exception 'سجّل الدخول أولًا'; end if;
  if not public.finance_module_allowed('tasks','view') then raise exception 'مفيش صلاحية على المهام'; end if;
  if (select count(*) from public.chat_task_requests where requested_by = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'وصلت الحد اليومي لطلبات المهام (20)';
  end if;
  insert into public.chat_task_requests(requested_by, title, body, hint)
  values (me, left(trim(p_title), 160), left(trim(p_body), 8000), nullif(left(trim(coalesce(p_hint,'')), 300), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.chat_task_request_submit(text, text, text) from public, anon;
grant execute on function public.chat_task_request_submit(text, text, text) to authenticated;
