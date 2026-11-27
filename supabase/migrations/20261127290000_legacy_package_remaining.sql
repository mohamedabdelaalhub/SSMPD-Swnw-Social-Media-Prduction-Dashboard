-- «باكج مدفوع قبل السيستم»: «المدفوع قبل كده» + «الباقي» (owner 2026-11-27 «موافق على المدفوع والباقي في الباكج القديم»).
-- Real case: a laser package bought 02/10 in the old system for ~3,400; ~2,000 paid there, the rest (1,400) paid today in cash.
--   * request: payload.paid_before (0 < paid_before ≤ total; empty = total = the old behaviour). total stays the package value
--     (the sum of the lines, so each session keeps its full value).
--   * approval: Dr 3198 / Cr 2151 for paid_before ONLY (the money that really came before the dashboard). If remaining = total − paid_before
--     > 0, the remaining becomes an ordinary package invoice (kind 'installment', like «قسط باكج معتمد»): Dr 1122 / Cr 2151, funded += it.
--     It is paid through the normal paths («تحصيل» on the invoice / the package) or «استخدام رصيد المريض» (credit_apply, Dr 2150 / Cr 1122).
--   * remaining = 0 → exactly the old behaviour.
-- The three functions are patched in place (anchors checked, the original definitions kept in clinic_reception.legacy_saved_defs for the
-- rollback). Nothing removed. Rollback: supabase/rollbacks/20261127290000_legacy_package_remaining.rollback.sql
begin;

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

commit;
