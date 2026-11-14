-- استخدام الداشبورد لكل موظف (موافقة المالك 2026-11-14: «ايوة للاتنين» = نسجل لكل موظف + نبلغ الموظفين).
-- إضافي: جدول جديد بالموظف، والجدول القديم (بالدور) زي ما هو. الموظف بيشوف رسالة مرة واحدة في الداشبورد إن استخدامه بيتسجل.
-- مفيش بيانات مرضى: بس اسم الصفحة والزرار وعدد الضغطات في اليوم.
-- التراجع: supabase/rollbacks/20261114000000_ui_usage_per_employee.rollback.sql
create table if not exists public.ui_usage_daily_admin (
  day date not null,
  admin_id uuid not null references public.admins(id) on delete cascade,
  role text not null,
  area text not null,
  element text not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (day, admin_id, area, element)
);
alter table public.ui_usage_daily_admin enable row level security;
revoke all on public.ui_usage_daily_admin from public, anon, authenticated;

create or replace function public.ui_usage_track(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare r text; aid uuid; it jsonb; n int := 0; d date := (now() at time zone 'Africa/Cairo')::date; h int;
begin
  select a.role, a.id into r, aid from public.admins a where a.user_id = auth.uid() and a.active
    and lower(a.email) not like 'swnwclinics+%@gmail.com' limit 1;  -- حسابات التجربة ما تتحسبش
  if r is null then return 0; end if;
  if jsonb_typeof(p_items) <> 'array' then return 0; end if;
  for it in select value from jsonb_array_elements(p_items) limit 300 loop
    continue when coalesce(length(it->>'a'),0) not between 1 and 40 or coalesce(length(it->>'e'),0) not between 1 and 80;
    h := least(greatest(coalesce((it->>'n')::int,1),1),500);
    insert into public.ui_usage_daily(day, role, area, element, hits) values (d, r, it->>'a', it->>'e', h)
    on conflict (day, role, area, element) do update set hits = public.ui_usage_daily.hits + excluded.hits;
    insert into public.ui_usage_daily_admin(day, admin_id, role, area, element, hits) values (d, aid, r, it->>'a', it->>'e', h)
    on conflict (day, admin_id, area, element) do update set hits = public.ui_usage_daily_admin.hits + excluded.hits, role = excluded.role;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.ui_usage_track(jsonb) from public, anon;
grant execute on function public.ui_usage_track(jsonb) to authenticated;
