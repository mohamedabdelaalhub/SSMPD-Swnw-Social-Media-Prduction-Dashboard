-- Live rollback dry-run for «التسليم بصفر» (rule 9). Client-only change (peer-handover.js); this proves the server call it makes —
-- public.clinic_finance_treasury_command('end_shift') with every denomination 0 + a note — succeeds AS THE RECEPTION CASHIER and lands as intended:
-- shift → submitted, end_counted 0, a cash case of −expected, NO treasury transfer. Also: another reception user cannot end it for her.
-- Everything happens on a THROWAWAY collection register/account/shift created inside this transaction. ONE transaction, ends with ROLLBACK. Nothing kept.
begin;
do $$
declare ca uuid; cu uuid; other uuid; fm_admin uuid; acct text; rg uuid; sid uuid; r jsonb; s clinic_finance.shifts%rowtype; ok boolean;
  zero jsonb := '{"200":"0","100":"0","50":"0","20":"0","10":"0","5":"0","1":"0","0.5":"0","0.25":"0"}'::jsonb;
begin
  select a.id, a.user_id into ca, cu from public.admins a
   where a.active and a.user_id is not null and a.role = 'reception'
     and not exists (select 1 from clinic_finance.shifts x where x.cashier_id = a.id and x.status <> 'reviewed')
   order by a.id limit 1;
  if ca is null then raise exception 'no reception cashier with a login and no unreviewed shift'; end if;
  select a.user_id into other from public.admins a where a.active and a.user_id is not null and a.role = 'reception' and a.id <> ca order by a.id limit 1;
  select a.id into fm_admin from public.admins a where a.active and a.role in ('financial_manager', 'super_admin') order by a.role, a.id limit 1;
  if not exists (select 1 from clinic_finance.registers where treasury_kind = 'main') then raise exception 'no main treasury'; end if;
  acct := '9' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
  insert into clinic_finance.accounts(code, name, kind) values (acct, 'حساب تجربة تسليم بصفر — يتلغي', 'asset');
  insert into clinic_finance.account_config(code, is_system, is_postable) values (acct, false, true);
  insert into clinic_finance.registers(name, petty_limit, created_by, treasury_kind, account_code, assigned_to, parent_register_id)
  values ('تجربة تسليم بصفر — تتلغي ' || left(gen_random_uuid()::text, 8), 0, fm_admin, 'collection', acct, ca,
          (select id from clinic_finance.registers where treasury_kind = 'main' limit 1))
  returning id into rg;
  -- the recorded cash says 500 (like Manar's 1500 that had already been handed over in another shift)
  insert into clinic_finance.shifts(register_id, cashier_id, token, opening_book) values (rg, ca, gen_random_uuid(), 500) returning id into sid;

  -- a colleague cannot end it for her
  if other is not null then
    perform set_config('request.jwt.claim.sub', other::text, true); execute 'set local role authenticated';
    ok := false;
    begin perform public.clinic_finance_treasury_command('end_shift', jsonb_build_object('shift_id', sid, 'counts', zero, 'note', 'تجربة'), gen_random_uuid());
    exception when others then ok := true; end;
    if not ok then raise exception 'another reception user ended the shift'; end if;
    execute 'reset role';
  end if;

  -- the cashier herself: 0 everywhere + a reason → accepted
  perform set_config('request.jwt.claim.sub', cu::text, true); execute 'set local role authenticated';
  r := public.clinic_finance_treasury_command('end_shift',
         jsonb_build_object('shift_id', sid, 'counts', zero, 'note', 'الفلوس اتسلمت قبل كده — الدرج فاضي (تجربة)'), gen_random_uuid());
  execute 'reset role';
  if r->>'status' <> 'submitted' or (r->>'counted')::numeric <> 0 or (r->>'expected')::numeric <> 500 or r->>'transfer_id' is not null then
    raise exception 'unexpected result: %', r; end if;
  select * into s from clinic_finance.shifts where id = sid;
  if s.status <> 'submitted' or s.end_counted <> 0 or s.ended_at is null or s.note not like '%الدرج فاضي%' then raise exception 'shift not ended as expected: % % %', s.status, s.end_counted, s.note; end if;
  if not exists (select 1 from clinic_finance.cash_cases where shift_id = sid and difference = -500) then raise exception 'no −500 cash case'; end if;
  if exists (select 1 from clinic_finance.treasury_transfers where from_shift = sid) then raise exception 'a transfer was created'; end if;
  raise notice 'zero handover dry-run OK: reception cashier ended shift % with 0 + note → submitted, case −500, no transfer; colleague refused', sid;
end $$;
rollback;
