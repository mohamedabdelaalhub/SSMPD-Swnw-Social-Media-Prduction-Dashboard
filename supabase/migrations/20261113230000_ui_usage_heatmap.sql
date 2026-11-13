-- استخدام الشاشات (heatmap) — موافقة المالك 2026-11-13. إضافي فقط.
-- بنعدّ فتح التابات والضغط على الأزرار لكل «دور» في اليوم، من غير ما نسجل مين الموظف، ومن غير أي بيانات مرضى.
-- الواجهة بتجمّع العدّادات وتبعتها مرة كل 10 دقايق (assets/js/usage-heatmap.js).
-- التراجع: supabase/rollbacks/20261113230000_ui_usage_heatmap.rollback.sql
create table if not exists public.ui_usage_daily (
  day date not null default (now() at time zone 'Africa/Cairo')::date,
  role text not null,
  area text not null,
  element text not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (day, role, area, element)
);
alter table public.ui_usage_daily enable row level security;
-- مفيش سياسات قراءة/كتابة مباشرة للمستخدمين: الكتابة من الدالة بس، والقراءة للسيرفر (service_role / postgres).
revoke all on public.ui_usage_daily from public, anon, authenticated;

create or replace function public.ui_usage_track(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare r text; it jsonb; n int := 0; d date := (now() at time zone 'Africa/Cairo')::date;
begin
  select a.role into r from public.admins a where a.user_id = auth.uid() and a.active limit 1;
  if r is null then return 0; end if;
  if jsonb_typeof(p_items) <> 'array' then return 0; end if;
  for it in select value from jsonb_array_elements(p_items) limit 300 loop
    continue when coalesce(length(it->>'a'),0) not between 1 and 40 or coalesce(length(it->>'e'),0) not between 1 and 80;
    insert into public.ui_usage_daily(day, role, area, element, hits)
    values (d, r, it->>'a', it->>'e', least(greatest(coalesce((it->>'n')::int,1),1),500))
    on conflict (day, role, area, element) do update set hits = public.ui_usage_daily.hits + excluded.hits;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.ui_usage_track(jsonb) from public, anon;
grant execute on function public.ui_usage_track(jsonb) to authenticated;
