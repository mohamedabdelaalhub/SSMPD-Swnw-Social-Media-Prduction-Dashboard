-- Live rollback dry-run for 20261124220000_shift_movements_receipt_no.sql («اعرض الرقمين»). ONE transaction ending with ROLLBACK.
-- 1) BEFORE: the financial manager (manager args: all shifts, last 7 days) and a reception cashier (no args: own shift) read movements.
-- 2) the migration body (inlined).
-- 3) AFTER: same two calls. Asserts: no error; every row now has the key 'receipt_no'; removing that key gives EXACTLY the old answer
--    (backward compatible, nothing else changed); each row whose source_id is a reception payment carries that payment's receipt_no.
-- Nothing is kept. Run the whole file as one script.
begin;
do $$ declare fm uuid; rc uuid; v jsonb; d0 date := (now() at time zone 'Africa/Cairo')::date; begin
  select a.user_id into fm from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager' order by a.id limit 1;
  select a.user_id into rc from public.admins a join clinic_finance.shifts s on s.cashier_id = a.id
    where a.active and a.user_id is not null and a.role = 'reception' order by (s.status = 'open') desc, s.opened_at desc limit 1;
  if fm is null or rc is null then raise exception 'dry-run: no financial manager / reception cashier with a shift'; end if;
  perform set_config('dry.fm', fm::text, true); perform set_config('dry.rc', rc::text, true); perform set_config('dry.d0', d0::text, true);
  perform set_config('request.jwt.claim.sub', fm::text, true); execute 'set local role authenticated';
  v := public.clinic_finance_shift_movements(null, d0 - 6, d0); execute 'reset role'; perform set_config('dry.fm_before', v::text, true);
  perform set_config('request.jwt.claim.sub', rc::text, true); execute 'set local role authenticated';
  v := public.clinic_finance_shift_movements(); execute 'reset role'; perform set_config('dry.rc_before', v::text, true);
end $$;
-- ===== migration body (20261124220000) =====
do $$ declare d text; a constant text := $a$'source_id',a.source_id) order by a.at_time$a$; begin
  if to_regprocedure('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)') is null then raise exception 'حركات الخزن غير موجودة'; end if;
  d := pg_get_functiondef('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)'::regprocedure);
  if position('''receipt_no''' in d) > 0 then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'نقطة الربط في حركات الخزن مش موجودة مرة واحدة (md5 %)', md5(d); end if;
  create table clinic_finance.receipt_no_saved_defs(name text primary key, def text not null);
  revoke all on clinic_finance.receipt_no_saved_defs from public, anon, authenticated;
  insert into clinic_finance.receipt_no_saved_defs values ('shift_movements', d);
  execute replace(d, a, $b$'source_id',a.source_id,'receipt_no',(select rp.receipt_no from clinic_reception.payments rp where rp.id = a.source_id)) order by a.at_time$b$);
end $$;
-- ===== checks =====
do $$ declare fm uuid := current_setting('dry.fm')::uuid; rc uuid := current_setting('dry.rc')::uuid; d0 date := current_setting('dry.d0')::date;
  a jsonb; b jsonb; who text; n int; withno int; bad int; begin
  foreach who in array array['fm', 'rc'] loop
    perform set_config('request.jwt.claim.sub', (case who when 'fm' then fm else rc end)::text, true); execute 'set local role authenticated';
    a := case who when 'fm' then public.clinic_finance_shift_movements(null, d0 - 6, d0) else public.clinic_finance_shift_movements() end;
    execute 'reset role';
    b := current_setting('dry.' || who || '_before')::jsonb;
    select count(*), count(*) filter (where m ? 'receipt_no'), count(*) filter (where m->>'receipt_no' is not null) into n, bad, withno
      from jsonb_array_elements(coalesce(a->'movements', '[]')) m;
    if bad <> n then raise exception 'dry-run %: % of % rows lack receipt_no', who, n - bad, n; end if;
    if jsonb_set(a, '{movements}', coalesce((select jsonb_agg(m - 'receipt_no' order by o) from jsonb_array_elements(a->'movements') with ordinality x(m, o)), '[]'))
       is distinct from jsonb_set(b, '{movements}', coalesce(b->'movements', '[]')) then
      raise exception 'dry-run %: answer changed beyond the new key', who; end if;
    select count(*) into bad from jsonb_array_elements(coalesce(a->'movements', '[]')) m join clinic_reception.payments p on p.id::text = m->>'source_id'
      where (m->>'receipt_no') is distinct from p.receipt_no;
    if bad > 0 then raise exception 'dry-run %: % rows with a wrong receipt number', who, bad; end if;
    raise notice 'dry-run % OK: % rows, % with a receipt number, rest of the answer identical', who, n, withno;
  end loop;
end $$;
rollback;
