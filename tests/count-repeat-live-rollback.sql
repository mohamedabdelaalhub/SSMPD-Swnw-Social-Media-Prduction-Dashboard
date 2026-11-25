-- Live rollback dry-run for 20261126020000_count_repeat_check.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept. READ-ONLY function.
-- For each reception cashier with an open collection shift: her previous shift's own counts → same=true (when it had cash),
-- the same counts +1 note of 200 → same=false; only keys same/last_at; another reception user is refused.
begin;
-- «امنع تكرار العد» (owner 2026-11-25): Maryam's 24/11 count was IDENTICAL to her 22/11 count (200×5, 100, 50, 20×2) with no receipts —
-- a remembered / repeated count. Client: count inputs get autocomplete="off". Server (this file): a READ-ONLY check the count gate calls
-- before a handover: is the count the cashier just entered exactly the same (every denomination) as her previous ended collection shift?
-- Returns {same, last_at} only — no amounts, no expected cash (the count stays blind). Caller: the shift's own cashier, or a reviewer.
-- Rollback: supabase/rollbacks/20261126020000_count_repeat_check.rollback.sql

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

do $$
declare x record; other uuid; prev jsonb; r jsonb; n int := 0; ok boolean; c jsonb;
begin
  for x in select s.id sid, s.cashier_id, a.user_id, a.name from clinic_finance.shifts s join public.admins a on a.id = s.cashier_id
            where s.status = 'open' and s.ended_at is null and not s.is_main and a.active and a.user_id is not null and a.role = 'reception' loop
    select coalesce(p.end_counts, p.denominations) into prev from clinic_finance.shifts p
     where p.cashier_id = x.cashier_id and p.id <> x.sid and not p.is_main and coalesce(p.ended_at, p.closed_at) is not null
     order by coalesce(p.ended_at, p.closed_at) desc limit 1;
    perform set_config('request.jwt.claim.sub', x.user_id::text, true); execute 'set local role authenticated';
    if prev is not null and exists (select 1 from jsonb_each_text(prev) where value ~ '^[0-9]+$' and value::bigint > 0) then
      r := public.clinic_finance_count_repeat(x.sid, prev);
      if not (r->>'same')::boolean then raise exception '% previous counts not recognised: %', x.name, r; end if;
      c := prev || jsonb_build_object('200', (coalesce(nullif(prev->>'200', ''), '0')::bigint + 1)::text);
      r := public.clinic_finance_count_repeat(x.sid, c);
      if (r->>'same')::boolean then raise exception '% changed counts flagged same', x.name; end if;
    else
      r := public.clinic_finance_count_repeat(x.sid, '{"200":"1"}'::jsonb);
    end if;
    if exists (select 1 from jsonb_object_keys(r) k where k not in ('same', 'last_at')) then raise exception 'unexpected keys %', r; end if;
    execute 'reset role';
    select a.user_id into other from public.admins a where a.active and a.user_id is not null and a.role = 'reception' and a.id <> x.cashier_id order by a.id limit 1;
    if other is not null then
      perform set_config('request.jwt.claim.sub', other::text, true);
      ok := clinic_finance.allowed('review');   -- (as the owner, before the role switch) a reception user holding the review grant may legitimately check
      execute 'set local role authenticated';
      if not ok then begin perform public.clinic_finance_count_repeat(x.sid, '{"200":"1"}'::jsonb); exception when others then ok := sqlerrm like '%لصاحب الوردية%'; end;
        if not ok then raise exception 'another reception user could check % shift', x.name; end if; end if;
      execute 'reset role';
    end if;
    raise notice '% — previous counts %, check OK', x.name, coalesce(prev::text, 'none');
    n := n + 1;
  end loop;
  raise notice 'count repeat dry-run OK for % open reception shifts', n;
end $$;
rollback;
