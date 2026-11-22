-- «جرد الخزينة الرئيسية» — the main treasury stays open (owner 2026-11-22 «طبق جرد الخزينة الرئيسية، وخليه زرار او بوكس واضح وسهل
-- الوصول ليه»; financial manager: «محتاج إن الخزينة الرئيسية تكون مفتوحة على طول من غير فتح وردية كل يوم»).
-- Before: the main custodian counted and closed his main shift, then could NOT open a new one until another person reviewed the old
-- one (one unreviewed shift per register / per cashier) — handovers into main and cash vouchers stopped meanwhile.
-- Now, for the MAIN treasury only:
--   * public.clinic_finance_main_count(counts, note, token): the custodian counts; in ONE transaction the open main shift is closed
--     with the existing close path (denominations, cash case on a difference, pending-request checks) and a new main shift opens
--     for him at once (existing open path). The closed one waits for another person's review (maker ≠ checker unchanged).
--   * queued reviews no longer block: at most ONE OPEN main shift per register and per cashier; any number may wait for review.
--     Collection treasuries keep the old rule (one unreviewed shift per register / cashier) — unchanged.
--   * public.clinic_finance_main_count_status(): open shift, last count (counted / expected / difference / review), the counts
--     waiting for review and how many wait more than 24 hours (reviewer nudge), and what the caller may do (count / open / review).
-- Unchanged: posting at the event, cash_limit / treasury_balance per register, handover approval on the receiver's open main shift,
-- vouchers from the main treasury, period close still needs every shift reviewed, blind count for collection shifts.
-- Rollback: supabase/rollbacks/20261122200000_main_treasury_count.rollback.sql
begin;

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

commit;
