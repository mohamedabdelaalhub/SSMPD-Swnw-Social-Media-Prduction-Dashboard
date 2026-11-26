-- Live rollback test for 20261126160000_unit_provider_no_doctor_fee.sql (URGENT: «التمريض» cannot execute 0000172).
-- Run the WHOLE file as postgres. ONE transaction, ends with ROLLBACK — nothing is kept.
-- Acts as Mazen (reception, auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb). Fixture (postgres, rolled back): an arrived visit of a
-- patient with two «ordered» 0000172 services on the unit provider «التمريض» (doctor_key NULL). Steps:
--   0) BEFORE the migration Mazen's «تنفيذ» is refused with the live message (reproduces the bug);
--   1) migration body; 2) Mazen «تنفيذ» order 1 (store «فرعي مستلزمات تمريض» if allowed, «بدون مستلزمات»: materials []) → completed,
--      doctor fee 0; 3) Mazen «تنفيذ» order 2 then «إنهاء الزيارة» (visit_close) → visit completed; 4) a doctor WITH a doctor_key
--      and no contract on that code is still refused (unchanged); 5) rollback body restores the old function.
-- If Mazen has no open cash shift, the unrelated shift guard is stubbed inside this transaction only.
-- Last output = one result table (step, expected, actual, ok).
do $$ begin
  if to_regprocedure('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)') is null then raise exception 'sync_doctor_contract missing'; end if;
  if to_regprocedure('clinic_reception.sync_doctor_contract_before_units(uuid,uuid,uuid)') is not null then
    raise exception '20261126160000 already applied — this dry-run is for before the apply'; end if;
end $$;

begin;
savepoint upf_guard;
create temp table upf_live(n serial, step text, expected text, actual text, ok boolean);

create temp table upf_fx(w uuid, me uuid, sub uuid, prov uuid, prov_name text, svc uuid, code text, dept text, pat uuid, ap uuid, vid uuid, o1 uuid, o2 uuid, loc uuid, doc uuid);
do $$
declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; prov uuid; pname text; svc uuid; v_code text; dept text; pat uuid;
  ap uuid; vid uuid; o1 uuid; o2 uuid; loc uuid; doc uuid; d date := (now() at time zone 'Africa/Cairo')::date; g jsonb;
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select id into me from public.admins where user_id = sub;
  if w is null or me is null then raise exception 'live workspace % / admin for sub % missing', w, sub; end if;
  perform clinic_reception.sync_catalog(w);
  select s.id, s.code, s.department into svc, v_code, dept from clinic_reception.services s
   where s.workspace_id = w and s.code = '0000172' and s.active order by s.version desc limit 1;
  if svc is null then raise exception 'service 0000172 not active on live'; end if;
  select p.id, p.name into prov, pname from clinic_reception.providers p
   where p.workspace_id = w and p.active and nullif(btrim(coalesce(p.doctor_key, '')), '') is null
   order by (p.name = 'التمريض') desc, p.name limit 1;
  if prov is null then raise exception 'no active unit provider (doctor_key null)'; end if;
  select p.id into pat from clinic_reception.patients p where p.workspace_id = w and p.patient_id is not null
     and not exists (select 1 from clinic_reception.appointments x where x.patient_id = p.id and (x.starts_at at time zone 'Africa/Cairo')::date = d)
   order by p.created_at desc limit 1;
  select l.id into loc from clinic_reception.locations l where l.workspace_id = w and clinic_reception.consume_location_ok(w, dept, l.id)
   order by (l.name like '%مستلزمات تمريض%') desc, l.name limit 1;
  -- a doctor (doctor_key set) with NO active contract on this code, for the «unchanged» check
  select p.id into doc from clinic_reception.providers p where p.workspace_id = w and p.active and nullif(btrim(coalesce(p.doctor_key, '')), '') is not null
     and not exists (select 1 from clinic_finance.doctor_contract_for_service(p.doctor_key, v_code, null, dept, d))
   order by p.name limit 1;
  insert into clinic_reception.appointments(workspace_id, patient_id, provider_id, service_id, starts_at, ends_at, status, created_by, arrived_at)
    values (w, pat, prov, svc, now(), now() + interval '15 minutes', 'arrived', me, now()) returning id into ap;
  insert into clinic_reception.visits(workspace_id, appointment_id, patient_id, opened_by) values (w, ap, pat, me) returning id into vid;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select w, vid, s.id, prov, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc returning id into o1;
  insert into clinic_reception.orders(workspace_id, visit_id, service_id, provider_id, quantity, price, snapshot, created_by)
    select w, vid, s.id, prov, 1, s.price, to_jsonb(s), me from clinic_reception.services s where s.id = svc returning id into o2;
  insert into upf_fx values (w, me, sub, prov, pname, svc, v_code, dept, pat, ap, vid, o1, o2, loc, doc);
  insert into upf_live(step, expected, actual, ok) values ('fixture', 'arrived visit + 2 ordered 0000172 on a unit provider',
    pname || ' · service ' || v_code || ' (' || dept || ') · store ' || coalesce((select name from clinic_reception.locations where id = loc), 'none allowed')
    || ' · doctor for unchanged check: ' || coalesce((select name from clinic_reception.providers where id = doc), 'none'), pat is not null and o2 is not null);
  -- unrelated cash-shift guard: stub inside this txn if Mazen has no open shift
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  if to_regprocedure('clinic_reception.shift_guard_check(uuid)') is not null then
    begin g := clinic_reception.shift_guard_state();
      if coalesce((g->>'locked')::boolean, false) then
        execute 'create or replace function clinic_reception.shift_guard_check(p_workspace uuid) returns void language plpgsql as $f$ begin return; end $f$';
        insert into upf_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'open shift, or stubbed in this txn', 'stubbed (Mazen had no open shift)', true);
      end if;
    exception when others then insert into upf_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'state readable', sqlerrm, true); end;
  end if;
end $$;

-- 0) BEFORE: the live refusal is reproduced
do $$ declare f upf_fx; err text;
begin select * into f from upf_fx;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f.sub::text, true);
  begin
    execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'execute', jsonb_strip_nulls(jsonb_build_object('id', f.o1, 'provider_id', f.prov, 'location_id', f.loc, 'materials', '[]'::jsonb)), gen_random_uuid());
    execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into upf_live(step, expected, actual, ok) values ('0 before fix: Mazen «تنفيذ»', 'refused «حدد عقدًا واحدًا معتمدًا للطبيب والخدمة»', err, err like '%حدد عقدًا واحدًا معتمدًا للطبيب والخدمة%');
end $$;

-- >>> MIGRATION BODY: supabase/migrations/20261126160000_unit_provider_no_doctor_fee.sql (between its begin; / commit;) >>>

alter function clinic_reception.sync_doctor_contract(uuid, uuid, uuid) rename to sync_doctor_contract_before_units;
revoke all on function clinic_reception.sync_doctor_contract_before_units(uuid, uuid, uuid) from public, anon, authenticated;

create function clinic_reception.sync_doctor_contract(p_workspace uuid, p_order uuid, p_provider uuid) returns void
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

-- <<< END MIGRATION BODY <<<

do $$ declare f upf_fx; err text; r record; nag int;
begin select * into f from upf_fx;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f.sub::text, true);
  -- 2) Mazen executes order 1, «بدون مستلزمات»
  begin
    execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'execute', jsonb_strip_nulls(jsonb_build_object('id', f.o1, 'provider_id', f.prov, 'location_id', f.loc, 'materials', '[]'::jsonb)), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select status, doctor_fee, net_revenue into r from clinic_reception.orders where id = f.o1;
  insert into upf_live(step, expected, actual, ok) values ('2 Mazen «تنفيذ» order 1 (' || f.prov_name || ')', 'ok · completed · doctor fee 0',
    err || ' · ' || r.status || ' · doctor fee ' || coalesce(r.doctor_fee::text, '?') || ' · net ' || coalesce(r.net_revenue::text, '?'), err = 'ok' and r.status = 'completed' and r.doctor_fee = 0);
  select count(*) into nag from clinic_reception.doctor_agreements where provider_id = f.prov and service_code = f.code and status = 'active';
  insert into upf_live(step, expected, actual, ok) values ('2b unit agreement', '1 active 0% «وحدة بدون طبيب»', nag || ' active, rate ' ||
    coalesce((select string_agg(rate::text, ',') from clinic_reception.doctor_agreements where provider_id = f.prov and service_code = f.code and status = 'active'), '-'), nag = 1);
  -- 3) order 2 + «إنهاء الزيارة»
  begin
    execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'execute', jsonb_strip_nulls(jsonb_build_object('id', f.o2, 'provider_id', f.prov, 'location_id', f.loc, 'materials', '[]'::jsonb)), gen_random_uuid());
    perform public.clinic_reception_command(f.w, 'visit_close', jsonb_build_object('id', f.vid, 'reason', 'rollback test'), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into upf_live(step, expected, actual, ok) select '3 Mazen «تنفيذ» order 2 + «إنهاء الزيارة»', 'ok · visit completed · both orders completed',
    err || ' · visit ' || v.status || ' · completed orders ' || (select count(*) from clinic_reception.orders o where o.visit_id = v.id and o.status = 'completed'),
    err = 'ok' and v.status = 'completed' from clinic_reception.visits v where v.id = f.vid;
  -- 4) a doctor with a doctor_key and no contract on this code: still refused by the contract check
  if f.doc is not null then
    begin perform clinic_reception.sync_doctor_contract(f.w, f.o1, f.doc); err := 'accepted';
    exception when others then err := sqlerrm; end;
    insert into upf_live(step, expected, actual, ok) values ('4 doctor without contract (unchanged)', 'refused «حدد عقدًا واحدًا…»', err, err like '%حدد عقدًا واحدًا معتمدًا للطبيب والخدمة%');
  end if;
end $$;

-- >>> ROLLBACK BODY: supabase/rollbacks/20261126160000_unit_provider_no_doctor_fee.rollback.sql >>>
drop function clinic_reception.sync_doctor_contract(uuid, uuid, uuid);
alter function clinic_reception.sync_doctor_contract_before_units(uuid, uuid, uuid) rename to sync_doctor_contract;
revoke all on function clinic_reception.sync_doctor_contract(uuid, uuid, uuid) from public, anon, authenticated;
update clinic_reception.doctor_agreements set status = 'rejected'
 where status = 'active' and reference = 'وحدة بدون طبيب — بدون أتعاب (20261126160000)'
   and not exists (select 1 from clinic_reception.orders o where o.agreement_id = doctor_agreements.id);
-- <<< END ROLLBACK BODY <<<
insert into upf_live(step, expected, actual, ok) select '5 rollback body', 'previous sync_doctor_contract restored',
  coalesce(to_regprocedure('clinic_reception.sync_doctor_contract_before_units(uuid,uuid,uuid)')::text, 'gone') || ' / ' ||
  coalesce(to_regprocedure('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)')::text, 'MISSING'),
  to_regprocedure('clinic_reception.sync_doctor_contract_before_units(uuid,uuid,uuid)') is null and to_regprocedure('clinic_reception.sync_doctor_contract(uuid,uuid,uuid)') is not null;

select step, expected, actual, ok from upf_live order by n;
rollback;
