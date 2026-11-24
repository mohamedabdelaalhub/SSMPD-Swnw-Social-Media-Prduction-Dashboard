-- Live rollback dry-run for 20261125050000_cash_case_settle_cap.sql (never settle past zero). ONE transaction ending with ROLLBACK.
-- On REAL data: the drawer with two unsettled surplus cases where the later one carries the earlier (Mariam: +1090, +2280; book −2280).
-- 1) the migration body; 2) 'list' as the FM shows settle_amount ≤ |closed-shift book| for every case;
-- 3) the FM walks both cases to «القرار», files the LATER case, the owner / GM approves → closed-shift book exactly 0;
-- 4) the earlier case now has settle_amount 0 and the FM's request is refused («متظبطة بالفعل»); 5) ledger balanced. Nothing kept.
begin;
-- ===== migration body (20261125050000) =====

do $$ begin
  if to_regprocedure('public.clinic_finance_case_settle(text,jsonb,uuid)') is null then raise exception 'طبّق تسوية فروق الخزن (20261124190000) الأول'; end if;
  if to_regprocedure('clinic_finance.case_settle_amount(uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function clinic_finance.case_settle_book(p_register uuid) returns numeric
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(l.debit - l.credit), 0) from clinic_finance.entries e join clinic_finance.lines l on l.entry_id = e.id
    join clinic_finance.shifts s on s.id = e.shift_id
  where s.register_id = p_register and s.status <> 'open' and clinic_finance.is_cash_account(l.account)
$$;

create function clinic_finance.case_settle_amount(p_case uuid) returns numeric
language sql stable security definer set search_path = pg_catalog, public as $$
  select case when c.difference > 0 then least(c.difference, greatest(0, -b.v)) else least(-c.difference, greatest(0, b.v)) end
  from clinic_finance.cash_cases c join clinic_finance.shifts s on s.id = c.shift_id
    cross join lateral (select clinic_finance.case_settle_book(s.register_id) v) b
  where c.id = p_case
$$;
revoke all on function clinic_finance.case_settle_book(uuid), clinic_finance.case_settle_amount(uuid) from public, anon, authenticated;

create table clinic_finance.case_settle_cap_saved_defs(name text primary key, def text not null);
revoke all on clinic_finance.case_settle_cap_saved_defs from public, anon, authenticated;

do $$
declare d text; n text;
  a1 constant text := $s$    return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'register_balance', clinic_finance.treasury_balance(sh.register_id),$s$;
  a2 constant text := $s$    update clinic_finance.cash_cases set settle_status = 'pending',$s$;
  a3 constant text := $s$      amt := abs(c.difference);$s$;
begin
  d := pg_get_functiondef('public.clinic_finance_case_settle(text,jsonb,uuid)'::regprocedure);
  if (length(d) - length(replace(d, a1, ''))) <> length(a1) or (length(d) - length(replace(d, a2, ''))) <> length(a2)
     or (length(d) - length(replace(d, a3, ''))) <> length(a3) then
    raise exception 'نقاط الربط في clinic_finance_case_settle مش موجودة مرة واحدة (md5 %)', md5(d); end if;
  insert into clinic_finance.case_settle_cap_saved_defs values ('clinic_finance_case_settle', d);
  n := replace(d, a1, a1 || $s$ 'settle_amount', clinic_finance.case_settle_amount(x.id),$s$);
  n := replace(n, a2, $s$    amt := clinic_finance.case_settle_amount(c.id);
    if coalesce(amt, 0) <= 0 then raise exception 'الخزينة متظبطة بالفعل ومفيش رصيد يتسوّى (الفرق ده غالبًا داخل في فرق تاني على نفس الخزينة أو اتسجّل تحصيله) — سيب الفرق من غير تسوية'; end if;
$s$ || a2);
  n := replace(n, a3, $s$      amt := clinic_finance.case_settle_amount(c.id);
      if coalesce(amt, 0) <= 0 then raise exception 'الخزينة اتظبطت من وقت طلب التسوية ومفيش رصيد يتسوّى — ارفض الطلب'; end if;$s$);
  execute n;
end $$;

-- ===== test =====
do $$
declare maker uuid; checker uuid; mk uuid; ck uuid; reg uuid; c1 clinic_finance.cash_cases%rowtype; c2 clinic_finance.cash_cases%rowtype;
  b0 numeric; b1 numeric; a2 numeric; r jsonb; ok boolean; l jsonb; x record;
begin
  select a.user_id, a.id into maker, mk from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager' order by a.id limit 1;
  select a.user_id, a.id into checker, ck from public.admins a where a.active and a.user_id is not null and a.role in ('super_admin', 'general_manager') and a.id <> mk order by a.role desc, a.id limit 1;
  if maker is null or checker is null then raise exception 'Need an FM (maker) and an owner / GM (checker) with logins'; end if;
  select s.register_id into reg from clinic_finance.cash_cases x join clinic_finance.shifts s on s.id = x.shift_id
    where x.settle_status is null and x.difference > 0 and s.cashier_id not in (mk, ck) group by s.register_id having count(*) >= 2
    order by sum(x.difference) desc limit 1;
  if reg is null then raise exception 'No drawer with two unsettled surplus cases'; end if;
  select x.* into c1 from clinic_finance.cash_cases x join clinic_finance.shifts s on s.id = x.shift_id where s.register_id = reg and x.settle_status is null and x.difference > 0 order by s.closed_at limit 1;
  select x.* into c2 from clinic_finance.cash_cases x join clinic_finance.shifts s on s.id = x.shift_id where s.register_id = reg and x.settle_status is null and x.difference > 0 order by s.closed_at desc limit 1;
  b0 := clinic_finance.case_settle_book(reg);
  perform set_config('request.jwt.claim.sub', maker::text, true); execute 'set local role authenticated';
  l := public.clinic_finance_case_settle('list', '{}'::jsonb, null);
  for x in select * from jsonb_array_elements(l) e(v) loop
    if (x.v->>'settle_amount') is null then raise exception 'list has no settle_amount'; end if;
  end loop;
  a2 := (select (v->>'settle_amount')::numeric from jsonb_array_elements(l) e(v) where v->>'id' = c2.id::text);
  if a2 <> least(c2.difference, greatest(0, -b0)) then raise exception 'settle_amount % ≠ min(%, %)', a2, c2.difference, -b0; end if;
  for x in select * from clinic_finance.cash_cases where id in (c1.id, c2.id) loop
    if x.status = 'recorded' then perform public.clinic_finance_case_step(x.id, 'review', 'اختبار تراجع — مراجعة'); end if;
    if x.status in ('recorded', 'reviewed') then perform public.clinic_finance_case_step(x.id, 'responsibility', 'اختبار تراجع — مسؤولية', 'process_error', null, null); end if;
    if x.status <> 'decided' then perform public.clinic_finance_case_step(x.id, 'decision', 'اختبار تراجع — قرار', null, null, 'correct_records'); end if;
  end loop;
  r := public.clinic_finance_case_settle('request', jsonb_build_object('id', c2.id, 'kind', 'surplus_income', 'note', 'اختبار تراجع — تسوية'), gen_random_uuid());
  perform set_config('request.jwt.claim.sub', checker::text, true);
  r := public.clinic_finance_case_settle('review', jsonb_build_object('id', c2.id, 'approve', true, 'note', 'اختبار تراجع — اعتماد'), gen_random_uuid());
  perform set_config('request.jwt.claim.sub', maker::text, true);
  ok := false; begin perform public.clinic_finance_case_settle('request', jsonb_build_object('id', c1.id, 'kind', 'surplus_income', 'note', 'اختبار تراجع — المشمولة'), gen_random_uuid());
    exception when others then ok := sqlerrm like '%متظبطة بالفعل%'; end;
  execute 'reset role';
  b1 := clinic_finance.case_settle_book(reg);
  if not ok then raise exception 'the included case was NOT refused (book % → %)', b0, b1; end if;
  if b0 + a2 <> b1 or (b0 + c2.difference <= 0 and b1 <> b0 + c2.difference) or b1 > 0 then raise exception 'wrong book: % → % (settled %)', b0, b1, a2; end if;
  if exists (select 1 from clinic_finance.lines group by entry_id having sum(debit - credit) <> 0) then raise exception 'Unbalanced ledger'; end if;
  raise notice 'cap live rollback OK: register %, cases % (+%) and % (+%), closed-shift book % → % (settled %), earlier case refused', reg, c1.id, c1.difference, c2.id, c2.difference, b0, b1, a2;
end $$;
rollback;
