-- طلبات تصميم Claude Creative ("نفّذ التصميم")
-- الموظف/مسؤول الاعتماد يطلب من شاشة المادة، ومهمة Claude المجدولة (كل ساعة) بتصمم أو تمنتج
-- وتوصّل المادة للاعتماد النهائي بس. الاعتماد بضغطة من إنسان، وبعدها Claude يجدولها في الميعاد اللي اقترحه.
create table if not exists public.claude_design_requests (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  style text not null default 'photo' check (style in ('photo', 'illustration')),
  requested_by uuid references public.admins(id),
  status text not null default 'pending' check (status in ('pending', 'working', 'done', 'failed', 'scheduled')),
  note text,
  suggested_publish_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists claude_design_requests_one_open
  on public.claude_design_requests (content_id) where status in ('pending', 'working');
alter table public.claude_design_requests enable row level security;

drop policy if exists claude_design_requests_read on public.claude_design_requests;
create policy claude_design_requests_read on public.claude_design_requests
  for select to authenticated using (public.my_admin_id() is not null);

drop policy if exists claude_design_requests_insert on public.claude_design_requests;
create policy claude_design_requests_insert on public.claude_design_requests
  for insert to authenticated
  with check (requested_by = public.my_admin_id() and status = 'pending');
-- التحديث (working/done/failed/scheduled) بيتم من مهمة Claude بصلاحية الخادم فقط.
