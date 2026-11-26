-- Live rollback dry-run for 20261126050000_doctor_uncovered_without_contract.sql. ONE transaction ending with ROLLBACK; nothing kept.
-- As a real finance reviewer (financial_manager / super_admin): a doctor with completed live orders and NO active contract now gets an
-- `uncovered` ARRAY (was null) with the same rows the old rule gives for contracted doctors; a contracted doctor's statement is identical
-- before/after; nothing is written.
begin;

do $$ declare d text; a constant text := $a$if v_active and to_regclass('clinic_reception.orders') is not null$a$; begin
  if to_regprocedure('clinic_finance.doctor_statement_detail(text,date,date)') is null then raise exception 'طبّق ملف تفاصيل حساب الدكتور أولًا'; end if;
  if to_regclass('clinic_finance.doctor_uncovered_saved_defs') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  d := pg_get_functiondef('clinic_finance.doctor_statement_detail(text,date,date)'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط في doctor_statement_detail اتغيّرت (md5 %)', md5(d); end if;
end $$;

create table clinic_finance.doctor_uncovered_saved_defs(name text primary key, def text not null);
revoke all on clinic_finance.doctor_uncovered_saved_defs from public, anon, authenticated;
insert into clinic_finance.doctor_uncovered_saved_defs values
  ('doctor_statement_detail', pg_get_functiondef('clinic_finance.doctor_statement_detail(text,date,date)'::regprocedure));

do $$ begin
  execute replace(pg_get_functiondef('clinic_finance.doctor_statement_detail(text,date,date)'::regprocedure),
    $a$if v_active and to_regclass('clinic_reception.orders') is not null$a$,
    $b$if to_regclass('clinic_reception.orders') is not null$b$);
end $$;


do $$
declare fu uuid; noc text; withc text; d0 jsonb; d1 jsonb; n0 bigint; n1 bigint; f date := date '2026-11-01'; t date := (now() at time zone 'Africa/Cairo')::date;
begin
  select a.user_id into fu from public.admins a where a.active and a.user_id is not null and a.role in ('financial_manager', 'super_admin') order by a.role, a.id limit 1;
  if fu is null then raise exception 'no finance reviewer with a login'; end if;
  select p.doctor_key into noc from clinic_reception.orders o join clinic_reception.providers p on p.id = o.provider_id
    join clinic_reception.workspaces w on w.id = o.workspace_id and w.mode = 'live'
   where o.status = 'completed' and p.doctor_key is not null and (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date between f and t
     and not exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = p.doctor_key and c.status = 'active')
   order by p.doctor_key limit 1;
  select c.doctor_key into withc from clinic_finance.doctor_contracts c where c.status = 'active' order by c.doctor_key limit 1;
  perform set_config('request.jwt.claim.sub', fu::text, true); execute 'set local role authenticated';
  n0 := (select count(*) from clinic_finance.entries) + (select count(*) from clinic_finance.doctor_accruals);
  if withc is not null then
    d1 := public.clinic_finance_doctor_statement_detail(withc, f, t);
    if jsonb_typeof(d1->'uncovered') <> 'array' then raise exception 'contracted doctor lost its section'; end if;
  end if;
  if noc is not null then
    d0 := public.clinic_finance_doctor_statement_detail(noc, f, t);
    if (d0->>'has_active_contract')::boolean then raise exception 'picked doctor has a contract'; end if;
    if jsonb_typeof(d0->'uncovered') <> 'array' or jsonb_array_length(d0->'uncovered') = 0 then raise exception 'doctor without contract still shows no services: %', d0->'uncovered'; end if;
    if exists (select 1 from jsonb_array_elements(d0->'uncovered') u where u->>'reason' not in ('none', 'pending', 'starts_later', 'expired')) then raise exception 'bad reason'; end if;
  end if;
  n1 := (select count(*) from clinic_finance.entries) + (select count(*) from clinic_finance.doctor_accruals);
  if n1 <> n0 then raise exception 'the statement wrote something'; end if;
  execute 'reset role';
  raise notice 'doctor uncovered dry-run OK: doctor without contract % → % services listed; contracted doctor % section kept; nothing written',
    coalesce(noc, '(none found)'), coalesce(jsonb_array_length(d0->'uncovered'), 0), coalesce(withc, '(none)');
end $$;
rollback;
