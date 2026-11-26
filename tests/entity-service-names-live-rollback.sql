-- Live rollback test for 20261126090000_entity_service_names.sql («اسم سونو واسم الجهة» in the reception service search).
-- Run the WHOLE file as postgres. ONE transaction, ends with ROLLBACK — nothing is kept (no booking, no quote, no list change).
-- The migration body is pasted below between the markers (it must NOT be applied yet: the guard stops otherwise).
-- Acts as Mazen (reception, auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb). Picks a REAL active contract with an active price list
-- valid today, preferring one whose items carry the entity's own names (external_name); falls back gracefully: no item for the
-- walk-in service → a temporary item «ROLLBACK EXT NAME / RB-EXT-1» (rolled back); no active contract at all → one insurance
-- contract is temp-activated with a temp list (rolled back). A walk-in (first free slot from now, via the normal command) is saved
-- with that contract, then arrived → order_quotes.snapshot must carry entity_service_name / entity_service_code.
-- At the end the rollback body runs too (payer_quote restored, RPC gone). Last output = one result table (step, expected, actual, ok).
do $$ begin
  if to_regprocedure('clinic_reception.payer_price(uuid,uuid,date)') is null or to_regprocedure('clinic_reception.payer_quote(uuid,uuid)') is null then
    raise exception 'طبّق طريقة الدفع (20261123070000) الأول'; end if;
  if to_regprocedure('clinic_reception.payer_quote_before_entity_names(uuid,uuid)') is not null then
    raise exception '20261126090000 already applied — delete the block between the MIGRATION markers below and re-run'; end if;
end $$;

begin;
savepoint esn_guard;

-- >>> MIGRATION BODY: supabase/migrations/20261126090000_entity_service_names.sql (between its begin; / commit;) >>>
-- the entity's own name / code for a reception service under the contract's list that payer_price uses on that day
create function clinic_reception.entity_service_name(p_contract uuid, p_service uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare pr jsonb; psid uuid; it jsonb;
begin
  pr := clinic_reception.payer_price(p_contract, p_service, p_day);
  if pr is null or pr->>'list_id' is null then return null; end if;
  select nullif(to_jsonb(s)->>'pricing_service_id', '')::uuid into psid from clinic_reception.services s where s.id = p_service;
  if psid is null then return jsonb_build_object('name', null, 'code', null, 'list_id', pr->>'list_id'); end if;
  select to_jsonb(i) into it from clinic_prices.items i where i.list_id = (pr->>'list_id')::uuid and i.service_id = psid;
  return jsonb_build_object('name', nullif(btrim(coalesce(it->>'external_name', '')), ''), 'code', nullif(btrim(coalesce(it->>'external_code', '')), ''),
    'list_id', pr->>'list_id');
end $$;
revoke all on function clinic_reception.entity_service_name(uuid, uuid, date) from public, anon, authenticated;

-- the booking form: every active service of the workspace under ONE contract (entity price list), with the entity's names / codes
create function public.clinic_reception_entity_services(p_workspace uuid, p_contract uuid, p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date); ok boolean; lid uuid; al jsonb := '{}'::jsonb; out jsonb;
begin
  perform clinic_reception.access(p_workspace, 'view');
  if p_contract is null then raise exception 'اختار الجهة الأول'; end if;
  if to_regclass('public.contracting_entity_contracts') is null or to_regclass('clinic_prices.lists') is null then return '[]'::jsonb; end if;
  execute 'select exists (select 1 from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id
             where c.id = $1 and c.status = ''active'' and e.category in (''insurance'', ''unions'', ''clubs'')
               and (c.start_date is null or c.start_date <= $2) and (c.end_date is null or c.end_date >= $2))' into ok using p_contract, d;
  if not coalesce(ok, false) then raise exception 'عقد الجهة مش متفعّل — الحسابات تفعّل العقد الأول'; end if;
  -- the same list payer_price picks
  select x.id into lid from clinic_prices.lists x
   where x.contract_id = p_contract and x.status = 'active' and d between x.valid_from and x.valid_to and to_jsonb(x)->>'deleted_at' is null
   order by x.version desc limit 1;
  if lid is null then raise exception 'مفيش قايمة أسعار متفعّلة للجهة دي في اليوم ده'; end if;
  if to_regclass('clinic_prices.aliases') is not null then
    execute 'select coalesce(jsonb_object_agg(service_id::text, a), ''{}''::jsonb) from (
               select a.service_id, jsonb_agg(distinct jsonb_build_object(''name'', nullif(btrim(coalesce(a.external_name, '''')), ''''),
                                                                  ''code'', nullif(btrim(coalesce(a.external_code, '''')), ''''))) a
                 from clinic_prices.aliases a where a.scope_key = $1 group by a.service_id) q' into al using 'list:' || lid::text;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('service_id', q.id, 'code', q.code, 'name', q.name, 'department', q.department,
           'entity_name', nullif(btrim(coalesce(q.it->>'external_name', '')), ''), 'entity_code', nullif(btrim(coalesce(q.it->>'external_code', '')), ''),
           'aliases', coalesce(al->(q.psid::text), '[]'::jsonb),
           'price', case when coalesce((q.pr->>'blocked')::boolean, true) then null else (q.pr->>'price')::numeric end,
           'blocked', coalesce((q.pr->>'blocked')::boolean, true)) order by q.name, q.code), '[]'::jsonb) into out
    from (-- payer_price needs a pricing mapping (unmapped services cannot be saved under a contract either) → blocked
          select s.id, s.code, s.name, s.department, ps.psid, case when ps.psid is not null then clinic_reception.payer_price(p_contract, s.id, d) end pr,
                 (select to_jsonb(i) from clinic_prices.items i where i.list_id = lid and i.service_id = ps.psid) it
            from clinic_reception.services s
           cross join lateral (select nullif(to_jsonb(s)->>'pricing_service_id', '')::uuid psid) ps
           where s.workspace_id = p_workspace and s.active) q;
  return out;
end $$;
revoke all on function public.clinic_reception_entity_services(uuid, uuid, date) from public, anon;
grant execute on function public.clinic_reception_entity_services(uuid, uuid, date) to authenticated;

-- the contract quote keeps the entity's name / code of the service (PART B prints them)
alter function clinic_reception.payer_quote(uuid, uuid) rename to payer_quote_before_entity_names;
revoke all on function clinic_reception.payer_quote_before_entity_names(uuid, uuid) from public, anon, authenticated;

create function clinic_reception.payer_quote(p_order uuid, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare out jsonb; o record; ctr uuid; nm jsonb;
begin
  out := clinic_reception.payer_quote_before_entity_names(p_order, p_me);
  if out is null then return null; end if;
  select ord.service_id, v.appointment_id into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id where ord.id = p_order;
  select a.payer_contract_id into ctr from clinic_reception.appointments a where a.id = o.appointment_id;
  nm := clinic_reception.entity_service_name(ctr, o.service_id, (now() at time zone 'Africa/Cairo')::date);
  update clinic_reception.order_quotes
     set snapshot = snapshot || jsonb_build_object('entity_service_name', nm->'name', 'entity_service_code', nm->'code')
   where order_id = p_order;
  return out;
end $$;
revoke all on function clinic_reception.payer_quote(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
-- <<< END MIGRATION BODY <<<

create temp table esn_live(n serial, step text, expected text, actual text, ok boolean);

do $$
declare
  sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; d date := (now() at time zone 'Africa/Cairo')::date;
  ctr uuid; ent text; lst uuid; path text := 'real contract + list with entity names'; prov uuid; svc uuid; psid uuid; pat uuid;
  rows jsonb; rw jsonb; pr jsonb; it record; exp_name text; exp_code text; r jsonb; wk uuid; o record; q record; opt jsonb; n int;
  proof text := 'rollback-esn/' || gen_random_uuid() || '.jpg';
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select id into me from public.admins where user_id = sub;
  if w is null or me is null then raise exception 'live workspace % / admin for sub % missing', w, sub; end if;
  insert into storage.objects(bucket_id, name, owner) values ('booking-discount-cards', proof, sub);
  perform clinic_reception.sync_catalog(w);

  -- a provider working now with a priced, non-home service of its department (the walk-in target)
  select av.provider_id, s.id, (to_jsonb(s)->>'pricing_service_id')::uuid into prov, svc, psid
    from clinic_reception.availability av join clinic_reception.providers pr2 on pr2.id = av.provider_id
    join clinic_reception.services s on s.workspace_id = w and s.department = pr2.department and s.active and to_jsonb(s)->>'pricing_service_id' is not null
     and coalesce((to_jsonb(s)->>'is_home')::boolean, false) = false
   where av.workspace_id = w and now() between av.starts_at and av.ends_at and pr2.active
   order by av.starts_at, s.price limit 1;
  select p.id into pat from clinic_reception.patients p where p.workspace_id = w and p.patient_id is not null
     and not exists (select 1 from clinic_reception.appointments x where x.patient_id = p.id and (x.starts_at at time zone 'Africa/Cairo')::date = d)
   order by p.created_at desc limit 1;

  -- a real active contract (insurance / unions / clubs) with an active list today; prefer one whose list has entity names,
  -- then one that already prices the walk-in service
  select c.id, e.name, l.id into ctr, ent, lst
    from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id
    join lateral (select x.id from clinic_prices.lists x where x.contract_id = c.id and x.status = 'active' and d between x.valid_from and x.valid_to
                    and to_jsonb(x)->>'deleted_at' is null order by x.version desc limit 1) l on true
   where c.status = 'active' and e.category in ('insurance', 'unions', 'clubs')
     and (c.start_date is null or c.start_date <= d) and (c.end_date is null or c.end_date >= d)
   order by exists (select 1 from clinic_prices.items i where i.list_id = l.id and btrim(coalesce(i.external_name, '')) <> '') desc,
            exists (select 1 from clinic_prices.items i where i.list_id = l.id and i.service_id = psid) desc, e.name
   limit 1;
  if ctr is null then
    path := 'no active contract → one insurance contract temp-activated + temp list (rolled back)';
    select c.id, e.name into ctr, ent from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id
     where e.category = 'insurance' order by e.name limit 1;
    if ctr is null then raise exception 'no insurance contract at all to test on'; end if;
    update public.contracting_entity_contracts set status = 'active', start_date = least(coalesce(start_date, d), d), end_date = null where id = ctr;
    insert into clinic_prices.lists(name, version, contract_id, mode, fallback, valid_from, valid_to, status, created_by, reviewed_by)
      values ('ROLLBACK esn ' || ent, 900 + (random() * 99)::int, ctr, 'fixed', 'block', d - 1, d + 60, 'active', me, me) returning id into lst;
  elsif not exists (select 1 from clinic_prices.items i where i.list_id = lst and btrim(coalesce(i.external_name, '')) <> '') then
    path := 'real contract, its list has NO entity names';
  end if;
  insert into esn_live(step, expected, actual, ok) values ('0 picked', 'a contract + list + walk-in target', path || ' — ' || ent ||
    ' · items with entity names: ' || (select count(*) from clinic_prices.items i where i.list_id = lst and btrim(coalesce(i.external_name, '')) <> ''),
    ctr is not null and lst is not null and prov is not null and svc is not null and pat is not null);
  if prov is null or svc is null or pat is null then raise exception 'no provider working now / service / patient (provider %, service %, patient %)', prov, svc, pat; end if;
  -- the walk-in service must be in the list: keep a real item; else a temp item with an entity name (rolled back)
  if not exists (select 1 from clinic_prices.items i where i.list_id = lst and i.service_id = psid) then
    insert into clinic_prices.items(list_id, service_id, fixed_price, external_name, external_code)
      select lst, psid, greatest(round(s.price * 0.8), 10), 'ROLLBACK EXT NAME', 'RB-EXT-1' from clinic_reception.services s where s.id = svc;
    insert into esn_live(step, expected, actual, ok) values ('0b walk-in service item', 'real item or temp item', 'temp item ROLLBACK EXT NAME / RB-EXT-1 (rolled back)', true);
  end if;
  select i.* into it from clinic_prices.items i where i.list_id = lst and i.service_id = psid;
  exp_name := nullif(btrim(coalesce(it.external_name, '')), ''); exp_code := nullif(btrim(coalesce(it.external_code, '')), '');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);

  -- (a) the RPC as Mazen
  begin
    execute 'set local role authenticated';
    rows := public.clinic_reception_entity_services(w, ctr, d);
    execute 'reset role';
    select count(*) into n from clinic_reception.services s where s.workspace_id = w and s.active;
    insert into esn_live(step, expected, actual, ok) values ('a RPC rows', n || ' (every active service)', jsonb_array_length(rows)::text, jsonb_array_length(rows) = n);
    select x into rw from jsonb_array_elements(rows) x where (x->>'service_id')::uuid = svc;
    pr := clinic_reception.payer_price(ctr, svc, d);
    insert into esn_live(step, expected, actual, ok) values ('a walk-in service row',
      coalesce(exp_name, '(نفس اسم سونو)') || ' / ' || coalesce(exp_code, '-') || ' / ' || coalesce(pr->>'price', 'blocked'),
      coalesce(rw->>'entity_name', '(نفس اسم سونو)') || ' / ' || coalesce(rw->>'entity_code', '-') || ' / ' || coalesce(rw->>'price', 'blocked'),
      (rw->>'entity_name') is not distinct from exp_name and (rw->>'entity_code') is not distinct from exp_code
        and (rw->>'price')::numeric is not distinct from (pr->>'price')::numeric and (rw->>'blocked')::boolean = false);
    insert into esn_live(step, expected, actual, ok) select 'a list summary', 'priced + blocked = all; entity names shown',
      count(*) filter (where not (x->>'blocked')::boolean) || ' priced, ' || count(*) filter (where (x->>'blocked')::boolean) || ' blocked, '
        || count(*) filter (where x->>'entity_name' is not null) || ' with entity name, ' || count(*) filter (where jsonb_array_length(x->'aliases') > 0) || ' with aliases',
      count(*) filter (where (x->>'blocked')::boolean and x->>'price' is not null) = 0
      from jsonb_array_elements(rows) x;
    -- every priced row = payer_price (sample of up to 40)
    select count(*) into n from (select x from jsonb_array_elements(rows) x where not (x->>'blocked')::boolean limit 40) z
     where (clinic_reception.payer_price(ctr, (z.x->>'service_id')::uuid, d)->>'price')::numeric is distinct from (z.x->>'price')::numeric;
    insert into esn_live(step, expected, actual, ok) values ('a price = payer_price (≤40 rows)', '0 mismatches', n::text, n = 0);
  exception when others then execute 'reset role'; insert into esn_live(step, expected, actual, ok) values ('a RPC', 'works', sqlerrm, false); end;

  -- (b) refusals
  begin
    execute 'set local role authenticated';
    perform public.clinic_reception_entity_services(w, null, d);
    execute 'reset role'; insert into esn_live(step, expected, actual, ok) values ('b no contract', 'refused', 'accepted', false);
  exception when others then execute 'reset role'; insert into esn_live(step, expected, actual, ok) values ('b no contract', 'اختار الجهة الأول', sqlerrm, sqlerrm like '%اختار الجهة%'); end;
  insert into esn_live(step, expected, actual, ok) values ('b grants', 'anon no / authenticated yes / helper private',
    has_function_privilege('anon', 'public.clinic_reception_entity_services(uuid,uuid,date)', 'execute') || ' / ' ||
    has_function_privilege('authenticated', 'public.clinic_reception_entity_services(uuid,uuid,date)', 'execute') || ' / ' ||
    has_function_privilege('authenticated', 'clinic_reception.entity_service_name(uuid,uuid,date)', 'execute'),
    not has_function_privilege('anon', 'public.clinic_reception_entity_services(uuid,uuid,date)', 'execute')
    and has_function_privilege('authenticated', 'public.clinic_reception_entity_services(uuid,uuid,date)', 'execute')
    and not has_function_privilege('authenticated', 'clinic_reception.entity_service_name(uuid,uuid,date)', 'execute'));

  -- (c) the form's contract list still works (payer_options) and shows the same price
  begin
    execute 'set local role authenticated'; opt := public.clinic_reception_payer_options(w, svc, d); execute 'reset role';
    select x into rw from jsonb_array_elements(opt->'contracts') x where (x->>'contract_id')::uuid = ctr;
    insert into esn_live(step, expected, actual, ok) values ('c payer_options', ent || ' at ' || coalesce(pr->>'price', '?'), coalesce(rw->>'entity_name', 'missing') || ' at ' || coalesce(rw->>'price', '-'),
      (rw->>'price')::numeric is not distinct from (pr->>'price')::numeric);
  exception when others then execute 'reset role'; insert into esn_live(step, expected, actual, ok) values ('c payer_options', 'works', sqlerrm, false); end;

  -- (d) save: walk-in (first free slot) with the contract → arrive → quote snapshot keys
  begin
    execute 'set local role authenticated';
    r := public.clinic_reception_command(w, 'walk_in', jsonb_build_object('patient_id', pat, 'provider_id', prov, 'service_id', svc, 'same_day_ok', true,
           'payer_kind', 'contract', 'payer_contract_id', ctr, 'payer_coupon_no', 'RB-ESN-1', 'payer_auth_ref', 'RB-ESN-AP1',
           'payer_coverage_percent', '80', 'payer_proof_path', proof), gen_random_uuid());
    wk := (r->>'id')::uuid;
    perform public.clinic_reception_command(w, 'arrive', jsonb_build_object('id', wk), gen_random_uuid());
    execute 'reset role';
    select ord.* into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id where v.appointment_id = wk order by ord.created_at limit 1;
    select * into q from clinic_reception.order_quotes where order_id = o.id;
    insert into esn_live(step, expected, actual, ok) values ('d walk-in contract → arrive → quote',
      'keys present: ' || coalesce(exp_name, 'null') || ' / ' || coalesce(exp_code, 'null') || ', order at ' || coalesce(pr->>'price', '?'),
      case when q.order_id is null then 'no quote' else
        (case when q.snapshot ? 'entity_service_name' and q.snapshot ? 'entity_service_code' then 'keys present: ' else 'KEYS MISSING: ' end)
        || coalesce(q.snapshot->>'entity_service_name', 'null') || ' / ' || coalesce(q.snapshot->>'entity_service_code', 'null') || ', order at ' || o.price end,
      q.snapshot ? 'entity_service_name' and q.snapshot ? 'entity_service_code'
        and (q.snapshot->>'entity_service_name') is not distinct from exp_name and (q.snapshot->>'entity_service_code') is not distinct from exp_code
        and o.price = (pr->>'price')::numeric and q.snapshot->>'entity_name' = ent);
  exception when others then execute 'reset role'; insert into esn_live(step, expected, actual, ok) values ('d walk-in contract → arrive → quote', 'works', sqlerrm, false); end;
end $$;

-- >>> ROLLBACK BODY: supabase/rollbacks/20261126090000_entity_service_names.rollback.sql (between its begin; / commit;) >>>
drop function clinic_reception.payer_quote(uuid, uuid);
alter function clinic_reception.payer_quote_before_entity_names(uuid, uuid) rename to payer_quote;
revoke all on function clinic_reception.payer_quote(uuid, uuid) from public, anon, authenticated;
drop function public.clinic_reception_entity_services(uuid, uuid, date);
drop function clinic_reception.entity_service_name(uuid, uuid, date);
notify pgrst, 'reload schema';
-- <<< END ROLLBACK BODY <<<
insert into esn_live(step, expected, actual, ok) select 'e rollback body', 'payer_quote restored, RPC + helper gone',
  coalesce(to_regprocedure('public.clinic_reception_entity_services(uuid,uuid,date)')::text, 'gone') || ' / ' ||
  coalesce(to_regprocedure('clinic_reception.payer_quote_before_entity_names(uuid,uuid)')::text, 'gone') || ' / payer_quote ' ||
  coalesce(to_regprocedure('clinic_reception.payer_quote(uuid,uuid)')::text, 'MISSING'),
  to_regprocedure('public.clinic_reception_entity_services(uuid,uuid,date)') is null and to_regprocedure('clinic_reception.entity_service_name(uuid,uuid,date)') is null
  and to_regprocedure('clinic_reception.payer_quote_before_entity_names(uuid,uuid)') is null and to_regprocedure('clinic_reception.payer_quote(uuid,uuid)') is not null
  and position('payer_quote_before' in pg_get_functiondef('clinic_reception.payer_quote(uuid,uuid)'::regprocedure)) = 0;

select step, expected, actual, ok from esn_live order by n;
rollback;
