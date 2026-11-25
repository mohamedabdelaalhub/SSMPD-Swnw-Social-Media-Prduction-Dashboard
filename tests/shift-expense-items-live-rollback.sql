-- Live rollback dry-run for 20261126010000_shift_expense_more_items.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- On a THROWAWAY collection register + shift (500 cash seeded by a posted collection) created inside the transaction, as a real reception cashier:
-- the register is forced 'receive' like every real reception register (that is what refused the first dry-run);
-- status lists 12 items; «إكراميات» with no receipt + a reason posts (Dr 5216); «صيانة» without a receipt is refused; a short tip reason is refused; any other payout from the same receive-only register is still refused.
begin;
-- «مصروفات الوردية»: 3 more items (owner «طبق المرحلة الأولى» 2026-11-25 — daily-movements map, phase 1; mockup
-- docs/ui-references/mockups/daily-movements-map.html): «صيانة» and «تليفونات وباقات موبايل» (with a receipt, like the others) and
-- «إكراميات» (owner: من غير إيصال، بسبب مكتوب — reason of at least 5 characters, a receipt is refused for it; stored with the
-- evidence marker 'no-receipt').
-- Accounts: صيانة / تليفونات → 5224 مصروفات عمومية أخرى, إكراميات → 5216 مصروفات نثرية (the item key/label stays on every request,
-- so the accountant can still split them). Same limits, same blind cash checks, same mandatory finance post-review.
-- Fix (live dry-run 2026-11-25): reception collection registers are forced to operation_mode 'receive' (treasury trigger), and
-- clinic_finance.post() called register_direction(shift,'pay') for every cash credit — so EVERY shift expense (old items too) was
-- refused on live with «الخزينة للاستلام فقط ولا تسمح بالصرف». post() now skips the direction check for source 'shift_expense' only
-- (cash_line_guard already allows exactly that source; the spend function keeps its own limits: own open shift, allowance,
-- per-expense max, proven cash). Every other payout from a collection register stays refused.
-- In-place: shift_expense_items() replaced; clinic_finance_shift_expense patched at one anchor (receipt check); clinic_finance.post
-- patched at one anchor (direction line). Saved defs for rollback.
-- Rollback: supabase/rollbacks/20261126010000_shift_expense_more_items.rollback.sql

do $$ declare d text; begin
  if to_regprocedure('public.clinic_finance_shift_expense(text,jsonb)') is null then raise exception 'طبّق مصروفات الوردية أولًا'; end if;
  if to_regclass('clinic_finance.shift_expense_items_saved_defs') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  d := pg_get_functiondef('public.clinic_finance_shift_expense(text,jsonb)'::regprocedure);
  if position($a$    if ev = '' or split_part(ev, '/', 1) <> auth.uid()::text$a$ in d) = 0 then raise exception 'نص التحقق من الإيصال اتغيّر — راجع الدالة قبل التطبيق'; end if;
  d := pg_get_functiondef('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)'::regprocedure);
  if (length(d) - length(replace(d, $a$p_credit='1111' and p_source<>'deposit' and not$a$, ''))) / length($a$p_credit='1111' and p_source<>'deposit' and not$a$) <> 1
    then raise exception 'سطر اتجاه الخزينة في post اتغيّر — راجع الدالة قبل التطبيق (md5 %)', md5(d); end if;
end $$;

create table clinic_finance.shift_expense_items_saved_defs(name text primary key, def text not null);
revoke all on clinic_finance.shift_expense_items_saved_defs from public, anon, authenticated;
insert into clinic_finance.shift_expense_items_saved_defs values
  ('shift_expense_items', pg_get_functiondef('clinic_finance.shift_expense_items()'::regprocedure)),
  ('clinic_finance_shift_expense', pg_get_functiondef('public.clinic_finance_shift_expense(text,jsonb)'::regprocedure)),
  ('post', pg_get_functiondef('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)'::regprocedure));

create or replace function clinic_finance.shift_expense_items() returns jsonb language sql immutable as $$
  select '[{"key":"cleaning","label":"مناديل ومستلزمات نظافة","account":"5216"},{"key":"bathroom","label":"مستلزمات حمام","account":"5216"},
    {"key":"electricity","label":"شحن كارت الكهرباء","account":"5219"},{"key":"water","label":"فاتورة المية","account":"5220"},
    {"key":"internet","label":"الإنترنت","account":"5224"},{"key":"hospitality","label":"ضيافة ومياه شرب","account":"5216"},
    {"key":"stationery","label":"أدوات مكتبية وطباعة","account":"5216"},{"key":"delivery","label":"توصيل ومواصلات","account":"5216"},
    {"key":"maintenance","label":"صيانة","account":"5224"},{"key":"phones","label":"تليفونات وباقات موبايل","account":"5224"},
    {"key":"tips","label":"إكراميات","account":"5216","no_receipt":true},
    {"key":"other","label":"بند تاني","account":"5216"}]'::jsonb
$$;

do $$ begin
  execute replace(pg_get_functiondef('public.clinic_finance_shift_expense(text,jsonb)'::regprocedure),
    $a$    if ev = '' or split_part(ev, '/', 1) <> auth.uid()::text$a$,
    $b$    if coalesce((it->>'no_receipt')::boolean, false) then
      if ev <> '' then raise exception 'البند ده من غير إيصال — شيل الصورة'; end if;
      if length(why) < 5 then raise exception 'اكتب سبب الإكرامية بالتفصيل (لمين وليه)'; end if;
      ev := 'no-receipt';   -- requests.evidence is required (2..200): a fixed marker, the screen shows «من غير إيصال»
    elsif ev = '' or split_part(ev, '/', 1) <> auth.uid()::text$b$);
end $$;

do $$ begin
  execute replace(pg_get_functiondef('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)'::regprocedure),
    $a$p_credit='1111' and p_source<>'deposit' and not$a$,
    $b$p_credit='1111' and p_source<>'deposit' and p_source<>'shift_expense' and not$b$);
end $$;

do $$
declare ca uuid; cu uuid; fm_admin uuid; acct text; inc text; rg uuid; sid uuid; st jsonb; r jsonb; ok boolean;
begin
  select a.id, a.user_id into ca, cu from public.admins a
   where a.active and a.user_id is not null and a.role = 'reception'
     and not exists (select 1 from clinic_finance.shifts x where x.cashier_id = a.id and x.status = 'open' and x.ended_at is null and not x.is_main)
   order by a.id limit 1;
  if ca is null then raise exception 'no reception cashier with a login and no open shift'; end if;
  select a.id into fm_admin from public.admins a where a.active and a.role in ('financial_manager', 'super_admin') order by a.role, a.id limit 1;
  acct := '9' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
  insert into clinic_finance.accounts(code, name, kind) values (acct, 'حساب تجربة مصروفات الوردية — يتلغي', 'asset');
  insert into clinic_finance.account_config(code, is_system, is_postable) values (acct, false, true);
  insert into clinic_finance.registers(name, petty_limit, created_by, treasury_kind, account_code, assigned_to, parent_register_id)
  values ('تجربة مصروفات — تتلغي ' || left(gen_random_uuid()::text, 8), 0, fm_admin, 'collection', acct, ca, (select id from clinic_finance.registers where treasury_kind = 'main' limit 1))
  returning id into rg;
  insert into clinic_finance.shifts(register_id, cashier_id, token, opening_book) values (rg, ca, gen_random_uuid(), 500) returning id into sid;
  -- real cash in the drawer: a 500 cash collection posted through clinic_finance.post like a cashier's receipt (Dr 1111 → the
  -- register's own cash account, Cr a throwaway income account); «opening_book» alone is not ledger cash for cash_limit().
  inc := '9' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
  insert into clinic_finance.accounts(code, name, kind) values (inc, 'إيراد تجربة مصروفات الوردية — يتلغي', 'income');
  insert into clinic_finance.account_config(code, is_system, is_postable) values (inc, false, true);
  perform set_config('request.jwt.claim.sub', cu::text, true);
  perform clinic_finance.post('collection', gen_random_uuid(), 'تجربة — تحصيل كاش يتلغي', sid, '1111', inc, 500);
  if clinic_finance.cash_limit(sid) <> 500 then raise exception 'seeded cash not counted: %', clinic_finance.cash_limit(sid); end if;
  execute 'set local role authenticated';
  st := public.clinic_finance_shift_expense('status', '{}'::jsonb);
  if jsonb_array_length(st->'items') <> 12 or not (st->'items') @> '[{"key":"tips","no_receipt":true}]'::jsonb then raise exception 'items: %', st->'items'; end if;
  r := public.clinic_finance_shift_expense('spend', jsonb_build_object('shift_id', sid, 'item', 'tips', 'amount', '20', 'reason', 'تجربة — عامل توصيل المياه', 'receipt_path', '', 'token', gen_random_uuid()));
  ok := false; begin perform public.clinic_finance_shift_expense('spend', jsonb_build_object('shift_id', sid, 'item', 'maintenance', 'amount', '20', 'reason', 'تجربة صيانة', 'receipt_path', '', 'token', gen_random_uuid()));
  exception when others then ok := sqlerrm like '%الإيصال%'; end; if not ok then raise exception 'maintenance without a receipt was accepted'; end if;
  ok := false; begin perform public.clinic_finance_shift_expense('spend', jsonb_build_object('shift_id', sid, 'item', 'tips', 'amount', '5', 'reason', 'عامل', 'receipt_path', '', 'token', gen_random_uuid()));
  exception when others then ok := sqlerrm like '%سبب الإكرامية%'; end; if not ok then raise exception 'short tip reason accepted'; end if;
  execute 'reset role';
  if (select operation_mode from clinic_finance.registers where id = rg) <> 'receive' then raise exception 'fixture register is not receive-only'; end if;
  ok := false; begin perform clinic_finance.post('expense', gen_random_uuid(), 'تجربة صرف عادي', sid, '5216', '1111', 1);
  exception when others then ok := sqlerrm like '%للاستلام فقط%'; end; if not ok then raise exception 'a normal payout from a receive-only register was accepted'; end if;
  if (select evidence from clinic_finance.requests where id = (r->>'id')::uuid) <> 'no-receipt' then raise exception 'evidence marker missing'; end if;
  if not exists (select 1 from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id where e.source = 'shift_expense' and e.source_id = (r->>'id')::uuid and l.account = '5216' and l.debit = 20) then raise exception 'tip not posted to 5216'; end if;
  raise notice 'shift expense items dry-run OK: 12 items, tip without receipt posted 20 to 5216, maintenance without receipt refused, short tip reason refused, normal payout from the receive-only register still refused';
end $$;
rollback;
