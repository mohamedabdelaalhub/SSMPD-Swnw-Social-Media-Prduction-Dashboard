-- Live rollback test for 20261123090000_reception_shift_guard.sql («وردية الخزينة — قفل بعد ساعة»), after main chat's blocker:
-- stale shift → «سلّم الوردية» (end_shift) → NOT locked any more («مستني الاستلام») → a new shift can't open before the review →
-- after the review «افتح وردية» works. Run the WHOLE file as postgres: ONE transaction ending in ROLLBACK; apply the migration body at the
-- marked spot first (without its own begin / commit) if it is not applied. Acts as Mazen (reception, sub f0891d2c-…). Inside the transaction
-- only: his open collection shift is aged 20 h, handed over, then marked reviewed. Nothing is kept. Last output = one result table.
begin;
-- >>> apply supabase/migrations/20261123090000_reception_shift_guard.sql here (without its own begin / commit) if not applied yet <<<

create temp table guard_live_results(n serial, step text, expected text, actual text, ok boolean);

do $$
declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; s clinic_finance.shifts%rowtype; g jsonb; r jsonb; err text;
  exp numeric; cnt jsonb; reg uuid;
begin
  select id into me from public.admins where user_id = sub;
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if to_regprocedure('clinic_reception.command_before_shift_guard(uuid,text,jsonb,uuid)') is null then raise exception 'apply 20261123090000 first (inside this transaction)'; end if;
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

  -- 3) after the handover: NOT locked, waiting card; book / collect are not refused by the guard
  execute 'set local role authenticated'; g := public.clinic_reception_shift_guard(); execute 'reset role';
  insert into guard_live_results(step, expected, actual, ok) values ('3 guard after handover', 'locked false, awaiting_receipt / awaiting_review + receiver', g::text,
    not (g->>'locked')::boolean and g->>'reason' in ('awaiting_receipt', 'awaiting_review'));
  begin
    execute 'set local role authenticated'; perform public.clinic_reception_command(w, 'book', '{}'::jsonb, gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into guard_live_results(step, expected, actual, ok) values ('3 book after handover', 'any error EXCEPT the shift lock (empty payload)', err,
    err not like 'افتح وردية الخزينة الأول%' and err not like 'ورديتك من يوم قبل كده%');

  -- 4) a new shift before the receipt / review: refused by the one-active-shift rule (that's why the card says «مستني…», no «افتح وردية»)
  begin
    execute 'set local role authenticated'; perform public.clinic_booking_shift('open', jsonb_build_object('register_id', reg), gen_random_uuid()); execute 'reset role'; err := 'opened';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into guard_live_results(step, expected, actual, ok) values ('4 open a new shift while waiting', 'refused (active shift not reviewed)', err, err <> 'opened');

  -- 5) receipt + finance review (simulated as postgres, rolled back) → guard asks to open today's shift → «افتح وردية» works
  begin
    update clinic_finance.shifts set status = 'reviewed', reviewed_at = now() where id = s.id;
    execute 'set local role authenticated'; g := public.clinic_reception_shift_guard(); execute 'reset role';
    insert into guard_live_results(step, expected, actual, ok) values ('5 guard after review', 'need_open (or not locked when not due)', g::text,
      coalesce(g->>'reason', '') not in ('stale', 'awaiting_receipt', 'awaiting_review'));
    execute 'set local role authenticated'; r := public.clinic_booking_shift('open', jsonb_build_object('register_id', reg), gen_random_uuid());
    g := public.clinic_reception_shift_guard(); execute 'reset role';
    insert into guard_live_results(step, expected, actual, ok) values ('5 «افتح وردية» after review', 'guard open, not locked', g::text, not (g->>'locked')::boolean and g->>'reason' = 'open');
  exception when others then execute 'reset role'; insert into guard_live_results(step, expected, actual, ok) values ('5 review → open', 'works', sqlerrm, false); end;

end $$;

select step, expected, actual, ok from guard_live_results order by n;
rollback;
