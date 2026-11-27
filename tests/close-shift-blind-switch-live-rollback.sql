-- Live rollback test for 20261127020000_close_shift_blind_switch.sql (close-shift screen follows the blind-count switch).
-- Run the WHOLE file as postgres, BEFORE the apply (needs 20261126220000 applied). ONE transaction, ends with ROLLBACK — nothing is kept.
-- Prints only flags and counts (no amounts, no names). Calls public.clinic_booking_snapshot — the RPC behind reception's real
-- «جرد وتسليم الوردية» — as Mazen (reception, auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb) for today, in both switch modes (the switch
-- is flipped inside the txn). The finance-desk path (clinic_finance_snapshot) is checked as the FM/SA if one exists.
-- If Mazen has no open finance shift, one is opened inside the txn on a register with no open shift (rolled back).
-- Output: one table (step, expected, actual, ok).
do $$ begin
  if to_regclass('clinic_finance.blind_count_settings') is null then raise exception 'apply 20261126220000 first'; end if;
  if to_regprocedure('clinic_finance.snapshot_pre_blind_switch(date,date,integer)') is not null then
    raise exception '20261127020000 already applied — this dry-run is for before the apply'; end if;
end $$;

begin;
create temp table csb_live(n serial, step text, expected text, actual text, ok boolean);
create temp table csb_fx(sub uuid, me uuid, shift uuid, opened_here boolean);
do $$ declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; sh uuid; reg uuid; mine boolean := false;
begin
  select id into me from public.admins where user_id = sub;
  if me is null then raise exception 'Mazen admin missing'; end if;
  select id into sh from clinic_finance.shifts where cashier_id = me and status = 'open' order by opened_at desc limit 1;
  if sh is null then
    select r.id into reg from clinic_finance.registers r where not exists (select 1 from clinic_finance.shifts s where s.register_id = r.id and s.status = 'open')
      order by r.name limit 1;
    if reg is null then raise exception 'no free register to open a test shift on'; end if;
    insert into clinic_finance.shifts(register_id, cashier_id, token, opening_book) values (reg, me, gen_random_uuid(), 0) returning id into sh;
    mine := true;
  end if;
  insert into csb_fx values (sub, me, sh, mine);
end $$;

-- before the apply: today's behaviour (blind)
do $$ declare f csb_fx; v jsonb; s jsonb;
begin select * into f from csb_fx;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f.sub::text, true);
  execute 'set local role authenticated';
  begin v := public.clinic_booking_snapshot((now() at time zone 'Africa/Cairo')::date, (now() at time zone 'Africa/Cairo')::date);
  exception when others then execute 'reset role'; raise exception 'Mazen cannot read the booking snapshot: %', sqlerrm; end;
  execute 'reset role';
  select x into s from jsonb_array_elements(coalesce(v->'shifts', '[]')) x where x->>'id' = f.shift::text;
  insert into csb_live(step, expected, actual, ok) values ('0 before apply: Mazen own open shift', 'blind (no expected)' ,
    'shift listed ' || (s is not null) || ' · expected present ' || (s ? 'expected') || ' · test shift opened in txn ' || f.opened_here, s is not null and not (s ? 'expected'));
end $$;

-- >>> MIGRATION BODY: supabase/migrations/20261127020000_close_shift_blind_switch.sql (between its begin; / commit;) >>>

do $$ begin
  if to_regclass('clinic_finance.blind_count_settings') is null then raise exception 'طبق 20261126220000 (إعداد العدّ الأعمى) الأول'; end if;
  if to_regprocedure('clinic_finance.snapshot_pre_blind_switch(date,date,integer)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('public.clinic_finance_snapshot(date,date,integer)') is null or to_regprocedure('public.clinic_booking_snapshot(date,date)') is null
     or to_regprocedure('clinic_finance.shift_cash(uuid)') is null then
    raise exception 'clinic_finance_snapshot / clinic_booking_snapshot / shift_cash غير موجودة'; end if;
end $$;

alter function public.clinic_finance_snapshot(date, date, integer) set schema clinic_finance;
alter function clinic_finance.clinic_finance_snapshot(date, date, integer) rename to snapshot_pre_blind_switch;
revoke all on function clinic_finance.snapshot_pre_blind_switch(date, date, integer) from public, anon, authenticated;
alter function public.clinic_booking_snapshot(date, date) set schema clinic_finance;
alter function clinic_finance.clinic_booking_snapshot(date, date) rename to booking_snapshot_pre_blind_switch;
revoke all on function clinic_finance.booking_snapshot_pre_blind_switch(date, date) from public, anon, authenticated;

-- adds expected + opening_book to the caller's own OPEN shifts that do not carry them yet
create function clinic_finance.blind_reveal(p_shifts jsonb, p_me uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(case
           when s->>'expected' is null and fs.status = 'open' and fs.cashier_id = p_me
           then s || jsonb_build_object('expected', clinic_finance.shift_cash(fs.id), 'opening_book', fs.opening_book, 'blind_off', true)
           else s end order by t.n), '[]'::jsonb)
    from jsonb_array_elements(p_shifts) with ordinality t(s, n)
    left join clinic_finance.shifts fs on fs.id = nullif(t.s->>'id', '')::uuid
$$;
revoke all on function clinic_finance.blind_reveal(jsonb, uuid) from public, anon, authenticated;

create function public.clinic_finance_snapshot(p_from date, p_to date, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb := clinic_finance.snapshot_pre_blind_switch(p_from, p_to, p_offset); me uuid := public.my_admin_id();
  blind boolean := coalesce((select enabled from clinic_finance.blind_count_settings where id), true);
begin
  if v is null or jsonb_typeof(v) <> 'object' then return v; end if;
  v := v || jsonb_build_object('blind_count', blind);
  if blind or me is null then return v; end if;
  if jsonb_typeof(v->'shifts') = 'array' then v := jsonb_set(v, '{shifts}', clinic_finance.blind_reveal(v->'shifts', me)); end if;
  if jsonb_typeof(v->'active_shifts') = 'array' then v := jsonb_set(v, '{active_shifts}', clinic_finance.blind_reveal(v->'active_shifts', me)); end if;
  return v;
end $$;
revoke all on function public.clinic_finance_snapshot(date, date, integer) from public, anon;
grant execute on function public.clinic_finance_snapshot(date, date, integer) to authenticated;

create function public.clinic_booking_snapshot(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb := clinic_finance.booking_snapshot_pre_blind_switch(p_from, p_to); me uuid := public.my_admin_id();
  blind boolean := coalesce((select enabled from clinic_finance.blind_count_settings where id), true);
begin
  if v is null or jsonb_typeof(v) <> 'object' then return v; end if;
  v := v || jsonb_build_object('blind_count', blind);
  if blind or me is null then return v; end if;
  if jsonb_typeof(v->'shifts') = 'array' then v := jsonb_set(v, '{shifts}', clinic_finance.blind_reveal(v->'shifts', me)); end if;
  return v;
end $$;
revoke all on function public.clinic_booking_snapshot(date, date) from public, anon;
grant execute on function public.clinic_booking_snapshot(date, date) to authenticated;

-- <<< END MIGRATION BODY <<<

do $$ declare f csb_fx; v jsonb; s jsonb; others int; mode boolean;
begin select * into f from csb_fx;
  foreach mode in array array[false, true] loop
    update clinic_finance.blind_count_settings set enabled = mode where id;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', f.sub::text, true);
    execute 'set local role authenticated';
    begin v := public.clinic_booking_snapshot((now() at time zone 'Africa/Cairo')::date, (now() at time zone 'Africa/Cairo')::date);
    exception when others then execute 'reset role'; raise exception 'Mazen cannot read the booking snapshot (mode %): %', mode, sqlerrm; end;
    execute 'reset role';
    select x into s from jsonb_array_elements(coalesce(v->'shifts', '[]')) x where x->>'id' = f.shift::text;
    select count(*) into others from jsonb_array_elements(coalesce(v->'shifts', '[]')) x where (x->>'blind_off')::boolean and x->>'cashier_id' <> f.me::text;
    if not mode then
      insert into csb_live(step, expected, actual, ok) values ('1 switch OFF (trial): Mazen own open shift', 'expected = shift cash · opening shown · no other shift revealed',
        'blind_count ' || coalesce(v->>'blind_count','?') || ' · expected present ' || (s ? 'expected') || ' · matches shift_cash ' || ((s->>'expected')::numeric = clinic_finance.shift_cash(f.shift))
          || ' · opening present ' || (s ? 'opening_book') || ' · other shifts revealed ' || others,
        coalesce(v->>'blind_count','') = 'false' and (s->>'expected')::numeric = clinic_finance.shift_cash(f.shift) and s ? 'opening_book' and others = 0);
    else
      insert into csb_live(step, expected, actual, ok) values ('2 switch ON: Mazen own open shift', 'blind as before (no expected, no opening)',
        'blind_count ' || coalesce(v->>'blind_count','?') || ' · expected present ' || (s ? 'expected') || ' · opening present ' || (s ? 'opening_book'),
        coalesce(v->>'blind_count','') = 'true' and not (s ? 'expected') and not (s ? 'opening_book'));
    end if;
  end loop;
  -- the inner function is not callable by users
  execute 'set local role authenticated';
  begin perform clinic_finance.booking_snapshot_pre_blind_switch(current_date, current_date); v := jsonb_build_object('e', 'accepted'); exception when others then v := jsonb_build_object('e', sqlerrm); end;
  execute 'reset role';
  insert into csb_live(step, expected, actual, ok) values ('3 inner function as Mazen', 'permission denied', v->>'e', v->>'e' <> 'accepted');
end $$;

-- finance-desk path: clinic_finance_snapshot as an FM/SA (switch OFF): answers, carries blind_count, reveals no one else's shift
do $$ declare fm uuid; fm_admin uuid; v jsonb; others int; err text := 'ok';
begin
  select a.user_id, a.id into fm, fm_admin from public.admins a where a.active and a.user_id is not null
     and (to_jsonb(a)->>'role') in ('financial_manager', 'super_admin') order by ((to_jsonb(a)->>'role') = 'financial_manager') desc limit 1;
  if fm is null then insert into csb_live(step, expected, actual, ok) values ('3b finance snapshot as FM/SA', 'skipped (none)', 'no FM/SA with a login', true); return; end if;
  update clinic_finance.blind_count_settings set enabled = false where id;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', fm, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', fm::text, true);
  execute 'set local role authenticated';
  begin v := public.clinic_finance_snapshot((now() at time zone 'Africa/Cairo')::date, (now() at time zone 'Africa/Cairo')::date, 0); exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into others from jsonb_array_elements(coalesce(v->'shifts', '[]')) x
   where (x->>'blind_off')::boolean and not exists (select 1 from clinic_finance.shifts fs where fs.id = (x->>'id')::uuid and fs.cashier_id = fm_admin);
  insert into csb_live(step, expected, actual, ok) values ('3b finance snapshot as FM/SA, switch OFF', 'ok · blind_count false · only own shifts get blind_off',
    err || ' · blind_count ' || coalesce(v->>'blind_count', '?') || ' · others revealed ' || others, err = 'ok' and coalesce(v->>'blind_count','') = 'false' and others = 0);
end $$;

-- >>> ROLLBACK BODY: supabase/rollbacks/20261127020000_close_shift_blind_switch.rollback.sql >>>
drop function if exists public.clinic_finance_snapshot(date, date, integer);
drop function if exists public.clinic_booking_snapshot(date, date);
drop function if exists clinic_finance.blind_reveal(jsonb, uuid);
alter function clinic_finance.snapshot_pre_blind_switch(date, date, integer) rename to clinic_finance_snapshot;
alter function clinic_finance.clinic_finance_snapshot(date, date, integer) set schema public;
alter function clinic_finance.booking_snapshot_pre_blind_switch(date, date) rename to clinic_booking_snapshot;
alter function clinic_finance.clinic_booking_snapshot(date, date) set schema public;
revoke all on function public.clinic_finance_snapshot(date, date, integer), public.clinic_booking_snapshot(date, date) from public, anon;
grant execute on function public.clinic_finance_snapshot(date, date, integer), public.clinic_booking_snapshot(date, date) to authenticated;
-- <<< END ROLLBACK BODY <<<
insert into csb_live(step, expected, actual, ok) select '4 rollback body', 'previous snapshot back, wrapper gone',
  coalesce(to_regprocedure('clinic_finance.snapshot_pre_blind_switch(date,date,integer)')::text, 'inners renamed back') || ' · public ' || (to_regprocedure('public.clinic_finance_snapshot(date,date,integer)') is not null and to_regprocedure('public.clinic_booking_snapshot(date,date)') is not null),
  to_regprocedure('clinic_finance.snapshot_pre_blind_switch(date,date,integer)') is null and to_regprocedure('clinic_finance.booking_snapshot_pre_blind_switch(date,date)') is null
  and to_regprocedure('public.clinic_finance_snapshot(date,date,integer)') is not null and to_regprocedure('public.clinic_booking_snapshot(date,date)') is not null;

select step, expected, actual, ok from csb_live order by n;
rollback;
