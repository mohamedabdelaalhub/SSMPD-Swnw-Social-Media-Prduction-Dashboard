-- Live rollback dry-run for 20261125070000_payout_reference_message.sql (rule 9, as the financial manager). ONE transaction → ROLLBACK.
-- 1) migration body; 2) as the FM: a doctor payout with reference «1» on a doctor that has money payable now → refused with
-- «مرجع السداد لازم يكون حرفين على الأقل»; 3) the same payout with reference «نقدي-25-11-2026» (bank method) is ACCEPTED (pending
-- request id returned) — i.e. the button's real RPC works for the FM; 4) a wrong amount (withheld ≠ %) still gets its own message.
-- Nothing is kept.
begin;
-- ===== migration body (20261125070000) =====

do $$
declare a constant text := $a$ or length(trim(coalesce(p_payload->>'reference','')))<2 then raise exception 'راجع مبالغ التسوية ومرجع السداد';end if;$a$;
  b constant text := $b$ then raise exception 'راجع مبالغ التسوية';end if;
 if length(trim(coalesce(p_payload->>'reference','')))<2 then raise exception 'مرجع السداد لازم يكون حرفين على الأقل (مثلاً رقم الإيصال أو التحويل)';end if;$b$;
  f record; n int := 0; d text;
begin
  if exists (select 1 from pg_proc where position('مرجع السداد لازم يكون حرفين' in prosrc) > 0) then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  create table clinic_finance.payout_ref_saved_defs(oid_name text primary key, def text not null);
  revoke all on clinic_finance.payout_ref_saved_defs from public, anon, authenticated;
  for f in select p.oid, p.oid::regprocedure::text as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname in ('public', 'clinic_finance') and position(a in p.prosrc) > 0 loop
    n := n + 1;
    d := pg_get_functiondef(f.oid);
    if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'نقطة الربط مش موجودة مرة واحدة في % (md5 %)', f.sig, md5(d); end if;
    insert into clinic_finance.payout_ref_saved_defs values (f.sig, d);
    execute replace(d, a, b);
  end loop;
  if n = 0 then raise exception 'شرط مرجع السداد في أمر الطبيب مش موجود — راجع آخر نسخة'; end if;
  if n > 1 then raise exception 'لقيت % دوال فيها نفس الشرط — راجعها قبل التطبيق', n; end if;
end $$;

-- ===== test =====
do $$
declare fm uuid; k text; pay numeric; ok boolean; msg text; v uuid; d0 date := (now() at time zone 'Africa/Cairo')::date;
begin
  select a.user_id into fm from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager' order by a.id limit 1;
  if fm is null then raise exception 'no financial manager with a login'; end if;
  select x.doctor_key, x.p into k, pay from (select c.doctor_key, greatest(0, clinic_finance.doctor_balance(c.doctor_key) - clinic_finance.doctor_held_fees(c.doctor_key)
      - coalesce((select sum(gross) from clinic_finance.doctor_payouts p where p.doctor_key = c.doctor_key and p.status = 'pending'), 0)) p
    from (select distinct doctor_key from clinic_finance.doctor_contracts where status = 'active') c) x where x.p >= 1 order by x.p desc limit 1;
  if k is null then raise exception 'no doctor with at least 1 EGP payable now — cannot exercise the reference check'; end if;
  perform set_config('request.jwt.claim.sub', fm::text, true); execute 'set local role authenticated';
  ok := false; begin
    perform public.clinic_finance_doctor_command('payout', jsonb_build_object('doctor_key', k, 'gross', 1, 'tax_pct', 0, 'withholding_pct', 0, 'withheld', 0,
      'method', 'bank', 'reference', '1', 'from', d0 - 30, 'to', d0), gen_random_uuid());
  exception when others then msg := sqlerrm; ok := sqlerrm like '%مرجع السداد لازم يكون حرفين%'; end;
  if not ok then execute 'reset role'; raise exception 'reference «1» not refused with the new message: %', msg; end if;
  ok := false; begin
    perform public.clinic_finance_doctor_command('payout', jsonb_build_object('doctor_key', k, 'gross', 1, 'tax_pct', 5, 'withholding_pct', 0, 'withheld', 0,
      'method', 'bank', 'reference', 'REF-OK', 'from', d0 - 30, 'to', d0), gen_random_uuid());
  exception when others then msg := sqlerrm; ok := sqlerrm not like '%مرجع السداد%'; end;
  if not ok then execute 'reset role'; raise exception 'amount error mentions the reference: %', msg; end if;
  v := public.clinic_finance_doctor_command('payout', jsonb_build_object('doctor_key', k, 'gross', 1, 'tax_pct', 0, 'withholding_pct', 0, 'withheld', 0,
      'method', 'bank', 'reference', 'نقدي-' || to_char(d0, 'DD-MM-YYYY'), 'from', d0 - 30, 'to', d0), gen_random_uuid());
  execute 'reset role';
  if v is null then raise exception 'valid payout not created'; end if;
  raise notice 'payout reference dry-run OK as FM: doctor % (payable %), «1» refused with the clear message, amount error separate, valid request % created (rolled back)', k, pay, v;
end $$;
rollback;
