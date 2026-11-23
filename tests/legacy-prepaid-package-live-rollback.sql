-- Live rollback test for 20261123110000_legacy_prepaid_package.sql on the owner's case 2 (the patient of order 6e094d4a…) paid 4,200 on
-- 2026-11-04 for 12 «جلسة علاج طبيعي». Order 6e094d4a… (21/11, ordered, 500) and order 1ab1e7b6… (23/11, executed, 500, unpaid) must
-- consume the package. ONE transaction ending in ROLLBACK, as postgres; apply the migration body at the marked spot first if it is not
-- applied. Mazen (reception) files the request and uses the sessions; another active super admin / financial manager approves.
-- Last output = one result table. Nothing is kept (no cash, no messages).
begin;
-- >>> apply supabase/migrations/20261123110000_legacy_prepaid_package.sql here (without its own begin / commit) if not applied yet <<<
create temp table lp_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; appr uuid; appr_name text; o1 record; o2 record; ws uuid; patient uuid; svc uuid;
  r jsonb; req uuid; pkg uuid; err text; lp jsonb; ent uuid; due numeric;
  procedure_as constant text := 'set local role authenticated';
begin
  select o.*, v.patient_id as vp into o1 from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id where o.id::text like '6e094d4a%';
  select o.*, v.patient_id as vp into o2 from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id where o.id::text like '1ab1e7b6%';
  if o1.id is null or o2.id is null then raise exception 'orders 6e094d4a… / 1ab1e7b6… not found'; end if;
  ws := o1.workspace_id; patient := o1.vp; svc := o1.service_id;
  insert into lp_live(step, expected, actual, ok) select 'patient', 'same patient + same service on both orders',
    s.name, o2.vp = patient and o2.service_id = svc
    from clinic_reception.services s where s.id = svc;
  insert into lp_live(step, expected, actual, ok) values ('before: 6e094d4a', 'ordered 500', o1.status || ' ' || o1.price, o1.status = 'ordered');
  select clinic_reception.due(i.id) into due from clinic_reception.invoices i where i.order_id = o2.id;
  insert into lp_live(step, expected, actual, ok) values ('before: 1ab1e7b6', 'completed, due 500', o2.status || ' due ' || due, o2.status = 'completed' and due > 0);
  select a.user_id, a.name into appr, appr_name from public.admins a
   where a.active and a.user_id is not null and a.user_id <> mazen and a.role in ('financial_manager', 'super_admin') order by (a.role = 'financial_manager') desc limit 1;
  insert into lp_live(step, expected, actual, ok) values ('approver', 'another super admin / FM', coalesce(appr_name, 'none'), appr is not null);

  -- 1) Mazen files «باكج مدفوع قبل السيستم»
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  begin
    execute procedure_as;
    r := public.clinic_reception_command(ws, 'legacy_package_request', jsonb_build_object('patient_id', patient, 'name', '12 جلسة علاج طبيعي',
      'paid_on', '2026-11-04', 'total', '4200', 'receipt_ref', 'تجربة تراجع', 'lines', jsonb_build_array(jsonb_build_object('service_id', svc, 'sessions', 12, 'amount', '4200'))), gen_random_uuid());
    execute 'reset role'; req := (r->>'id')::uuid;
    insert into lp_live(step, expected, actual, ok) values ('request (Mazen)', 'pending, 350 per session', r->>'status' || ' · ' || (r->'lines'->0->>'per_session'), r->>'status' = 'pending' and (r->'lines'->0->>'per_session')::numeric = 350);
  exception when others then execute 'reset role'; insert into lp_live(step, expected, actual, ok) values ('request (Mazen)', 'pending', sqlerrm, false); end;
  -- Mazen cannot approve
  begin
    execute procedure_as; perform public.clinic_reception_legacy_package_review(req, true, null); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into lp_live(step, expected, actual, ok) values ('Mazen approves own', 'refused', err, err <> 'accepted');

  -- 2) approval by the other admin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', appr, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', appr::text, true);
  begin
    execute procedure_as; r := public.clinic_reception_legacy_package_review(req, true, null); execute 'reset role'; pkg := (r->>'package_id')::uuid;
    insert into lp_live(step, expected, actual, ok) values ('approve', 'approved', r->>'status', r->>'status' = 'approved');
  exception when others then execute 'reset role'; insert into lp_live(step, expected, actual, ok) values ('approve', 'approved', sqlerrm, false); end;
  insert into lp_live(step, expected, actual, ok) select 'package', 'active, funded 4200, 12 sessions',
    k.status || ' · ' || k.funded || ' · ' || (select count(*) from clinic_reception.entitlements e where e.package_id = k.id), k.status = 'active' and k.funded = 4200
    and (select count(*) from clinic_reception.entitlements e where e.package_id = k.id) = 12 from clinic_reception.packages k where k.id = pkg;
  insert into lp_live(step, expected, actual, ok) select 'receipt journal', 'Dr 3198 4200 / Cr 2151 4200, no shift',
    string_agg(l.account || ' ' || l.debit || '/' || l.credit, ' · ' order by l.debit desc) || ' shift=' || coalesce(max(j.dimensions->>'shift_id'), 'none'),
    string_agg(l.account || ' ' || l.debit || '/' || l.credit, ' · ' order by l.debit desc) = '3198 4200.00/0.00 · 2151 0.00/4200.00' and max(j.dimensions->>'shift_id') is null
    from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id where j.source = 'legacy_package' and j.source_id = pkg;
  insert into lp_live(step, expected, actual, ok) select 'finance mirror', '3198 + 2151 lines', string_agg(fl.account::text || ' ' || fl.debit || '/' || fl.credit, ' · '), count(*) = 2
    from clinic_reception.journal j join clinic_finance.entries fe on fe.id = j.finance_entry_id join clinic_finance.lines fl on fl.entry_id = fe.id
   where j.source = 'legacy_package' and j.source_id = pkg;

  -- 3) Mazen uses two sessions: the ordered one, then the executed-unpaid one
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  foreach err in array array['6e094d4a', '1ab1e7b6'] loop
    begin
      execute procedure_as;
      lp := public.clinic_reception_legacy_packages(ws, patient);
      select (x->>'entitlement_id')::uuid into ent from jsonb_array_elements(lp->'sessions') x where (x->>'service_id')::uuid = svc limit 1;
      r := public.clinic_reception_command(ws, 'order_use_package', jsonb_build_object('order_id', case err when '6e094d4a' then o1.id else o2.id end, 'entitlement_id', ent), gen_random_uuid());
      execute 'reset role';
      insert into lp_live(step, expected, actual, ok) values ('use package on ' || err, case err when '6e094d4a' then 'value 350, pays 0' else 'executed, 350 covered + 150 credited' end, r::text,
        (r->>'value')::numeric = 350 and (err = '6e094d4a' or (r->>'credited')::numeric = 150));
    exception when others then execute 'reset role'; insert into lp_live(step, expected, actual, ok) values ('use package on ' || err, 'works', sqlerrm, false); end;
  end loop;
  insert into lp_live(step, expected, actual, ok) select 'after: 6e094d4a', 'price 350, entitlement set', o.price || ' · ' || (o.entitlement_id is not null), o.price = 350 and o.entitlement_id is not null
    from clinic_reception.orders o where o.id = o1.id;
  select clinic_reception.due(i.id) into due from clinic_reception.invoices i where i.order_id = o2.id;
  insert into lp_live(step, expected, actual, ok) values ('after: 1ab1e7b6 due', '0', due::text, due = 0);
  insert into lp_live(step, expected, actual, ok) select 'after: 1ab1e7b6 journal', 'package_use 2151/1122 350 · diff 4192/1122 150 · fee 2120/5111',
    string_agg(j.source || ' ' || l.account || ' ' || l.debit || '/' || l.credit, ' · ' order by j.source, l.debit desc),
    bool_or(j.source = 'package_use' and l.account = '2151' and l.debit = 350) and bool_or(j.source = 'package_price_diff' and l.account = '4192' and l.debit = 150)
    from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id
   where j.source_id = o2.id and j.source in ('package_use', 'package_price_diff', 'package_price_diff_fee');
  select (x->>'left')::int into due from jsonb_array_elements(public.clinic_reception_legacy_packages(ws, patient)->'sessions') x where (x->>'service_id')::uuid = svc limit 1;
  insert into lp_live(step, expected, actual, ok) values ('sessions left', '10 of 12', due::text, due = 10);
end $$;
select step, expected, actual, ok from lp_live order by n;
rollback;
