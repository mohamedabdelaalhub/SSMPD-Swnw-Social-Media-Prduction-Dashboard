-- Live rollback test for 20261123100000_reception_shift_guard.sql («وردية الخزينة — قفل بعد ساعة»), after main chat's blocker:
-- stale shift → «اقفل الوردية القديمة» (end_shift to main) → no stale lock → «افتح وردية» works at once (old one waits for receipt /
-- review) → still only ONE open shift. Run the WHOLE file as postgres: ONE transaction ending in ROLLBACK; apply the migration body at the
-- marked spot first (without its own begin / commit) if it is not applied. Acts as Mazen (reception, sub f0891d2c-…). Inside the transaction
-- only: his open collection shift is aged 20 h and handed over, and a new one is opened. Nothing is kept. Last output = one result table.
begin;
-- >>> apply supabase/migrations/20261123100000_reception_shift_guard.sql here (without its own begin / commit) if not applied yet <<<

create temp table guard_live_results(n serial, step text, expected text, actual text, ok boolean);

do $$
declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; s clinic_finance.shifts%rowtype; g jsonb; r jsonb; err text;
  exp numeric; cnt jsonb; reg uuid;
begin
  select id into me from public.admins where user_id = sub;
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if to_regprocedure('clinic_reception.command_before_shift_guard(uuid,text,jsonb,uuid)') is null then raise exception 'apply 20261123100000 first (inside this transaction)'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);

  -- his open collection shift (open one from his last register if he has none)
  select * into s from clinic_finance.shifts where cashier_id = me and status = 'open' and ended_at is null and not is_main order by opened_at desc limit 1;
  if s.id is null then
    select register_id into reg from clinic_finance.shifts where cashier_id = me and not is_main order by opened_at desc limit 1;
    execute 'set local role authenticated';
    perform public.clinic_booking_shift('open', jsonb_build_object('register_id', reg), gen_random_uuid());
    execute 'reset role';
    select * into s from clinic_finance.shifts where cashier_id = me and status = 'open' and ended_at is null and not is_main order by opened_at desc limit 1;
  end if;
  reg := s.register_id;

  -- 1) stale: opened 20 hours ago → locked «stale», collect refused
  update clinic_finance.shifts set opened_at = now() - interval '20 hours' where id = s.id;
  execute 'set local role authenticated'; g := public.clinic_reception_shift_guard(); execute 'reset role';
  insert into guard_live_results(step, expected, actual, ok) values ('1 stale shift → guard', 'locked stale', g::text, (g->>'locked')::boolean and g->>'reason' = 'stale');
  begin
    execute 'set local role authenticated'; perform public.clinic_reception_command(w, 'collect', '{}'::jsonb, gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into guard_live_results(step, expected, actual, ok) values ('1 collect while stale', 'ورديتك من يوم قبل كده لسه مفتوحة…', err, err like 'ورديتك من يوم قبل كده%');

  -- 2) «سلّم الوردية» = clinic_finance_treasury_command('end_shift') with the drawer count
  exp := greatest(floor(clinic_finance.shift_cash(s.id)), 0);
  cnt := jsonb_build_object('1', exp::bigint::text);
  begin
    execute 'set local role authenticated';
    r := public.clinic_finance_treasury_command('end_shift', jsonb_build_object('shift_id', s.id, 'counts', cnt, 'note', 'اختبار تراجع'), gen_random_uuid());
    execute 'reset role';
    insert into guard_live_results(step, expected, actual, ok) values ('2 end_shift (handover to main)', 'awaiting_receipt (or submitted when 0 cash)', r->>'status', r->>'status' in ('awaiting_receipt', 'submitted'));
  exception when others then execute 'reset role'; insert into guard_live_results(step, expected, actual, ok) values ('2 end_shift', 'works', sqlerrm, false); end;

  -- 3) right after the handover: no stale lock (need_open when the HR shift is due, else not locked)
  execute 'set local role authenticated'; g := public.clinic_reception_shift_guard(); execute 'reset role';
  insert into guard_live_results(step, expected, actual, ok) values ('3 guard after handover', 'not stale (need_open or unlocked)', g::text,
    coalesce(g->>'reason', '') <> 'stale');

  -- 4) «افتح وردية» right away, while the old shift waits for the receipt / review (owner: «علشان الدنيا ما توقفش تماما»)
  begin
    execute 'set local role authenticated';
    r := to_jsonb(public.clinic_booking_shift('open', jsonb_build_object('register_id', reg), gen_random_uuid()));
    g := public.clinic_reception_shift_guard(); execute 'reset role';
    insert into guard_live_results(step, expected, actual, ok) values ('4 «افتح وردية» after the handover', 'new shift opened, guard open / unlocked',
      'new ' || (r #>> '{}') || ' · guard ' || g::text, not (g->>'locked')::boolean and g->>'reason' = 'open');
  exception when others then execute 'reset role'; insert into guard_live_results(step, expected, actual, ok) values ('4 open after handover', 'opened', sqlerrm, false); end;

  -- 5) still ONE open shift: a second open is refused with the Arabic message; the old one still waits (not reviewed)
  begin
    execute 'set local role authenticated'; perform public.clinic_booking_shift('open', jsonb_build_object('register_id', reg), gen_random_uuid()); execute 'reset role'; err := 'opened';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into guard_live_results(step, expected, actual, ok) values ('5 second open refused', 'عندك وردية تانية لسه مفتوحة… / الخزينة دي عليها وردية لسه مفتوحة…', err, err like '%لسه مفتوحة%');
  insert into guard_live_results(step, expected, actual, ok)
    select '5 old shift kept for receipt / review', 'status open+ended or submitted, not reviewed', status || coalesce(' ended ' || ended_at::text, ''), status <> 'reviewed'
      from clinic_finance.shifts where id = s.id;

end $$;

select step, expected, actual, ok from guard_live_results order by n;
rollback;
