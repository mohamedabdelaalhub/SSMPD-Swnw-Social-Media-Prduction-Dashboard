-- «تسوية فروق الخزن» — never settle past zero (follow-up to 20261124190000, before its UI ships).
-- Why: a later cash case on the same drawer already contains the earlier one (its expected cash starts from the carried, already
-- negative, drawer book). Mariam: case 1 +1,090, case 2 +2,280 = 1,090 + 1,190 — the real unrecorded cash is 2,280, the book is
-- −2,280. Settling both cases in full would book 1,090 of income that never existed and leave the drawer at +1,090.
-- Rule now: the settlement amount = the case difference, CAPPED at what brings the drawer book back to 0 (never past it):
--   surplus  (difference > 0): min(difference, −book) when the book is negative, else 0;
--   shortage (difference < 0): min(−difference, book) when the book is positive, else 0.
-- 0 → refused («الخزينة متظبطة بالفعل …»): close the case without a settlement (e.g. it is included in a later case, or the real
-- receipts were recorded). The book counts CLOSED shifts only, so cash the cashier is still holding on an open shift does not
-- shrink an old settlement. Checked when the maker files AND again when the checker approves (the book may move in between); the
-- approved entry uses the capped amount. 'list' returns 'settle_amount' so the screen shows the real figure.
-- In-place anchor patch of public.clinic_finance_case_settle (body saved for rollback).
-- Rollback: supabase/rollbacks/20261125050000_cash_case_settle_cap.rollback.sql
begin;

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

commit;
