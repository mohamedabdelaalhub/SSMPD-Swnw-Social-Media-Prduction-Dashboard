-- تراجع 20261114000000: يرجّع الدالة للتسجيل بالدور بس ويشيل جدول الموظفين.
create or replace function public.ui_usage_track(p_items jsonb)
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare r text; it jsonb; n int := 0; d date := (now() at time zone 'Africa/Cairo')::date;
begin
  select a.role into r from public.admins a where a.user_id = auth.uid() and a.active
    and lower(a.email) not like 'swnwclinics+%@gmail.com' limit 1;
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
drop table if exists public.ui_usage_daily_admin;
