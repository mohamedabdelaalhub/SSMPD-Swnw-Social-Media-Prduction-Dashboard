-- Live rollback test for 20261123070000_booking_payer_kind.sql («طريقة الدفع»: كاش / تأمين / تعاقد / نقابات / نوادي).
-- Run the WHOLE file as postgres AFTER 20261123060000 is applied and AFTER 20261123070000 is applied IN THIS SAME TRANSACTION
-- (paste the migration body between «begin;» and the test, or apply it right after «begin;»). ONE transaction, ends with ROLLBACK.
-- Acts as Mazen (reception, auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb). Inside the transaction only: one insurance contract and a
-- price list + item are activated, storage.objects rows for the photos are created. Nothing is kept. Last output = one result table.
begin;
-- >>> apply supabase/migrations/20261123070000_booking_payer_kind.sql here (without its own begin / commit) if not applied yet <<<

create temp table payer_live_results(n serial, step text, expected text, actual text, ok boolean);

do $$
declare
  sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; d date := (now() at time zone 'Africa/Cairo')::date;
  ap clinic_reception.appointments%rowtype; a2 clinic_reception.appointments%rowtype; aid uuid; svc uuid; psid uuid; base numeric;
  ctr uuid; ent_name text; lst uuid; r jsonb; opt jsonb; uni text; o record; q record; n int; ok boolean; err text;
  card text := 'rollback-payer/' || gen_random_uuid() || '.jpg'; proof text := 'rollback-payer/' || gen_random_uuid() || '.jpg';
  prov uuid; pat uuid; wk uuid;
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select id into me from public.admins where user_id = sub;
  if w is null or me is null then raise exception 'live workspace % / admin for sub % missing', w, sub; end if;
  if to_regprocedure('clinic_reception.command_before_payer_kind(uuid,text,jsonb,uuid)') is null then raise exception 'apply 20261123070000 first (inside this transaction)'; end if;
  insert into storage.objects(bucket_id, name, owner) values ('booking-discount-cards', card, sub), ('booking-discount-cards', proof, sub);

  -- a future booked appointment (not a package) whose service is mapped to pricing
  select a.* into ap from clinic_reception.appointments a join clinic_reception.services s on s.id = a.service_id
   where a.workspace_id = w and a.status = 'booked' and a.package_id is null and a.starts_at > now() + interval '2 hours'
     and to_jsonb(s)->>'pricing_service_id' is not null and a.discount_kind is null
   order by a.starts_at limit 1;
  if ap.id is null then raise exception 'no future booked appointment to test on'; end if;
  select s.price, (to_jsonb(s)->>'pricing_service_id')::uuid into base, psid from clinic_reception.services s where s.id = ap.service_id;

  -- temp-activate ONE insurance contract with its own active list + an item for that service (rolled back)
  select c.id, e.name into ctr, ent_name from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id
   where e.category = 'insurance' order by e.name limit 1;
  update public.contracting_entity_contracts set status = 'active', start_date = least(coalesce(start_date, d), d), end_date = null where id = ctr;
  insert into clinic_prices.lists(name, version, contract_id, mode, fallback, valid_from, valid_to, status, created_by, reviewed_by)
    values ('ROLLBACK payer ' || ent_name, 900 + (random() * 99)::int, ctr, 'fixed', 'block', d - 1, d + 60, 'active', me, me) returning id into lst;
  insert into clinic_prices.items(list_id, service_id, fixed_price) values (lst, psid, greatest(round(base * 0.8), 10));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);

  -- (a) options
  begin
    execute 'set local role authenticated';
    opt := public.clinic_reception_payer_options(w, ap.service_id, (ap.starts_at at time zone 'Africa/Cairo')::date);
    execute 'reset role';
    select string_agg(x->>'name', ' / ') into uni from jsonb_array_elements(opt->'unions') x;
    insert into payer_live_results(step, expected, actual, ok) values
      ('a options: contracts', 'only ' || ent_name || ' (temp-activated) with price ' || greatest(round(base * 0.8), 10),
       (select string_agg((x->>'entity_name') || ' ' || coalesce(x->>'price', 'blocked'), ', ') from jsonb_array_elements(opt->'contracts') x),
       jsonb_array_length(opt->'contracts') = 1 and (opt->'contracts'->0->>'contract_id')::uuid = ctr and (opt->'contracts'->0->>'price')::numeric = greatest(round(base * 0.8), 10)),
      ('a options: unions', 'unions / clubs list (no nurseries)', uni, jsonb_array_length(opt->'unions') >= 1
         and not exists (select 1 from jsonb_array_elements(opt->'unions') x where x->>'category' not in ('unions', 'clubs')));
  exception when others then execute 'reset role'; insert into payer_live_results(step, expected, actual, ok) values ('a options', 'works', sqlerrm, false); end;

  -- (b) reschedule (same slot) with payer cash, then reschedule to union → syndicate 30
  begin
    execute 'set local role authenticated';
    r := public.clinic_reception_command(w, 'reschedule', jsonb_build_object('id', ap.id, 'patient_id', ap.patient_id, 'provider_id', ap.provider_id,
           'service_id', ap.service_id, 'starts_at', ap.starts_at, 'same_day_ok', true, 'payer_kind', 'cash'), gen_random_uuid());
    aid := coalesce(nullif(r->>'id', '')::uuid, ap.id);
    select * into a2 from clinic_reception.appointments where id = aid;
    r := public.clinic_reception_command(w, 'reschedule', jsonb_build_object('id', aid, 'patient_id', a2.patient_id, 'provider_id', a2.provider_id,
           'service_id', a2.service_id, 'starts_at', a2.starts_at, 'same_day_ok', true, 'payer_kind', 'union', 'payer_union', 'نقابة المهندسين',
           'payer_card_no', 'RB-1', 'payer_card_expiry', (d + 365)::text, 'payer_card_path', card), gen_random_uuid());
    aid := coalesce(nullif(r->>'id', '')::uuid, aid);
    execute 'reset role';
    select * into a2 from clinic_reception.appointments where id = aid;
    insert into payer_live_results(step, expected, actual, ok) values ('b reschedule → union', 'payer union, discount syndicate 30',
      a2.payer_kind || ' / ' || coalesce(a2.discount_kind, '-') || ' ' || coalesce(a2.discount_percent::text, '-'),
      a2.payer_kind = 'union' and a2.discount_kind = 'syndicate' and a2.discount_percent = 30);
  exception when others then execute 'reset role'; insert into payer_live_results(step, expected, actual, ok) values ('b reschedule cash → union', 'works', sqlerrm, false); end;

  -- (c) set_payer back to cash → 30% cleared
  begin
    execute 'set local role authenticated';
    perform public.clinic_reception_command(w, 'set_payer', jsonb_build_object('id', aid, 'payer_kind', 'cash'), gen_random_uuid());
    execute 'reset role';
    select * into a2 from clinic_reception.appointments where id = aid;
    insert into payer_live_results(step, expected, actual, ok) values ('c set_payer → cash', 'payer cash, no discount',
      a2.payer_kind || ' / ' || coalesce(a2.discount_kind, 'none'), a2.payer_kind = 'cash' and a2.discount_kind is null);
  exception when others then execute 'reset role'; insert into payer_live_results(step, expected, actual, ok) values ('c set_payer cash', 'works', sqlerrm, false); end;

  -- (d) set_payer contract 80% → stored + patient linked; refusals without photo / coverage
  begin
    execute 'set local role authenticated';
    begin
      perform public.clinic_reception_command(w, 'set_payer', jsonb_build_object('id', aid, 'payer_kind', 'contract', 'payer_contract_id', ctr,
        'payer_coupon_no', 'RB-C1', 'payer_auth_ref', 'RB-AP1', 'payer_coverage_percent', '80', 'payer_proof_path', 'rollback-payer/missing.jpg'), gen_random_uuid());
      err := 'accepted';
    exception when others then err := sqlerrm; end;
    execute 'reset role';
    insert into payer_live_results(step, expected, actual, ok) values ('d refused without the photo', 'ارفع صورة الموافقة', err, err like '%صورة الموافقة%');
    execute 'set local role authenticated';
    r := public.clinic_reception_command(w, 'set_payer', jsonb_build_object('id', aid, 'payer_kind', 'contract', 'payer_contract_id', ctr,
        'payer_coupon_no', 'RB-C1', 'payer_auth_ref', 'RB-AP1', 'payer_coverage_percent', '80', 'payer_proof_path', proof), gen_random_uuid());
    execute 'reset role';
    select * into a2 from clinic_reception.appointments where id = aid;
    insert into payer_live_results(step, expected, actual, ok) values ('d set_payer → contract', 'contract ' || ent_name || ' 80% price ' || greatest(round(base * 0.8), 10),
      a2.payer_kind || ' ' || coalesce(a2.payer_entity_name, '-') || ' ' || a2.payer_coverage_percent || '% price ' || a2.payer_price,
      a2.payer_kind = 'contract' and a2.payer_contract_id = ctr and a2.payer_coverage_percent = 80 and a2.payer_price = greatest(round(base * 0.8), 10));
    select count(*) into n from public.contract_patient_links l join clinic_reception.patients p on p.patient_id = l.patient_id
     where p.id = a2.patient_id and l.contract_id = ctr and l.member_reference = 'RB-C1';
    insert into payer_live_results(step, expected, actual, ok) values ('d patient linked to contract',
      case when (select patient_id from clinic_reception.patients where id = a2.patient_id) is null then '0 (no archive file)' else '1' end, n::text,
      n = case when (select patient_id from clinic_reception.patients where id = a2.patient_id) is null then 0 else 1 end);
  exception when others then execute 'reset role'; insert into payer_live_results(step, expected, actual, ok) values ('d set_payer contract', 'works', sqlerrm, false); end;

  -- (d2) arrival path: a walk-in today (contract) for a patient with no booking today, then arrive → order at list price + quote 80
  begin
    select av.provider_id into prov from clinic_reception.availability av where av.workspace_id = w and now() between av.starts_at and av.ends_at order by av.starts_at limit 1;
    select p.id into pat from clinic_reception.patients p where p.workspace_id = w and p.patient_id is not null
       and not exists (select 1 from clinic_reception.appointments x where x.patient_id = p.id and (x.starts_at at time zone 'Africa/Cairo')::date = d)
     order by p.created_at desc limit 1;
    select a.service_id into svc from clinic_reception.appointments a join clinic_reception.services s on s.id = a.service_id
     where a.provider_id = prov and a.package_id is null and to_jsonb(s)->>'pricing_service_id' is not null order by a.starts_at desc limit 1;
    if prov is null or pat is null or svc is null then raise exception 'no provider working now / patient / service (provider %, patient %, service %)', prov, pat, svc; end if;
    insert into clinic_prices.items(list_id, service_id, fixed_price)
      select lst, (to_jsonb(s)->>'pricing_service_id')::uuid, 300 from clinic_reception.services s where s.id = svc on conflict (list_id, service_id) do update set fixed_price = 300;
    execute 'set local role authenticated';
    r := public.clinic_reception_command(w, 'walk_in', jsonb_build_object('patient_id', pat, 'provider_id', prov, 'service_id', svc, 'payer_kind', 'contract',
           'payer_contract_id', ctr, 'payer_coupon_no', 'RB-C2', 'payer_auth_ref', 'RB-AP2', 'payer_coverage_percent', '75', 'payer_proof_path', proof), gen_random_uuid());
    wk := (r->>'id')::uuid;
    perform public.clinic_reception_command(w, 'arrive', jsonb_build_object('id', wk), gen_random_uuid());
    execute 'reset role';
    select ord.* into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id where v.appointment_id = wk order by ord.created_at limit 1;
    select * into q from clinic_reception.order_quotes where order_id = o.id;
    insert into payer_live_results(step, expected, actual, ok) values ('d2 walk_in contract → arrive', 'order 300, discount 0, quote coverage 75, auth RB-AP2',
      'order ' || o.price || ', discount ' || o.discount || ', quote ' || coalesce(q.snapshot->>'coverage', 'none') || ', auth ' || coalesce(q.authorization_ref, '-'),
      o.price = 300 and o.discount = 0 and (q.snapshot->>'coverage')::numeric = 75 and q.authorization_ref = 'RB-AP2');
  exception when others then execute 'reset role'; insert into payer_live_results(step, expected, actual, ok) values ('d2 walk_in contract → arrive', 'works', sqlerrm, false); end;

  -- (e) order_payer on an arrived cash visit (service still ordered, no discount) → contract 70%
  begin
    select ord.id, ord.service_id into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id
      join clinic_reception.appointments a on a.id = v.appointment_id join clinic_reception.services s on s.id = ord.service_id
     where ord.workspace_id = w and ord.status = 'ordered' and ord.entitlement_id is null and ord.discount = 0 and a.discount_kind is null
       and a.payer_kind is distinct from 'contract' and to_jsonb(s)->>'pricing_service_id' is not null
       and not exists (select 1 from clinic_reception.order_quotes x where x.order_id = ord.id)
       and not exists (select 1 from clinic_reception.discount_requests dr join clinic_reception.orders o2 on o2.id = dr.order_id where o2.visit_id = v.id and dr.status in ('pending', 'approved'))
     order by ord.created_at desc limit 1;
    if o.id is null then raise exception 'no arrived visit with an ordered service today'; end if;
    insert into clinic_prices.items(list_id, service_id, fixed_price)
      select lst, (to_jsonb(s)->>'pricing_service_id')::uuid, 250 from clinic_reception.services s where s.id = o.service_id on conflict (list_id, service_id) do update set fixed_price = 250;
    execute 'set local role authenticated';
    r := public.clinic_reception_command(w, 'order_payer', jsonb_build_object('order_id', o.id, 'payer_kind', 'contract', 'payer_contract_id', ctr,
           'payer_coupon_no', 'RB-C3', 'payer_auth_ref', 'RB-AP3', 'payer_coverage_percent', '70', 'payer_proof_path', proof), gen_random_uuid());
    execute 'reset role';
    select * into q from clinic_reception.order_quotes where order_id = o.id;
    insert into payer_live_results(step, expected, actual, ok) values ('e order_payer → contract', 'price 250, patient share 75, quote coverage 70',
      'price ' || (r->>'price') || ', patient ' || (r->>'patient_share') || ', quote ' || coalesce(q.snapshot->>'coverage', 'none'),
      (r->>'price')::numeric = 250 and (select price from clinic_reception.orders where id = o.id) = 250 and (q.snapshot->>'coverage')::numeric = 70
        and (r->>'patient_share')::numeric = round(250 * (select quantity from clinic_reception.orders where id = o.id) * 0.3, 2));
  exception when others then execute 'reset role'; insert into payer_live_results(step, expected, actual, ok) values ('e order_payer contract', 'works', sqlerrm, false); end;

  -- audit has no photo paths
  select count(*) into n from clinic_reception.audit where action in ('set_payer', 'order_payer') and created_at > now() - interval '1 hour'
     and (detail ? 'payer_proof_path' or detail ? 'payer_card_path');
  insert into payer_live_results(step, expected, actual, ok) values ('audit without photo paths', '0', n::text, n = 0);
end $$;

select step, expected, actual, ok from payer_live_results order by n;
rollback;
