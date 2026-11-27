-- Live rollback test for 20261127290000_legacy_package_remaining.sql («المدفوع قبل كده» + «الباقي» in «باكج مدفوع قبل السيستم»).
-- Run the WHOLE file as postgres, BEFORE the apply. ONE transaction, ends with ROLLBACK — no package, no invoice, nothing kept.
-- Reception = Mazen (auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb); approver = an active financial manager (else super admin), not Mazen.
-- One live patient file, two active services of the live workspace (2 sessions × 300 + 1 session × 200 = 800; 500 paid before).
-- Rows: 1 request refusals (paid before > package / 0) · 2 request 500 of 800 → pending, remaining 300 · 3 the approver sees both numbers ·
-- 4 approve → Dr 3198 / Cr 2151 = 500 (reception journal + finance mirror), package 800 funded 800, a 300 'installment' invoice due,
-- Dr 1122 / Cr 2151 = 300 · 5 paid before empty → old behaviour (3198 = total, no invoice) · 6 grants · 7 rollback refuses once used.
do $$ begin
  if to_regclass('clinic_reception.legacy_saved_defs') is not null then
    raise exception '20261127290000 already applied — this dry-run is for before the apply'; end if;
end $$;

begin;
create temp table lp_live(n serial, step text, expected text, actual text, ok boolean);
create temp table lp_fx(sub uuid, me uuid, w uuid, pat uuid, s1 uuid, s2 uuid, asub uuid, req uuid, req0 uuid);
do $$ declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; pat uuid; s1 uuid; s2 uuid; asub uuid;
begin
  select id into me from public.admins where user_id = sub;
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if me is null or w is null then raise exception 'Mazen / live workspace missing'; end if;
  select p.id into pat from clinic_reception.patients p where p.workspace_id = w order by p.created_at desc limit 1;
  select s.id into s1 from clinic_reception.services s where s.workspace_id = w and coalesce(s.active, true) order by s.name limit 1;
  select s.id into s2 from clinic_reception.services s where s.workspace_id = w and coalesce(s.active, true) and s.id <> s1 order by s.name limit 1;
  select a.user_id into asub from public.admins a where a.active and a.id <> me and a.user_id is not null and a.role in ('financial_manager', 'super_admin') order by a.role = 'financial_manager' desc limit 1;
  insert into lp_fx values (sub, me, w, pat, s1, s2, asub, null, null);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  insert into lp_live(step, expected, actual, ok) values ('fixture', 'Mazen, live workspace, a patient file, 2 services, an approver',
    'patient ' || (pat is not null) || ' · services ' || (s1 is not null and s2 is not null) || ' · approver ' || (asub is not null), pat is not null and s1 is not null and s2 is not null and asub is not null);
end $$;

-- >>> MIGRATION BODY: supabase/migrations/20261127290000_legacy_package_remaining.sql (between its begin; / commit;) >>>

do $$ begin
  if to_regclass('clinic_reception.legacy_package_requests') is null or to_regprocedure('clinic_reception.legacy_package_request(uuid,jsonb,uuid)') is null
     or to_regprocedure('public.clinic_reception_legacy_package_review(uuid,boolean,text)') is null
     or to_regprocedure('public.clinic_reception_legacy_packages(uuid,uuid)') is null then
    raise exception 'باكج مدفوع قبل السيستم غير موجود (20261123110000)'; end if;
  if to_regclass('clinic_reception.legacy_saved_defs') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.legacy_package_requests add column paid_before numeric(14,2);
alter table clinic_reception.legacy_package_requests add constraint legacy_paid_before_range check (paid_before is null or (paid_before > 0 and paid_before <= total));

create table clinic_reception.legacy_saved_defs(name text primary key, def text not null);
revoke all on clinic_reception.legacy_saved_defs from public, anon, authenticated;
insert into clinic_reception.legacy_saved_defs values
  ('request', pg_get_functiondef('clinic_reception.legacy_package_request(uuid,jsonb,uuid)'::regprocedure)),
  ('review', pg_get_functiondef('public.clinic_reception_legacy_package_review(uuid,boolean,text)'::regprocedure)),
  ('list', pg_get_functiondef('public.clinic_reception_legacy_packages(uuid,uuid)'::regprocedure));

-- the remaining as an ordinary package invoice (the same posting as an approved installment)
create function clinic_reception.legacy_remaining_invoice(p_request uuid, p_package uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r clinic_reception.legacy_package_requests%rowtype; rem numeric; v uuid;
begin
  select * into r from clinic_reception.legacy_package_requests where id = p_request;
  rem := r.total - coalesce(r.paid_before, r.total);
  if rem <= 0 then return null; end if;
  insert into clinic_reception.invoices(workspace_id, patient_id, package_id, kind, amount, description)
    values (r.workspace_id, r.patient_id, p_package, 'installment', rem,
            'باقي باكج مدفوع قبل السيستم — اتدفع قبل كده ' || to_char(r.paid_before, 'FM999999990.##') || ' من ' || to_char(r.total, 'FM999999990.##'))
    returning id into v;
  perform clinic_reception.post(r.workspace_id, 'package_installment', v, 'استحقاق باقي باكج مدفوع قبل السيستم', '1122', '2151', rem,
    jsonb_build_object('patient_id', r.patient_id, 'package_id', p_package, 'invoice_id', v, 'legacy_request_id', r.id));
  update clinic_reception.packages set funded = funded + rem where id = p_package;
  return v;
end $$;
revoke all on function clinic_reception.legacy_remaining_invoice(uuid, uuid) from public, anon, authenticated;

-- patch helper: every anchor must be found exactly once
create function pg_temp.patch(p_fn text, p_pairs text[]) returns void language plpgsql as $$
declare d text; i int;
begin
  d := pg_get_functiondef(p_fn::regprocedure);
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(d) - length(replace(d, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception 'Anchor % not found once in % (md5 %)', i, p_fn, md5(pg_get_functiondef(p_fn::regprocedure)); end if;
    d := replace(d, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute d;
end $$;

-- 1) request: «المدفوع قبل كده»
select pg_temp.patch('clinic_reception.legacy_package_request(uuid,jsonb,uuid)', array[
  $a$declare pat uuid; d date; tot numeric; ls jsonb; v uuid;$a$,
  $b$declare pat uuid; d date; tot numeric; ls jsonb; v uuid; pb numeric;$b$,
  $a$  ls := clinic_reception.legacy_lines(p_workspace, p->'lines', tot);$a$,
  $b$  ls := clinic_reception.legacy_lines(p_workspace, p->'lines', tot);
  -- «المدفوع قبل كده» (owner 2026-11-27): empty = all of it was paid before (the old behaviour)
  if nullif(btrim(coalesce(p->>'paid_before', '')), '') is null then pb := null;
  else
    begin pb := round((p->>'paid_before')::numeric, 2); exception when others then raise exception 'اكتب المدفوع قبل كده رقم'; end;
    if pb <= 0 then raise exception 'المدفوع قبل كده لازم يبقى أكبر من صفر'; end if;
    if pb > tot then raise exception 'المدفوع قبل كده (%) أكبر من قيمة الباكج (%)', pb, tot; end if;
    if pb = tot then pb := null; end if;
  end if;$b$,
  $a$  insert into clinic_reception.legacy_package_requests(workspace_id, patient_id, name, paid_on, total, lines, receipt_ref, created_by)
    values (p_workspace, pat, left(btrim(p->>'name'), 120), d, tot, ls, left(btrim(coalesce(p->>'receipt_ref', '')), 200), p_me) returning id into v;
  return jsonb_build_object('id', v, 'status', 'pending', 'lines', ls);$a$,
  $b$  insert into clinic_reception.legacy_package_requests(workspace_id, patient_id, name, paid_on, total, lines, receipt_ref, created_by, paid_before)
    values (p_workspace, pat, left(btrim(p->>'name'), 120), d, tot, ls, left(btrim(coalesce(p->>'receipt_ref', '')), 200), p_me, pb) returning id into v;
  return jsonb_build_object('id', v, 'status', 'pending', 'lines', ls, 'paid_before', coalesce(pb, tot), 'remaining', tot - coalesce(pb, tot));$b$]);

-- 2) approval: 3198 only for the money paid before; the remaining → an ordinary package invoice
select pg_temp.patch('public.clinic_reception_legacy_package_review(uuid,boolean,text)', array[
  $a$  val numeric; je uuid; fe uuid; descr text; dims jsonb; visits int;$a$,
  $b$  val numeric; je uuid; fe uuid; descr text; dims jsonb; visits int; pb numeric; rinv uuid;$b$,
  $a$  perform clinic_finance.lock_day();$a$,
  $b$  perform clinic_finance.lock_day();
  pb := coalesce(r.paid_before, r.total);$b$,
  $a$  insert into clinic_reception.journal_lines values (je, '3198', r.total, 0), (je, '2151', 0, r.total);$a$,
  $b$  insert into clinic_reception.journal_lines values (je, '3198', pb, 0), (je, '2151', 0, pb);$b$,
  $a$    insert into clinic_finance.lines(entry_id, account, debit, credit) values (fe, '3198', r.total, 0), (fe, clinic_reception.account('2151'), 0, r.total);$a$,
  $b$    insert into clinic_finance.lines(entry_id, account, debit, credit) values (fe, '3198', pb, 0), (fe, clinic_reception.account('2151'), 0, pb);$b$,
  $a$  update clinic_reception.packages set funded = r.total where id = pkg;$a$,
  $b$  update clinic_reception.packages set funded = pb where id = pkg;
  rinv := clinic_reception.legacy_remaining_invoice(r.id, pkg);$b$,
  $a$values (r.workspace_id, me, 'legacy_package_approve', r.id, jsonb_build_object('package_id', pkg, 'total', r.total, 'paid_on', r.paid_on));
  return jsonb_build_object('id', r.id, 'status', 'approved', 'package_id', pkg, 'journal_id', je, 'finance_entry_id', fe);$a$,
  $b$values (r.workspace_id, me, 'legacy_package_approve', r.id, jsonb_build_object('package_id', pkg, 'total', r.total, 'paid_on', r.paid_on, 'paid_before', pb, 'remaining', r.total - pb, 'remaining_invoice', rinv));
  return jsonb_build_object('id', r.id, 'status', 'approved', 'package_id', pkg, 'journal_id', je, 'finance_entry_id', fe, 'paid_before', pb, 'remaining', r.total - pb, 'remaining_invoice', rinv);$b$]);

-- 3) the approvals list shows both numbers
select pg_temp.patch('public.clinic_reception_legacy_packages(uuid,uuid)', array[
  $a$'paid_on', r.paid_on, 'total', r.total,$a$,
  $b$'paid_on', r.paid_on, 'total', r.total, 'paid_before', coalesce(r.paid_before, r.total), 'remaining', r.total - coalesce(r.paid_before, r.total),$b$]);

-- <<< END MIGRATION BODY <<<

create function pg_temp.req(f lp_fx, pb text, tag text) returns jsonb language plpgsql as $$
declare p jsonb;
begin
  p := jsonb_build_object('patient_id', f.pat, 'name', 'اختبار باقي باكج ' || tag, 'paid_on', ((now() at time zone 'Africa/Cairo')::date - 40)::text, 'total', '800',
        'receipt_ref', 'DRY-RUN', 'lines', jsonb_build_array(jsonb_build_object('service_id', f.s1, 'sessions', 2, 'amount', '600'), jsonb_build_object('service_id', f.s2, 'sessions', 1, 'amount', '200')));
  if pb is not null then p := p || jsonb_build_object('paid_before', pb); end if;
  return public.clinic_reception_command(f.w, 'legacy_package_request', p, gen_random_uuid());
end $$;

-- 1) refusals
do $$ declare f lp_fx; e1 text := 'ok'; e2 text := 'ok';
begin select * into f from lp_fx; execute 'set local role authenticated';
  begin perform pg_temp.req(f, '900', 'A'); exception when others then e1 := sqlerrm; end;
  begin perform pg_temp.req(f, '0', 'B'); exception when others then e2 := sqlerrm; end;
  execute 'reset role';
  insert into lp_live(step, expected, actual, ok) values ('1 refusals', '> package and 0 refused', e1 || ' · ' || e2, e1 like '%أكبر من قيمة الباكج%' and e2 like '%أكبر من صفر%');
end $$;

-- 2) 500 of 800
do $$ declare f lp_fx; r jsonb; err text := 'ok';
begin select * into f from lp_fx; execute 'set local role authenticated';
  begin r := pg_temp.req(f, '500', 'C'); exception when others then err := sqlerrm; end; execute 'reset role';
  update lp_fx set req = nullif(r->>'id', '')::uuid;
  insert into lp_live(step, expected, actual, ok) values ('2 request 500 of 800 (Mazen)', 'pending, paid_before 500, remaining 300',
    err || ' · ' || coalesce(r->>'status', '-') || ' · ' || coalesce(r->>'paid_before', '-') || ' / ' || coalesce(r->>'remaining', '-'),
    err = 'ok' and r->>'status' = 'pending' and (r->>'paid_before')::numeric = 500 and (r->>'remaining')::numeric = 300);
end $$;

-- 3 + 4) the approver sees and approves
do $$ declare f lp_fx; l jsonb; it jsonb; a jsonb; err text := 'ok'; pk record; inv record; j3198 numeric; f3198 numeric; jinst numeric;
begin select * into f from lp_fx;
  if f.req is null or f.asub is null then insert into lp_live(step, expected, actual, ok) values ('3/4 approve', 'split visible, 3198 = 500, invoice 300', 'skipped: no request / approver', false); return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', f.asub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f.asub::text, true);
  execute 'set local role authenticated';
  begin
    l := public.clinic_reception_legacy_packages(f.w, null);
    select e into it from jsonb_array_elements(l->'pending') e where e->>'id' = f.req::text;
    a := public.clinic_reception_legacy_package_review(f.req, true, 'اختبار — يتلغي');
  exception when others then err := sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f.sub::text, true);
  insert into lp_live(step, expected, actual, ok) values ('3 approver sees the split', 'paid_before 500 · remaining 300 in the pending list',
    err || ' · ' || coalesce(it->>'paid_before', '-') || ' / ' || coalesce(it->>'remaining', '-'), (it->>'paid_before')::numeric = 500 and (it->>'remaining')::numeric = 300);
  if err <> 'ok' then insert into lp_live(step, expected, actual, ok) values ('4 approve', 'approved', err, false); return; end if;
  select * into pk from clinic_reception.packages where id = (a->>'package_id')::uuid;
  select * into inv from clinic_reception.invoices where id = (a->>'remaining_invoice')::uuid;
  select sum(l2.debit) into j3198 from clinic_reception.journal j join clinic_reception.journal_lines l2 on l2.entry_id = j.id where j.source = 'legacy_package' and j.source_id = pk.id and l2.account = '3198';
  select sum(fl.debit) into f3198 from clinic_reception.journal j join clinic_finance.lines fl on fl.entry_id = j.finance_entry_id where j.source = 'legacy_package' and j.source_id = pk.id and fl.account = '3198';
  select sum(l3.debit) into jinst from clinic_reception.journal j join clinic_reception.journal_lines l3 on l3.entry_id = j.id where j.source = 'package_installment' and j.source_id = inv.id and l3.account = '1122';
  insert into lp_live(step, expected, actual, ok) values ('4 approve', '3198 = 500 (journal + finance), package 800 funded 800, invoice 300 due (Dr 1122 300)',
    '3198 ' || coalesce(j3198, 0) || ' / fin ' || coalesce(f3198::text, 'n/a') || ' · pkg ' || pk.contract_price || ' funded ' || pk.funded || ' · invoice ' || coalesce(inv.amount::text, '-') || ' due ' || coalesce(clinic_reception.due(inv.id)::text, '-') || ' · 1122 ' || coalesce(jinst, 0),
    j3198 = 500 and coalesce(f3198, 500) = 500 and pk.contract_price = 800 and pk.funded = 800 and inv.amount = 300 and clinic_reception.due(inv.id) = 300 and jinst = 300);
end $$;

-- 5) paid before empty → old behaviour
do $$ declare f lp_fx; r jsonb; a jsonb; err text := 'ok'; j numeric; n int;
begin select * into f from lp_fx; execute 'set local role authenticated';
  begin r := pg_temp.req(f, null, 'D'); exception when others then err := sqlerrm; end; execute 'reset role';
  if err = 'ok' and f.asub is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', f.asub, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', f.asub::text, true);
    execute 'set local role authenticated';
    begin a := public.clinic_reception_legacy_package_review((r->>'id')::uuid, true, null); exception when others then err := sqlerrm; end;
    execute 'reset role';
    perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', f.sub::text, true);
  end if;
  select sum(l.debit) into j from clinic_reception.journal jj join clinic_reception.journal_lines l on l.entry_id = jj.id where jj.source = 'legacy_package' and jj.source_id = (a->>'package_id')::uuid and l.account = '3198';
  select count(*) into n from clinic_reception.invoices where package_id = (a->>'package_id')::uuid;
  insert into lp_live(step, expected, actual, ok) values ('5 nothing remaining = old behaviour', '3198 = 800, no invoice', err || ' · 3198 ' || coalesce(j, 0) || ' · invoices ' || n, err = 'ok' and j = 800 and n = 0);
end $$;

-- 6) grants (unchanged)
insert into lp_live(step, expected, actual, ok)
select '6 grants', 'review / list: authenticated yes, anon no',
  'auth ' || (has_function_privilege('authenticated', 'public.clinic_reception_legacy_package_review(uuid,boolean,text)', 'execute') and has_function_privilege('authenticated', 'public.clinic_reception_legacy_packages(uuid,uuid)', 'execute'))
  || ' · anon ' || (has_function_privilege('anon', 'public.clinic_reception_legacy_package_review(uuid,boolean,text)', 'execute') or has_function_privilege('anon', 'public.clinic_reception_legacy_packages(uuid,uuid)', 'execute')),
  has_function_privilege('authenticated', 'public.clinic_reception_legacy_package_review(uuid,boolean,text)', 'execute') and has_function_privilege('authenticated', 'public.clinic_reception_legacy_packages(uuid,uuid)', 'execute')
  and not (has_function_privilege('anon', 'public.clinic_reception_legacy_package_review(uuid,boolean,text)', 'execute') or has_function_privilege('anon', 'public.clinic_reception_legacy_packages(uuid,uuid)', 'execute'));

-- 7) rollback body refuses once «المدفوع قبل كده» was used (supabase/rollbacks/20261127290000_legacy_package_remaining.rollback.sql)
do $$ declare err text := 'ok';
begin
  begin
    if exists (select 1 from clinic_reception.legacy_package_requests where paid_before is not null) then
      raise exception 'مينفعش الرجوع: فيه طلبات اتسجلت بالمدفوع قبل كده والباقي'; end if;
    raise exception 'rollback would continue (unexpected)';
  exception when others then err := sqlerrm; end;
  insert into lp_live(step, expected, actual, ok) values ('7 rollback refuses after use', '«مينفعش الرجوع»', err, err like 'مينفعش الرجوع%');
end $$;

select step, expected, actual, ok from lp_live order by n;
rollback;
