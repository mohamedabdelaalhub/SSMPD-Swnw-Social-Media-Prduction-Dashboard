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
begin;

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

commit;
