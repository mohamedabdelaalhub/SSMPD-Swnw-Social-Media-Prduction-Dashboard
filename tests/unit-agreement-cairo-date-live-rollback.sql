-- Live rollback test for 20261126210000_unit_agreement_cairo_date.sql (unit 0% agreement starts on least(Cairo date, server date)).
-- Run the WHOLE file as postgres. ONE transaction, ends with ROLLBACK — nothing is kept. Acts as Mazen (reception, auth sub
-- f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb). Runs at ANY hour: it SIMULATES the 00:00–02:00 Cairo window inside the txn
-- (clinic_reception.today() = server date + 1, rolled back) and removes any active unit agreement of the chosen pair («التمريض» +
-- 0000172, else any service in its scope) inside the txn so the pair has NO agreement. Fixture: an arrived visit with 3 ordered
-- services on that unit (postgres, rolled back); the unrelated cash-shift guard is stubbed if Mazen has no open shift.
-- Output: one table (step, expected, actual, ok).
do $$ begin
  if to_regprocedure('clinic_reception.sync_doctor_contract_before_units(uuid,uuid,uuid)') is null then raise exception '20261126160000 is not applied'; end if;
  if position('least(v_today, current_date)' in pg_get_functiondef('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)'::regprocedure)) > 0 then
    raise exception '20261126210000 already applied — this dry-run is for before the apply'; end if;
end $$;

begin;
savepoint uac_guard;
create temp table uac_live(n serial, step text, expected text, actual text, ok boolean);
create temp table uac_fx(w uuid, me uuid, sub uuid, prov uuid, pname text, svc uuid, code text, vid uuid, o1 uuid, o2 uuid, o3 uuid, loc uuid, real_today text);
do $$
declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; prov uuid; pname text; svc uuid; v_code text; pat uuid;
  ap uuid; vid uuid; o1 uuid; o2 uuid; o3 uuid; loc uuid; v_dept text; d date := (now() at time zone 'Africa/Cairo')::date; g jsonb; rt text; nrm int;
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select id into me from public.admins where user_id = sub;
  if w is null or me is null then raise exception 'live workspace % / admin for sub % missing', w, sub; end if;
  perform clinic_reception.sync_catalog(w);
  select p.id, p.name into prov, pname from clinic_reception.providers p
   where p.workspace_id = w and p.active and nullif(btrim(coalesce(p.doctor_key, '')), '') is null order by (p.name = 'التمريض') desc, p.name limit 1;
  if prov is null then raise exception 'no active unit provider (doctor_key null)'; end if;
  select s.id, s.code, s.department into svc, v_code, v_dept from clinic_reception.services s
   where s.workspace_id = w and s.active and s.price > 0 and clinic_reception.provider_serves_code(prov, s.department, s.code, d)
   order by (s.code = '0000172') desc, s.price limit 1;
  if svc is null then raise exception 'no service in the unit provider scope'; end if;
  select p.id into pat from clinic_reception.patients p where p.workspace_id = w and p.patient_id is not null
     and not exists (select 1 from clinic_reception.appointments x where x.patient_id = p.id and (x.starts_at at time zone 'Africa/Cairo')::date = d)
   order by p.created_at desc limit 1;
  select l.id into loc from clinic_reception.locations l where l.workspace_id = w and clinic_reception.consume_location_ok(w, v_dept, l.id)
   order by (l.name like '%مستلزمات تمريض%') desc, l.name limit 1;
  -- the pair has NO active agreement inside this txn
  update clinic_reception.doctor_agreements set status = 'rejected' where workspace_id = w and provider_id = prov and service_code = v_code and status = 'active';
  get diagnostics nrm = row_count;
  insert into clinic_reception.appointments(workspace_id, patient_id, provider_id, service_id, starts_at, ends_at, status, created_by, arrived_at)
    values (w, pat, prov, svc, now(), now() + interval '15 minutes', 'arrived', me, now()) returning id into ap;
  insert into clinic_reception.visits(workspace_id, appointment_id, patient_id, opened_by) values (w, ap, pat, me) returning id into vid;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select w, vid, s.id, prov, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc returning id into o1;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select w, vid, s.id, prov, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc returning id into o2;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select w, vid, s.id, prov, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc returning id into o3;
  rt := pg_get_functiondef('clinic_reception.today()'::regprocedure);
  insert into uac_fx values (w, me, sub, prov, pname, svc, v_code, vid, o1, o2, o3, loc, rt);
  insert into uac_live(step, expected, actual, ok) values ('fixture', 'arrived visit + 3 ordered on a unit provider; pair without agreement',
    pname || ' · ' || v_code || ' · active agreements removed in txn: ' || nrm || ' · server date ' || current_date || ' · Cairo ' || d, o3 is not null);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  if to_regprocedure('clinic_reception.shift_guard_check(uuid)') is not null then
    begin g := clinic_reception.shift_guard_state();
      if coalesce((g->>'locked')::boolean, false) then
        execute 'create or replace function clinic_reception.shift_guard_check(p_workspace uuid) returns void language plpgsql as $f$ begin return; end $f$';
        insert into uac_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'open shift, or stubbed in this txn', 'stubbed (Mazen had no open shift)', true);
      end if;
    exception when others then insert into uac_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'state readable', sqlerrm, true); end;
  end if;
  -- simulate 00:00–02:00 Cairo: Cairo date = server date + 1 (rolled back)
  execute 'create or replace function clinic_reception.today() returns date language sql stable set search_path=pg_catalog as $f$select current_date + 1$f$';
end $$;

-- 1) BEFORE the fix, in the simulated window: Mazen's «تنفيذ» on the pair with no agreement is refused (repro)
do $$ declare f uac_fx; err text;
begin select * into f from uac_fx;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f.sub::text, true);
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'execute', jsonb_strip_nulls(jsonb_build_object('id', f.o1, 'provider_id', f.prov, 'location_id', f.loc, 'materials', '[]'::jsonb)), gen_random_uuid());
    execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into uac_live(step, expected, actual, ok) values ('1 before fix, Cairo-ahead window: Mazen «تنفيذ»', 'refused «يلزم عقد أتعاب معتمد…» (repro)', err, err like '%يلزم عقد أتعاب معتمد%');
end $$;

-- >>> MIGRATION BODY: supabase/migrations/20261126210000_unit_agreement_cairo_date.sql (between its begin; / commit;) >>>

create or replace function clinic_reception.sync_doctor_contract(p_workspace uuid, p_order uuid, p_provider uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; p clinic_reception.providers%rowtype; v_code text; v_today date := clinic_reception.today();
begin
  select * into o from clinic_reception.orders where workspace_id = p_workspace and id = p_order;
  if found then
    select * into p from clinic_reception.providers where workspace_id = p_workspace and id = coalesce(p_provider, o.provider_id);
    if found and nullif(btrim(coalesce(p.doctor_key, '')), '') is null then
      v_code := o.snapshot->>'code';
      if v_code is not null and not exists (
           select 1 from clinic_reception.doctor_agreements a where a.workspace_id = p_workspace and a.provider_id = p.id
              and a.service_code = v_code and a.status = 'active' and least(v_today, current_date) >= a.valid_from
              and greatest(v_today, current_date) <= a.valid_to) then
        insert into clinic_reception.doctor_agreements(workspace_id, provider_id, service_code, rate, deduct_material_cost, valid_from, valid_to,
            reference, status, created_by)
          values (p_workspace, p.id, v_code, 0, false, least(v_today, current_date), date '9999-12-31', 'وحدة بدون طبيب — بدون أتعاب (20261126160000)', 'active',
            coalesce(public.my_admin_id(), o.created_by));
      end if;
      return;
    end if;
  end if;
  perform clinic_reception.sync_doctor_contract_before_units(p_workspace, p_order, p_provider);
end $$;
revoke all on function clinic_reception.sync_doctor_contract(uuid, uuid, uuid) from public, anon, authenticated;

update clinic_reception.doctor_agreements set valid_from = least(valid_from, current_date, clinic_reception.today())
 where reference = 'وحدة بدون طبيب — بدون أتعاب (20261126160000)' and status = 'active' and valid_from > least(current_date, clinic_reception.today());

-- <<< END MIGRATION BODY <<<

do $$ declare f uac_fx; err text; r record;
begin select * into f from uac_fx;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f.sub::text, true);
  -- 2) after the fix, still in the simulated window
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'execute', jsonb_strip_nulls(jsonb_build_object('id', f.o2, 'provider_id', f.prov, 'location_id', f.loc, 'materials', '[]'::jsonb)), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select status, doctor_fee into r from clinic_reception.orders where id = f.o2;
  insert into uac_live(step, expected, actual, ok) values ('2 after fix, Cairo-ahead window: Mazen «تنفيذ»', 'ok · completed · fee 0 · agreement starts ≤ server date',
    err || ' · ' || r.status || ' · fee ' || r.doctor_fee || ' · agreement start ' ||
    coalesce((select min(valid_from)::text from clinic_reception.doctor_agreements where provider_id = f.prov and service_code = f.code and status = 'active'), '-'),
    err = 'ok' and r.status = 'completed' and r.doctor_fee = 0
    and (select min(valid_from) from clinic_reception.doctor_agreements where provider_id = f.prov and service_code = f.code and status = 'active') <= current_date);
  -- 3) real Cairo date again: a normal-hours execution still works
  execute f.real_today;
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'execute', jsonb_strip_nulls(jsonb_build_object('id', f.o3, 'provider_id', f.prov, 'location_id', f.loc, 'materials', '[]'::jsonb)), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select status, doctor_fee into r from clinic_reception.orders where id = f.o3;
  insert into uac_live(step, expected, actual, ok) values ('3 real Cairo date: Mazen «تنفيذ»', 'ok · completed · fee 0', err || ' · ' || r.status || ' · fee ' || r.doctor_fee,
    err = 'ok' and r.status = 'completed' and r.doctor_fee = 0);
end $$;

-- >>> ROLLBACK BODY: supabase/rollbacks/20261126210000_unit_agreement_cairo_date.rollback.sql >>>
create or replace function clinic_reception.sync_doctor_contract(p_workspace uuid, p_order uuid, p_provider uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; p clinic_reception.providers%rowtype; v_code text; v_today date := clinic_reception.today();
begin
  select * into o from clinic_reception.orders where workspace_id = p_workspace and id = p_order;
  if found then
    select * into p from clinic_reception.providers where workspace_id = p_workspace and id = coalesce(p_provider, o.provider_id);
    if found and nullif(btrim(coalesce(p.doctor_key, '')), '') is null then
      v_code := o.snapshot->>'code';
      if v_code is not null and not exists (
           select 1 from clinic_reception.doctor_agreements a where a.workspace_id = p_workspace and a.provider_id = p.id
              and a.service_code = v_code and a.status = 'active' and v_today between a.valid_from and a.valid_to) then
        insert into clinic_reception.doctor_agreements(workspace_id, provider_id, service_code, rate, deduct_material_cost, valid_from, valid_to,
            reference, status, created_by)
          values (p_workspace, p.id, v_code, 0, false, v_today, date '9999-12-31', 'وحدة بدون طبيب — بدون أتعاب (20261126160000)', 'active',
            coalesce(public.my_admin_id(), o.created_by));
      end if;
      return;
    end if;
  end if;
  perform clinic_reception.sync_doctor_contract_before_units(p_workspace, p_order, p_provider);
end $$;
revoke all on function clinic_reception.sync_doctor_contract(uuid, uuid, uuid) from public, anon, authenticated;
-- <<< END ROLLBACK BODY <<<
insert into uac_live(step, expected, actual, ok) select '4 rollback body', '20261126160000 wrapper body back',
  case when position('least(v_today, current_date)' in pg_get_functiondef('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)'::regprocedure)) = 0 then 'restored' else 'still patched' end,
  position('least(v_today, current_date)' in pg_get_functiondef('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)'::regprocedure)) = 0;

select step, expected, actual, ok from uac_live order by n;
rollback;
