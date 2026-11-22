-- Live rollback test for 20261122200000_main_treasury_count.sql («جرد الخزينة الرئيسية»). ONE transaction ending with ROLLBACK:
-- the migration body (inlined, without its begin/commit), then on the REAL main treasury:
--   * if no main shift is open (e.g. the custodian's last one waits for review): the custodian opens one — must now succeed;
--   * the custodian counts (counts = the book figure in 200…0.25 notes) → old shift submitted, new one open for him, balance unchanged;
--   * replay with the same token returns the same result; the custodian cannot review his own count; another reviewer can;
--   * status RPC; finance ledger balanced.
-- No money moves (a count posts nothing), no message is sent, nothing is kept. Run the whole file as one script.
begin;
-- ===== migration body (20261122200000) =====

do $$ begin
  if to_regprocedure('public.clinic_finance_main_count(jsonb,text,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('clinic_finance.main_custodian()') is null or to_regprocedure('clinic_finance.shift_single_active_message()') is null
     or to_regclass('clinic_finance.fin_register_active') is null or to_regclass('clinic_finance.fin_cashier_main_active') is null then
    raise exception 'طبّق ملفات الخزينة الرئيسية (20261019001000) ورسالة فتح الوردية (20261120110000) أولًا'; end if;
end $$;

create table clinic_finance.main_count_saved_defs(name text primary key, def text not null);
revoke all on clinic_finance.main_count_saved_defs from public, anon, authenticated;
insert into clinic_finance.main_count_saved_defs values ('shift_single_active_message', pg_get_functiondef('clinic_finance.shift_single_active_message()'::regprocedure));

-- one OPEN main shift per register / cashier; reviews may queue. Collection rules unchanged.
drop index clinic_finance.fin_register_active;
create unique index fin_register_active on clinic_finance.shifts(register_id) where status <> 'reviewed' and not is_main;
create unique index fin_register_main_open on clinic_finance.shifts(register_id) where status = 'open' and is_main;
drop index clinic_finance.fin_cashier_main_active;
create unique index fin_cashier_main_open on clinic_finance.shifts(cashier_id) where status = 'open' and is_main;

-- same Arabic message trigger; a main shift waiting for review no longer blocks a new main shift
create or replace function clinic_finance.shift_single_active_message() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare s record; what text; main boolean;
begin
  select treasury_kind = 'main' into main from clinic_finance.registers where id = new.register_id;
  main := coalesce(main, false);
  select sh.status, sh.opened_at, coalesce(a.name, 'موظف') as who, coalesce(r.name, 'الخزينة') as reg into s
    from clinic_finance.shifts sh left join public.admins a on a.id = sh.cashier_id left join clinic_finance.registers r on r.id = sh.register_id
    where sh.register_id = new.register_id and sh.status <> 'reviewed' and sh.id <> new.id and (not main or sh.status = 'open')
    order by sh.opened_at desc limit 1;
  if found then
    what := case when s.status = 'open' then 'لسه مفتوحة' else 'اتسلّمت ومستنية المراجعة المالية' end;
    raise exception 'الخزينة دي عليها وردية % (باسم %، اتفتحت %). %', what, s.who,
      to_char(s.opened_at at time zone 'Africa/Cairo', 'DD/MM HH24:MI'),
      case when main then 'الخزينة الرئيسية مفتوحة بالفعل — اعمل «جرد الخزينة الرئيسية» بدل ما تفتح وردية جديدة.'
           when s.status = 'open' then 'اقفلها الأول بـ«جرد وتسليم»، وبعدين افتح وردية جديدة.'
           else 'لازم المالية تراجعها الأول، وبعدين تقدر تفتح وردية جديدة على الخزينة دي.' end
      using errcode = '23505';
  end if;
  select sh.status, sh.opened_at, coalesce(r.name, 'خزينة') as reg into s
    from clinic_finance.shifts sh left join clinic_finance.registers r on r.id = sh.register_id
    where sh.cashier_id = new.cashier_id and sh.status <> 'reviewed' and sh.id <> new.id
      and not (main and sh.status = 'submitted' and coalesce(r.treasury_kind = 'main', false))
    order by sh.opened_at desc limit 1;
  if found then
    raise exception 'عندك وردية تانية % على «%» (اتفتحت %). %',
      case when s.status = 'open' then 'لسه مفتوحة' else 'اتسلّمت ومستنية المراجعة المالية' end, s.reg,
      to_char(s.opened_at at time zone 'Africa/Cairo', 'DD/MM HH24:MI'),
      case when s.status = 'open' then 'اقفلها الأول بـ«جرد وتسليم».' else 'لازم المالية تراجعها الأول، وبعدين تقدر تفتح وردية جديدة.' end
      using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function clinic_finance.shift_single_active_message() from public, anon, authenticated;

create function public.clinic_finance_main_count(p_counts jsonb, p_note text, p_token uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_finance.require_access('create'); op clinic_finance.journal_operations%rowtype; r clinic_finance.registers%rowtype;
  s clinic_finance.shifts%rowtype; who text; nid uuid; v_counted numeric; v_expected numeric; pl jsonb; res jsonb;
begin
  if p_token is null then raise exception 'مفتاح العملية مطلوب'; end if;
  perform clinic_finance.lock_day();
  pl := jsonb_build_object('counts', p_counts, 'note', left(coalesce(p_note, ''), 1000));
  select * into op from clinic_finance.journal_operations where actor = me and token = p_token;
  if found then
    if op.action <> 'main_count' or op.payload <> pl then raise exception 'مفتاح مكرر لبيانات مختلفة'; end if;
    return op.result;
  end if;
  if not clinic_finance.main_custodian() then raise exception 'جرد الخزينة الرئيسية للمدير المالي أو الإدارة المخولة فقط' using errcode = '42501'; end if;
  select * into r from clinic_finance.registers where treasury_kind = 'main' order by created_at limit 1;
  if not found then raise exception 'جهّز الخزينة الرئيسية أولًا'; end if;
  select * into s from clinic_finance.shifts where register_id = r.id and status = 'open' order by opened_at desc limit 1 for update;
  if not found then raise exception 'الخزينة الرئيسية مش مفتوحة — دوس «افتح الخزينة الرئيسية» الأول'; end if;
  if s.cashier_id <> me then
    select coalesce(nullif(trim(name), ''), 'زميل') into who from public.admins where id = s.cashier_id;
    raise exception 'الخزينة الرئيسية مفتوحة باسم % — هو اللي يعمل الجرد', who;
  end if;
  v_expected := clinic_finance.shift_cash(s.id);
  perform public.clinic_finance_close_shift(s.id, p_counts, p_note);
  select counted into v_counted from clinic_finance.shifts where id = s.id;
  nid := public.clinic_finance_open_shift(r.id, md5('main-count:' || me::text || ':' || p_token::text)::uuid);
  res := jsonb_build_object('closed_shift', s.id, 'new_shift', nid, 'counted', v_counted, 'expected', v_expected,
    'difference', v_counted - v_expected, 'at', now());
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'main_count', s.id, res);
  insert into clinic_finance.journal_operations(actor, token, action, payload, result, created_at) values (me, p_token, 'main_count', pl, res, now());
  return res;
end $$;

create function public.clinic_finance_main_count_status() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_finance.require_access('view'); r clinic_finance.registers%rowtype; s clinic_finance.shifts%rowtype;
  lc clinic_finance.shifts%rowtype; pend int; overdue int; oldest timestamptz; custodian boolean := clinic_finance.main_custodian();
  nm text;
begin
  select * into r from clinic_finance.registers where treasury_kind = 'main' order by created_at limit 1;
  if not found then return jsonb_build_object('configured', false); end if;
  select * into s from clinic_finance.shifts where register_id = r.id and status = 'open' order by opened_at desc limit 1;
  select * into lc from clinic_finance.shifts where register_id = r.id and closed_at is not null order by closed_at desc, id desc limit 1;
  select count(*), count(*) filter (where closed_at < now() - interval '24 hours'), min(closed_at) into pend, overdue, oldest
    from clinic_finance.shifts where register_id = r.id and status = 'submitted';
  return jsonb_build_object('configured', true, 'register_id', r.id, 'register', r.name, 'is_custodian', custodian,
    'can_review', clinic_finance.allowed('review'),
    'open_shift', case when s.id is null then null else jsonb_build_object('id', s.id, 'opened_at', s.opened_at, 'mine', s.cashier_id = me,
      'custodian', (select coalesce(nullif(trim(a.name), ''), 'المسؤول') from public.admins a where a.id = s.cashier_id)) end,
    'last_count', case when lc.id is null then null else jsonb_build_object('shift_id', lc.id, 'at', lc.closed_at, 'counted', lc.counted,
      'expected', clinic_finance.shift_cash(lc.id), 'difference', lc.counted - clinic_finance.shift_cash(lc.id), 'status', lc.status,
      'by', (select coalesce(nullif(trim(a.name), ''), 'المسؤول') from public.admins a where a.id = lc.cashier_id),
      'reviewed_by', (select coalesce(nullif(trim(a.name), ''), 'المراجع') from public.admins a where a.id = lc.reviewed_by)) end,
    'pending_reviews', pend, 'overdue_reviews', overdue, 'oldest_pending_at', oldest,
    'pending', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'closed_at', x.closed_at, 'counted', x.counted,
        'expected', clinic_finance.shift_cash(x.id), 'mine', x.cashier_id = me,
        'by', (select coalesce(nullif(trim(a.name), ''), 'المسؤول') from public.admins a where a.id = x.cashier_id)) order by x.closed_at)
      from (select * from clinic_finance.shifts where register_id = r.id and status = 'submitted' order by closed_at limit 20) x), '[]'::jsonb),
    'can_count', custodian and s.id is not null and s.cashier_id = me,
    'can_open', custodian and s.id is null);
end $$;

revoke all on function public.clinic_finance_main_count(jsonb, text, uuid), public.clinic_finance_main_count_status() from public, anon;
grant execute on function public.clinic_finance_main_count(jsonb, text, uuid), public.clinic_finance_main_count_status() to authenticated;

-- ===== test =====
do $$
declare reg clinic_finance.registers%rowtype; cust uuid; cust_user uuid; rev_user uuid; open_s clinic_finance.shifts%rowtype; bal0 numeric; bal1 numeric;
  exp numeric; rest numeric; c jsonb := '{}'; d text; n numeric; k uuid := gen_random_uuid(); r1 jsonb; r2 jsonb; st jsonb; ok boolean;
begin
  select * into reg from clinic_finance.registers where treasury_kind = 'main' order by created_at limit 1;
  if not found then raise exception 'No main treasury'; end if;
  select * into open_s from clinic_finance.shifts where register_id = reg.id and status = 'open' order by opened_at desc limit 1;
  if open_s.id is not null then cust := open_s.cashier_id;
  else select cashier_id into cust from clinic_finance.shifts where register_id = reg.id order by opened_at desc limit 1; end if;
  if cust is null then select id into cust from public.admins where role = 'financial_manager' and active order by id limit 1; end if;
  select user_id into cust_user from public.admins where id = cust and active;
  if cust_user is null then raise exception 'Main custodian has no login'; end if;
  select user_id into rev_user from public.admins where active and user_id is not null and id <> cust and role in ('super_admin', 'general_manager') order by role desc, id limit 1;
  if rev_user is null then raise exception 'Need a second reviewer (super_admin / general_manager)'; end if;
  perform set_config('request.jwt.claim.sub', cust_user::text, true); execute 'set local role authenticated';
  if open_s.id is null then
    perform public.clinic_finance_open_shift(reg.id, gen_random_uuid());   -- was blocked before by the queued review
    execute 'reset role';
    select * into open_s from clinic_finance.shifts where register_id = reg.id and status = 'open' order by opened_at desc limit 1;
    if open_s.id is null or open_s.cashier_id <> cust then raise exception 'Main shift did not open'; end if;
    execute 'set local role authenticated';
  end if;
  st := public.clinic_finance_main_count_status();
  if not (st->>'can_count')::boolean then raise exception 'Custodian cannot count: %', st; end if;
  execute 'reset role';
  bal0 := clinic_finance.treasury_balance(reg.id); exp := clinic_finance.shift_cash(open_s.id); rest := greatest(exp, 0);
  foreach d in array array['200','100','50','20','10','5','1','0.5','0.25'] loop n := floor(rest / d::numeric); c := c || jsonb_build_object(d, n); rest := rest - n * d::numeric; end loop;
  execute 'set local role authenticated';
  r1 := public.clinic_finance_main_count(c, 'اختبار تراجع — جرد الخزينة الرئيسية', k);
  r2 := public.clinic_finance_main_count(c, 'اختبار تراجع — جرد الخزينة الرئيسية', k);
  if r1 <> r2 then raise exception 'Replay changed the result'; end if;
  ok := false; begin perform public.clinic_finance_review_shift((r1->>'closed_shift')::uuid, 'مراجعة ذاتية'); exception when others then ok := sqlerrm like '%ورديتك بنفسك%'; end;
  if not ok then raise exception 'Custodian reviewed his own count'; end if;
  st := public.clinic_finance_main_count_status();
  execute 'reset role';
  if (select status from clinic_finance.shifts where id = (r1->>'closed_shift')::uuid) <> 'submitted' then raise exception 'Old main shift not submitted'; end if;
  if not exists (select 1 from clinic_finance.shifts where id = (r1->>'new_shift')::uuid and status = 'open' and cashier_id = cust and is_main) then raise exception 'New main shift not open for the custodian'; end if;
  bal1 := clinic_finance.treasury_balance(reg.id); if bal1 <> bal0 then raise exception 'Book balance changed % → %', bal0, bal1; end if;
  if (r1->>'expected')::numeric <> exp then raise exception 'Expected mismatch'; end if;
  if (r1->>'difference')::numeric <> 0 and not exists (select 1 from clinic_finance.cash_cases where shift_id = (r1->>'closed_shift')::uuid) then raise exception 'Difference without a cash case'; end if;
  if (st->>'pending_reviews')::int < 1 or not (st->>'can_count')::boolean or st->'open_shift'->>'id' <> r1->>'new_shift' then raise exception 'Status wrong: %', st; end if;
  perform set_config('request.jwt.claim.sub', rev_user::text, true); execute 'set local role authenticated';
  perform public.clinic_finance_review_shift((r1->>'closed_shift')::uuid, 'اختبار تراجع — مراجعة جرد');
  execute 'reset role';
  if (select status from clinic_finance.shifts where id = (r1->>'closed_shift')::uuid) <> 'reviewed' then raise exception 'Review failed'; end if;
  if exists (select 1 from clinic_finance.lines group by entry_id having sum(debit - credit) <> 0) then raise exception 'Unbalanced finance ledger'; end if;
  raise notice 'main treasury count live rollback OK: counted % / expected %, new main shift %', r1->>'counted', r1->>'expected', r1->>'new_shift';
end $$;
rollback;
select jsonb_build_object('test', 'main treasury count live rollback passed',
  'migration_left_applied', to_regprocedure('public.clinic_finance_main_count(jsonb,text,uuid)') is not null,
  'main_open_shifts', (select count(*) from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id where r.treasury_kind = 'main' and s.status = 'open'),
  'main_waiting_review', (select count(*) from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id where r.treasury_kind = 'main' and s.status = 'submitted'));
