-- Live rollback dry-run for 20261125240000_my_collections_by_method.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- Read-only: as every active reception user with a login, the call returns only keys shift/methods/count/total (no expected cash);
-- a user without an open collection shift gets shift = null. Totals are printed via NOTICE (no patient data).
begin;
-- «اتحصّل في ورديتك حسب طريقة الدفع» (owner «آه ضيفه» 2026-11-25 via UI&UX 4): for the CALLER's own open collection shift only —
-- receipts count + total per payment method (cash / pos / instapay / wallet / bank). READ-ONLY. Deliberately NO expected-cash,
-- drawer balance, payouts or expenses: the shift-end count stays blind (20261125110000 count-check).
-- Receipts = clinic_reception.payments on the shift's reception mirror, or recorded by the cashier during the shift window
-- (same mapping as public.clinic_finance_shift_movements). Nothing for anyone else's shift; no patient data.
-- Rollback: supabase/rollbacks/20261125240000_my_collections_by_method.rollback.sql

do $$ begin
  if to_regprocedure('public.clinic_finance_my_collections()') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function public.clinic_finance_my_collections() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); s record; v jsonb;
begin
  if me is null or not exists (select 1 from public.admins where id = me and active) then raise exception 'سجل الدخول' using errcode = '42501'; end if;
  select fs.id, fs.opened_at, r.name register into s
    from clinic_finance.shifts fs join clinic_finance.registers r on r.id = fs.register_id
   where fs.cashier_id = me and fs.status = 'open' and fs.ended_at is null and not fs.is_main
   order by fs.opened_at desc limit 1;
  if not found then return jsonb_build_object('shift', null, 'methods', '[]'::jsonb, 'count', 0, 'total', 0); end if;
  with p as (
    select rp.id, rp.method, rp.amount from clinic_reception.payments rp
      join clinic_reception.shifts rs on rs.id = rp.shift_id where rs.finance_shift_id = s.id
    union
    select rp.id, rp.method, rp.amount from clinic_reception.payments rp
     where rp.shift_id is null and rp.created_by = me and rp.created_at >= s.opened_at),
  g as (select method, count(*) n, round(sum(amount), 2) total from p group by method)
  select jsonb_build_object(
    'shift', jsonb_build_object('id', s.id, 'register', s.register, 'opened_at', s.opened_at),
    'methods', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'count', n, 'total', total)
                          order by array_position(array['cash','pos','instapay','wallet','bank'], method), method) from g), '[]'::jsonb),
    'count', coalesce((select sum(n) from g), 0), 'total', coalesce((select sum(total) from g), 0))
    into v;
  return v;
end $$;
revoke all on function public.clinic_finance_my_collections() from public, anon;
grant execute on function public.clinic_finance_my_collections() to authenticated;

do $$
declare u record; r jsonb; n int := 0;
begin
  for u in select a.user_id, a.name from public.admins a where a.active and a.user_id is not null and a.role = 'reception' order by a.id loop
    perform set_config('request.jwt.claim.sub', u.user_id::text, true); execute 'set local role authenticated';
    r := public.clinic_finance_my_collections();
    execute 'reset role';
    if (select array_agg(k order by k) from jsonb_object_keys(r) k) <> array['count','methods','shift','total'] then raise exception 'unexpected keys: %', r; end if;
    if r->'shift' <> 'null'::jsonb and (select array_agg(k order by k) from jsonb_object_keys(r->'shift') k) <> array['id','opened_at','register'] then raise exception 'unexpected shift keys: %', r; end if;
    raise notice '% — shift %, % receipts, total %, methods %', u.name, coalesce(r#>>'{shift,register}', 'none'), r->>'count', r->>'total', r->'methods';
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'no reception user with a login'; end if;
  raise notice 'my collections dry-run OK for % reception users', n;
end $$;
rollback;
