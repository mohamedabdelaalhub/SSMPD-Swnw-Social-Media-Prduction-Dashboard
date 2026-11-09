-- ملفات يرفعها الموظف مع طلب تصميم Claude Creative (2026-11-10، طلب محمد):
--   use       = صورة تتستخدم جوه التصميم (منتج، جهاز، لوجو شريك، صورة من المركز…)
--   reference = مثال للشكل المطلوب — Claude يعمل نفس الفكرة بهوية الصفحة، مش نسخة منه
-- الملف نفسه في bucket الخاص video-inputs تحت <admin_id>/claude-inputs/<content_id>/… (نفس سياسات الرفع الحالية).
-- مهمة Claude بتقرا الجدول وتنزّل الملفات من البوابة (op=download&bucket=video-inputs).
create table if not exists public.claude_design_inputs (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  kind text not null check (kind in ('use', 'reference')),
  storage_path text not null unique,
  file_name text not null,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now()
);
create index if not exists claude_design_inputs_content on public.claude_design_inputs (content_id, created_at);
alter table public.claude_design_inputs enable row level security;
revoke all on public.claude_design_inputs from anon;
grant select, insert, delete on public.claude_design_inputs to authenticated;

drop policy if exists claude_design_inputs_read on public.claude_design_inputs;
create policy claude_design_inputs_read on public.claude_design_inputs
  for select to authenticated using (public.my_admin_id() is not null);

drop policy if exists claude_design_inputs_insert on public.claude_design_inputs;
create policy claude_design_inputs_insert on public.claude_design_inputs
  for insert to authenticated
  with check (
    created_by = public.my_admin_id()
    and storage_path like public.my_admin_id()::text || '/claude-inputs/' || content_id::text || '/%'
  );

drop policy if exists claude_design_inputs_delete on public.claude_design_inputs;
create policy claude_design_inputs_delete on public.claude_design_inputs
  for delete to authenticated
  using (created_by = public.my_admin_id() or public.can_manage_all_content());
