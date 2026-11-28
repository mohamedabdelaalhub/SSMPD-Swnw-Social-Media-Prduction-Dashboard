-- LIVE dry-run (owner 2026-11-28 «موافق على تصليح التحصيل», mockup collect-visit-split.html): «حصّل» on a visit with FIVE open
-- invoices now saves through collect_multi. As MAZEN (reception, auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb), on HIS real register:
-- his running shift if he has one, else a shift opened for him by the real clinic_finance_open_shift (rolled back), one test patient with 5 test invoices (one visit), collect_multi CASH = the visit total
-- (one receipt, 5 allocations, no credit), replay; then a 2nd test patient: 3 invoices, 2 ticked, amount 1,000 → the extra 300
-- becomes patient credit (the case the screen now warns about). No server change in this PR; nothing is kept (ROLLBACK).
-- Guard first; summary table LAST.
do $$ begin
  if to_regprocedure('clinic_reception.collect_multi(uuid,jsonb,uuid)') is null then raise exception 'collect_multi مش موجودة على السيرفر'; end if;
  if not exists (select 1 from public.admins where user_id = 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb' and active) then raise exception 'حساب مازن مش موجود / مش نشط'; end if;
end $$;
begin;
create temp table _r(step text, ok boolean, detail text) on commit drop;
grant all on _r to authenticated;
do $t$
declare u uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; freg uuid; rreg uuid; sh uuid; pat uuid; pat2 uuid;
  ids uuid[] := '{}'; ids2 uuid[] := '{}'; x uuid; r jsonb; r2 jsonb; pay clinic_reception.payments%rowtype; n int; tot numeric;
  ref text := 'ROLLBACK-CVS-' || gen_random_uuid()::text; k uuid := gen_random_uuid(); amts numeric[] := array[400, 600, 400, 250, 150]; i int;
begin
  select id into me from public.admins where user_id = u;
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  -- setup as postgres: 2 test patients (+ invoices below); Mazen's register = the register of his latest finance shift
  select f.register_id into freg from clinic_finance.shifts f where f.cashier_id = me order by f.opened_at desc limit 1;
  insert into _r values ('Mazen has a real register', freg is not null, coalesce((select name from clinic_finance.registers where id = freg), '—'));
  insert into clinic_reception.patients(workspace_id, file_no, name, phone, created_by) values (w, ref, 'مريض اختبار تراجع', '', me) returning id into pat;
  insert into clinic_reception.patients(workspace_id, file_no, name, phone, created_by) values (w, ref || '-2', 'مريض اختبار تراجع 2', '', me) returning id into pat2;
  for i in 1..5 loop
    insert into clinic_reception.invoices(workspace_id, patient_id, kind, amount, description) values (w, pat, 'service', amts[i], 'خدمة اختبار ' || i) returning id into x;
    ids := ids || x;
  end loop;
  for i in 1..3 loop
    insert into clinic_reception.invoices(workspace_id, patient_id, kind, amount, description) values (w, pat2, 'service', 350, 'خدمة 2-' || i) returning id into x;
    ids2 := ids2 || x;
  end loop;
  tot := (select sum(a) from unnest(amts) a);
  -- Mazen's running reception shift (status open, not handed over), else open one for him with the real RPC (rolled back)
  select s.id into sh from clinic_reception.shifts s where s.workspace_id = w and s.cashier_id = me and s.status = 'open' and (to_jsonb(s)->>'ended_at') is null order by s.opened_at desc limit 1;
  begin
    if sh is not null then insert into _r values ('Mazen''s running shift', true, sh::text);
    else
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      x := public.clinic_finance_open_shift(freg, gen_random_uuid());
      execute 'reset role';
      perform clinic_reception.sync_native_links(w);
      select id into sh from clinic_reception.shifts where workspace_id = w and finance_shift_id = x;
      insert into _r values ('opened a shift for Mazen on his register (rolled back) + linked', sh is not null, coalesce(sh::text, 'finance shift ' || x));
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    r := public.clinic_reception_command(w, 'collect_multi', jsonb_build_object('patient_id', pat, 'method', 'cash', 'reference', ref, 'shift_id', sh,
           'amount', tot::text, 'invoice_ids', to_jsonb(ids), 'note', ''), k);
    r2 := public.clinic_reception_command(w, 'collect_multi', jsonb_build_object('patient_id', pat, 'method', 'cash', 'reference', ref, 'shift_id', sh,
           'amount', tot::text, 'invoice_ids', to_jsonb(ids), 'note', ''), k);
    insert into _r values ('collect_multi 5 invoices (= «حصّل» total ' || tot || ')', r is not null, left(r::text, 120));
    insert into _r values ('replay returns the same receipt', r2 = r, null);
    -- 2nd patient: 2 of 3 ticked, amount 1000 → 300 credit
    r := public.clinic_reception_command(w, 'collect_multi', jsonb_build_object('patient_id', pat2, 'method', 'cash', 'reference', ref || '-2', 'shift_id', sh,
           'amount', '1000', 'invoice_ids', to_jsonb(ids2[1:2]), 'note', ''), gen_random_uuid());
    insert into _r values ('collect_multi 2 of 3 + extra (the warned case)', r is not null, left(r::text, 120));
  exception when others then insert into _r values ('ERROR as Mazen', false, sqlerrm);
  end;
  execute 'reset role';
  select * into pay from clinic_reception.payments where workspace_id = w and reference = ref;
  select count(*) into n from clinic_reception.allocations where payment_id = pay.id;
  insert into _r values ('ONE payment, 5 allocations, no credit', pay.id is not null and n = 5 and coalesce(pay.credit_amount, 0) = 0, 'allocations ' || n || ', credit ' || coalesce(pay.credit_amount, 0) || ', receipt ' || coalesce(pay.receipt_no, '-'));
  insert into _r values ('all 5 invoices settled', (select bool_and(clinic_reception.due(z) = 0) from unnest(ids) z), null);
  select * into pay from clinic_reception.payments where workspace_id = w and reference = ref || '-2';
  insert into _r values ('extra 300 → patient credit; 3rd invoice still open', coalesce(pay.credit_amount, 0) = 300 and clinic_reception.due(ids2[3]) = 350,
                        'credit ' || coalesce(pay.credit_amount, 0) || ', due of 3rd ' || clinic_reception.due(ids2[3]));
  insert into _r values ('ledgers balanced',
    not exists (select 1 from clinic_finance.lines group by entry_id having sum(debit - credit) <> 0)
    and not exists (select 1 from clinic_reception.journal_lines group by entry_id having sum(debit - credit) <> 0), null);
end $t$;
select * from _r;
rollback;
