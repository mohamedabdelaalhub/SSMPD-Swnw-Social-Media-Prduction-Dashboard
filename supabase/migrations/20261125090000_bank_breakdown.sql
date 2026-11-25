-- «تفصيل البنك» (owner 2026-11-25 «ضيف تفصيل البنك»): the chart «تفصيل» on 1112 «البنك» splits what came in by collection
-- method — إنستا باي / تحويل بنكي (reception receipts) — and shows the rest of the account (doctor / supplier payouts, vouchers,
-- deposits, opening balance …) as one «حركات تانية» row, so the rows always add up to the 1112 balance. Read-only; no posting
-- change. In-place anchor patch of public.clinic_finance_account_breakdown (20261125030000); old body saved for rollback.
-- Rollback: supabase/rollbacks/20261125090000_bank_breakdown.rollback.sql
begin;
do $$ declare d text; a constant text := $a$  elsif p_code = '2120' then$a$; begin
  if to_regprocedure('public.clinic_finance_account_breakdown(text,date,date)') is null then raise exception 'طبّق التفصيل (20261125030000) الأول'; end if;
  d := pg_get_functiondef('public.clinic_finance_account_breakdown(text,date,date)'::regprocedure);
  if position($q$p_code = '1112'$q$ in d) > 0 then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'نقطة الربط في التفصيل مش موجودة مرة واحدة (md5 %)', md5(d); end if;
  create table clinic_finance.bank_breakdown_saved_defs(name text primary key, def text not null);
  revoke all on clinic_finance.bank_breakdown_saved_defs from public, anon, authenticated;
  insert into clinic_finance.bank_breakdown_saved_defs values ('account_breakdown', d);
  d := replace(d, 'التفصيل متاح لحسابات المحافظ ومستحقات وأتعاب الأطباء بس', 'التفصيل متاح لحسابات البنك والمحافظ ومستحقات وأتعاب الأطباء بس');
  execute replace(d, a, $b$  elsif p_code = '1112' then
    select coalesce(sum(l.debit - l.credit), 0) into total from clinic_finance.lines l where l.account = '1112';
    select coalesce(jsonb_agg(jsonb_build_object('key', x.m, 'label', case x.m when 'instapay' then 'إنستا باي' else 'تحويل بنكي' end, 'amount', x.amt, 'count', x.n) order by x.m desc), '[]'::jsonb),
           coalesce(sum(x.amt), 0) into rows, split
      from (select p.method m, sum(p.amount) amt, count(*) n from clinic_reception.payments p join clinic_reception.workspaces w on w.id = p.workspace_id
             where w.mode = 'live' and p.method in ('instapay', 'bank') group by p.method) x;
    unset := '[]'::jsonb;
$b$ || a);
end $$;
commit;
