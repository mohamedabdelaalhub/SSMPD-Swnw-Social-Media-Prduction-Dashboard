-- Live rollback test for the «تسليم» choice (owner 2026-11-24; UI over the EXISTING RPCs + read-only options.main_pending, mig 20261123180000 —
-- paste its body at the marked spot if not applied). ONE transaction ending in
-- ROLLBACK, as postgres. For Mazen and Manar (reception): what the choice would show (clinic_finance_peer_handover 'options': own open
-- shift, colleagues with an open shift, main treasury shift) and, when each target is open, that its button's RPC succeeds:
--   «تسليم للخزينة الرئيسية» → clinic_finance_treasury_command('transfer_request', 1 ج)
--   «تسليم التحصيل لزميل»    → clinic_finance_peer_handover('request', 1 ج)
-- An option whose target has no open shift is shown DISABLED by the UI (no RPC) — reported as «hidden/disabled». When the user's open
-- shift has no cash yet, a REAL 2 ج cash collection (reception 'collect' → patient credit) is recorded first so both RPCs run. Nothing is kept.
begin;
-- >>> apply supabase/migrations/20261123180000_handover_options_pending.sql here (without its own begin / commit) if not applied yet <<<
create temp table ho_live(n serial, who text, step text, expected text, actual text, ok boolean);
do $$
declare a record; o jsonb; r jsonb; err text; err2 text; col jsonb; pend jsonb;
begin
  for a in select x.user_id, coalesce(to_jsonb(x)->>'name', x.id::text) as name from public.admins x
            where x.active and x.user_id is not null and (x.user_id = 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb' or (x.role in ('reception', 'customer_service') and to_jsonb(x)->>'name' like '%منار%'))
            order by 2 loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', a.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', a.user_id::text, true);
    begin
      execute 'set local role authenticated';
      o := public.clinic_finance_peer_handover('options', '{}'::jsonb, null);
      execute 'reset role';
    exception when others then execute 'reset role'; o := null; err := sqlerrm;
      insert into ho_live(who, step, expected, actual, ok) values (a.name, 'options', 'works', err, false); continue; end;
    insert into ho_live(who, step, expected, actual, ok) values (a.name, 'options: own shift / main / colleagues', 'shift present for «تسليم»',
      coalesce(o->'shift'->>'register', 'NO OPEN SHIFT → «تسليم» not shown') || ' · available ' || coalesce(o->'shift'->>'available', '-') ||
      ' · main ' || coalesce(o->'main'->>'name', 'closed') || ' · colleagues ' || coalesce((select string_agg(c->>'name', '، ') from jsonb_array_elements(coalesce(o->'colleagues', '[]')) c), 'none'),
      true);
    -- an open shift with no cash yet: record a REAL 2 ج cash collection into it (reception collect → patient credit), rolled back
    if o->'shift' is not null and jsonb_typeof(o->'shift') = 'object' and coalesce((o->'shift'->>'available')::numeric, 0) < 2 then
      declare ws uuid; rs uuid; pat uuid; me uuid;
      begin
        select x.id into me from public.admins x where x.user_id = a.user_id;
        select s.workspace_id, s.id into ws, rs from clinic_reception.shifts s join clinic_reception.workspaces w on w.id = s.workspace_id and w.mode = 'live'
         where s.cashier_id = me and s.status = 'open' order by s.opened_at desc limit 1;
        select p.id into pat from clinic_reception.patients p where p.workspace_id = ws order by p.created_at limit 1;
        begin
          execute 'set local role authenticated';
          r := public.clinic_reception_command(ws, 'collect', jsonb_build_object('patient_id', pat, 'method', 'cash', 'shift_id', rs, 'amount', '2',
                 'reference', 'HO-TEST-CASH', 'note', 'تجربة تراجع — تحصيل 2 ج علشان يبقى فيه كاش للتسليم'), gen_random_uuid());
          execute 'reset role'; err := 'ok';
        exception when others then execute 'reset role'; err := sqlerrm; end;
        execute 'set local role authenticated'; o := public.clinic_finance_peer_handover('options', '{}'::jsonb, null); execute 'reset role';
        insert into ho_live(who, step, expected, actual, ok) values (a.name, 'real cash collect 2 ج into the open shift (reception collect)', 'ok, available ≥ 2',
          err || ' · available ' || coalesce(o->'shift'->>'available', '-'), err = 'ok' and coalesce((o->'shift'->>'available')::numeric, 0) >= 2);
      end;
    end if;
    if o->'shift' is null or jsonb_typeof(o->'shift') <> 'object' or coalesce((o->'shift'->>'available')::numeric, 0) < 1 then
      insert into ho_live(who, step, expected, actual, ok) values (a.name, 'RPCs', 'needs an open shift with ≥ 1 ج', 'not testable now (no open shift / no cash)', null); continue; end if;
    -- each option from a CLEAN state: run it inside a sub-block, record the result, then raise to undo it (local variables survive)
    -- «تسليم للخزينة الرئيسية» (+ while it is pending: options.main_pending shown, the peer request refused → the UI disables «لزميل»)
    if o->'main' is not null and jsonb_typeof(o->'main') = 'object' then
      err := null; err2 := null; pend := null;
      begin
        execute 'set local role authenticated';
        r := public.clinic_finance_treasury_command('transfer_request', jsonb_build_object('from_shift', o->'shift'->>'id', 'to_register', o->'main'->>'register_id',
               'amount', 1, 'reference', 'HO-TEST-' || left(md5(a.user_id::text || clock_timestamp()::text), 8), 'reason', 'تجربة تراجع — تسليم للخزينة الرئيسية'), gen_random_uuid());
        err := 'ok';
        pend := public.clinic_finance_peer_handover('options', '{}'::jsonb, null)->'main_pending';
        col := (select c from jsonb_array_elements(coalesce(o->'colleagues', '[]')) c limit 1);
        if col is not null then
          begin
            perform public.clinic_finance_peer_handover('request', jsonb_build_object('from_shift', o->'shift'->>'id', 'to_shift', col->>'shift_id', 'amount', 1, 'note', 'تجربة'), gen_random_uuid());
            err2 := 'accepted';
          exception when others then err2 := sqlerrm; end;
        end if;
        raise exception 'HO_UNDO';
      exception when others then execute 'reset role'; if sqlerrm <> 'HO_UNDO' then err := sqlerrm; end if; end;
      insert into ho_live(who, step, expected, actual, ok) values (a.name, '«تسليم للخزينة الرئيسية» transfer_request 1 ج', 'ok', err, err = 'ok');
      insert into ho_live(who, step, expected, actual, ok) values (a.name, 'while it is pending: options.main_pending (mig 180000)', 'amount 1', coalesce(pend::text, 'null — apply 20261123180000'), (pend->>'amount')::numeric = 1);
      if err2 is not null then
        insert into ho_live(who, step, expected, actual, ok) values (a.name, 'while it is pending: peer request', 'refused → UI shows «لزميل» disabled', err2, err2 like '%معلّق%');
      end if;
    else
      insert into ho_live(who, step, expected, actual, ok) values (a.name, '«تسليم للخزينة الرئيسية»', 'disabled (main closed)', 'disabled with reason — no RPC', true);
    end if;
    -- «تسليم التحصيل لزميل» (clean state: the main transfer above was undone)
    col := (select c from jsonb_array_elements(coalesce(o->'colleagues', '[]')) c limit 1);
    if col is not null then
      err := null;
      begin
        execute 'set local role authenticated';
        r := public.clinic_finance_peer_handover('request', jsonb_build_object('from_shift', o->'shift'->>'id', 'to_shift', col->>'shift_id', 'amount', 1, 'note', 'تجربة تراجع'), gen_random_uuid());
        err := 'ok';
        raise exception 'HO_UNDO';
      exception when others then execute 'reset role'; if sqlerrm <> 'HO_UNDO' then err := sqlerrm; end if; end;
      insert into ho_live(who, step, expected, actual, ok) values (a.name, '«تسليم التحصيل لزميل» request 1 ج → ' || (col->>'name'), 'ok (pending until the colleague confirms)', err, err = 'ok');
    else
      insert into ho_live(who, step, expected, actual, ok) values (a.name, '«تسليم التحصيل لزميل»', 'disabled (no colleague open)', 'disabled with reason — no RPC', true);
    end if;
  end loop;
end $$;
select who, step, expected, actual, ok from ho_live order by n;
rollback;
