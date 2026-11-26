-- «امنع تكرار العد» (owner 2026-11-25): Maryam's 24/11 count was IDENTICAL to her 22/11 count (200×5, 100, 50, 20×2) with no receipts —
-- a remembered / repeated count. Client: count inputs get autocomplete="off". Server (this file): a READ-ONLY check the count gate calls
-- before a handover: is the count the cashier just entered exactly the same (every denomination) as her previous ended collection shift?
-- Returns {same, last_at} only — no amounts, no expected cash (the count stays blind). Caller: the shift's own cashier, or a reviewer.
-- Rollback: supabase/rollbacks/20261126020000_count_repeat_check.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_finance_count_repeat(uuid,jsonb)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function public.clinic_finance_count_repeat(p_shift uuid, p_counts jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); s clinic_finance.shifts%rowtype; prev record; a jsonb; b jsonb;
begin
  if me is null then raise exception 'سجّل الدخول الأول' using errcode = '42501'; end if;
  select * into s from clinic_finance.shifts where id = p_shift;
  if not found or s.is_main then raise exception 'اختر وردية تحصيل'; end if;
  if s.cashier_id <> me and not clinic_finance.allowed('review') then raise exception 'الجرد ده لصاحب الوردية' using errcode = '42501'; end if;
  if jsonb_typeof(p_counts) is distinct from 'object' then return jsonb_build_object('same', false); end if;
  -- normalise: only denominations with a positive whole count, as integers
  select coalesce(jsonb_object_agg(key, value::bigint), '{}'::jsonb) into a
    from jsonb_each_text(p_counts) where key in ('200','100','50','20','10','5','1','0.5','0.25') and value ~ '^[0-9]{1,7}$' and value::bigint > 0;
  if a = '{}'::jsonb then return jsonb_build_object('same', false); end if;
  select x.id, coalesce(x.end_counts, x.denominations) counts, coalesce(x.ended_at, x.closed_at) at into prev
    from clinic_finance.shifts x
   where x.cashier_id = s.cashier_id and x.id <> s.id and not x.is_main and coalesce(x.ended_at, x.closed_at) is not null
     and coalesce(x.ended_at, x.closed_at) < coalesce(s.ended_at, now())
   order by coalesce(x.ended_at, x.closed_at) desc limit 1;
  if prev.id is null or jsonb_typeof(prev.counts) is distinct from 'object' then return jsonb_build_object('same', false); end if;
  select coalesce(jsonb_object_agg(key, value::bigint), '{}'::jsonb) into b
    from jsonb_each_text(prev.counts) where key in ('200','100','50','20','10','5','1','0.5','0.25') and value ~ '^[0-9]{1,7}$' and value::bigint > 0;
  return jsonb_build_object('same', a = b, 'last_at', case when a = b then prev.at end);
end $$;
revoke all on function public.clinic_finance_count_repeat(uuid, jsonb) from public, anon;
grant execute on function public.clinic_finance_count_repeat(uuid, jsonb) to authenticated;

commit;
