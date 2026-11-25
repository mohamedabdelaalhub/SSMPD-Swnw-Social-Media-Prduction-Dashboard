-- Live rollback dry-run for 20261125090000_bank_breakdown.sql (needs 20261125030000, applied 2026-11-25 00:11Z). ONE transaction → ROLLBACK.
-- As the FM: «تفصيل» of 1112 answers, rows (إنستا باي / تحويل بنكي) + «other» = the 1112 balance; 1115 / 2120 / 5111 still answer;
-- an unsupported account is refused with the new message. Nothing kept.
begin;
-- ===== migration body (20261125090000) =====
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
-- ===== test =====
do $$
declare fm uuid; b jsonb; s numeric; acc text; ok boolean;
begin
  select a.user_id into fm from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager' order by a.id limit 1;
  if fm is null then raise exception 'need an FM with a login'; end if;
  perform set_config('request.jwt.claim.sub', fm::text, true); execute 'set local role authenticated';
  foreach acc in array array['1112', '1115', '2120', '5111'] loop
    b := public.clinic_finance_account_breakdown(acc, null, null);
    select coalesce(sum((v->>'amount')::numeric), 0) into s from jsonb_array_elements(b->'rows') v;
    if s + (b->>'other')::numeric <> (b->>'total')::numeric then raise exception '% does not add up', acc; end if;
    raise notice '% total % — rows % — other %', acc, b->>'total', b->'rows', b->>'other';
  end loop;
  ok := false; begin perform public.clinic_finance_account_breakdown('4110', null, null);
    exception when others then ok := sqlerrm like '%البنك والمحافظ%'; end;
  execute 'reset role';
  if not ok then raise exception 'unsupported account not refused with the new message'; end if;
  raise notice 'bank breakdown dry-run OK as FM';
end $$;
rollback;
