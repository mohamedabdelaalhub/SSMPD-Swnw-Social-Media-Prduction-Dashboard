-- Live rollback test for 20261123170000_package_offers.sql. ONE transaction ending in ROLLBACK, as postgres; apply the migration body
-- at the marked spot first if it is not applied. Acts as Mazen (reception) on a real active package template of the live workspace:
-- sale refused outside the window, allowed inside (snapshot 25 %), a payment below the minimum refused, the minimum accepted, and the
-- price-editor → template sync. Proof rows for the non-cash test payments are inserted as postgres (rolled back). Nothing is kept.
begin;
-- >>> apply supabase/migrations/20261123170000_package_offers.sql here (without its own begin / commit) if not applied yet <<<
create temp table po_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; ws uuid; t record; pat uuid; r jsonb; err text; pkg uuid; k record; m jsonb;
  d date := (now() at time zone 'Africa/Cairo')::date;
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select id into me from public.admins where user_id = mazen;
  select tp.* into t from clinic_reception.package_templates tp where tp.workspace_id = ws and tp.active and tp.price > 0 and not coalesce(tp.variable_visits, false)
     and tp.code not like 'LEGACY-%' order by tp.price limit 1;
  select p.id into pat from clinic_reception.patients p where p.workspace_id = ws order by p.created_at limit 1;
  insert into po_live(step, expected, actual, ok) values ('test template / patient', 'found', coalesce(t.name, 'none') || ' · ' || coalesce(t.price::text, '-'), t.id is not null and pat is not null);
  -- price editor → active template
  if (to_jsonb(t)->>'pricing_package_id') is not null then
    execute 'update public.pricing_packages set booking_sell_until = $2 - 1, booking_min_first_percent = 25 where id = $1' using (to_jsonb(t)->>'pricing_package_id')::uuid, d;
    select * into k from clinic_reception.package_templates where id = t.id;
    insert into po_live(step, expected, actual, ok) values ('price editor → template (sync trigger)', 'sell_until = yesterday, 25', k.sell_until || ' · ' || k.min_first_percent, k.sell_until = d - 1 and k.min_first_percent = 25);
  else
    update clinic_reception.package_templates set sell_until = d - 1, min_first_percent = 25 where id = t.id;
    insert into po_live(step, expected, actual, ok) values ('price editor → template', 'n/a (template without pricing package)', 'set directly', true);
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  begin
    execute 'set local role authenticated';
    r := public.clinic_reception_command(ws, 'package_sell', jsonb_build_object('patient_id', pat, 'template_id', t.id), gen_random_uuid());
    execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into po_live(step, expected, actual, ok) values ('Mazen sells after the offer ended', 'refused «العرض ده خلص»', err, err like '%العرض ده خلص%');
  execute 'reset role';
  update clinic_reception.package_templates set sell_from = d, sell_until = d + 30, min_first_percent = 25 where id = t.id;
  begin
    execute 'set local role authenticated';
    r := public.clinic_reception_command(ws, 'package_sell', jsonb_build_object('patient_id', pat, 'template_id', t.id), gen_random_uuid());
    execute 'reset role'; pkg := (r->>'id')::uuid; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select * into k from clinic_reception.packages where id = pkg;
  insert into po_live(step, expected, actual, ok) values ('Mazen sells inside the window', 'ok, snapshot 25 %, expires = today + validity', err || ' · ' || coalesce(k.min_first_percent::text, '-') || ' · ' || coalesce(k.expires_on::text, '-'),
    err = 'ok' and k.min_first_percent = 25 and k.expires_on = d + t.validity_days);
  m := clinic_reception.package_min_payment(pkg);
  insert into po_live(step, expected, actual, ok) values ('minimum now', '25 % of the price (first)', m::text, (m->>'first')::boolean and (m->>'minimum')::numeric = round(t.price * 0.25, 2));
  insert into clinic_reception.payment_proofs(workspace_id, admin_id, reference, path) values (ws, me, 'PO-TEST-1', 'test/po-1.jpg'), (ws, me, 'PO-TEST-2', 'test/po-2.jpg');
  begin
    execute 'set local role authenticated';
    r := public.clinic_reception_command(ws, 'collect', jsonb_build_object('patient_id', pat, 'package_id', pkg, 'method', 'instapay', 'reference', 'PO-TEST-1',
           'amount', ((m->>'minimum')::numeric - 1)::text), gen_random_uuid());
    execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into po_live(step, expected, actual, ok) values ('Mazen collects 1 ج below the minimum', 'refused «أقل دفعة للباكج»', err, err like '%أقل دفعة للباكج%');
  begin
    execute 'set local role authenticated';
    r := public.clinic_reception_command(ws, 'collect', jsonb_build_object('patient_id', pat, 'package_id', pkg, 'method', 'instapay', 'reference', 'PO-TEST-2',
           'amount', (m->>'minimum')), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select * into k from clinic_reception.packages where id = pkg;
  insert into po_live(step, expected, actual, ok) values ('Mazen collects the minimum', 'ok, funded = minimum', err || ' · funded ' || k.funded, err = 'ok' and k.funded = (m->>'minimum')::numeric);
  m := clinic_reception.package_min_payment(pkg);
  insert into po_live(step, expected, actual, ok) values ('next minimum', 'later: max(25 %, owed ÷ visits left)', m::text, not (m->>'first')::boolean);
  insert into po_live(step, expected, actual, ok) select 'existing packages untouched', 'min_first_percent NULL on every package sold before', count(*)::text || ' with a rule', count(*) = 1
    from clinic_reception.packages where min_first_percent is not null;
end $$;
select step, expected, actual, ok from po_live order by n;
rollback;
