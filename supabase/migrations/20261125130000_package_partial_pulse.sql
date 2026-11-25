-- «من الباكج» for laser PULSE packages (main chat 5, 2026-11-25; pricing chat builds 1000/3000/5000/10000-pulse Candela packages:
-- one entitlement line, service 0001228 × N pulses, used over several visits). Today order_use_package (20261123110000) uses an
-- entitlement only ONCE: it refuses when any non-cancelled order already points at it, and the session list hides it. That is
-- right for a normal session (quantity 1) but loses the rest of a pulse line after the first visit.
-- For PULSE entitlements only (service code in clinic_reception.laser_pulse_services — live: 0001227, 0001228):
--   * the session stays listed and usable while used < quantity and no OTHER open («ordered») order holds it;
--   * attaching an ordered pulse service sets its quantity to the remaining pulses and its unit price to the remaining value per
--     pulse (same as a package booking's arrival), so the laser execute (20261114173000) takes the meter difference, refuses more
--     than remains, and recognizes allocated × actual / quantity (the last draw takes the exact remainder);
--   * an already executed, unpaid pulse service is covered for its actual pulses (unchanged logic, now allowed on a used line);
--   * the list and the result carry pulses / remaining / quantity for the screen («فاضل 680 نبضة من 1000»).
-- Non-pulse entitlements behave exactly as before. Rollback: supabase/rollbacks/20261125130000_package_partial_pulse.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.order_use_package(uuid,jsonb,uuid)') is null then raise exception 'طبّق 20261123110000 الأول'; end if;
  if to_regclass('clinic_reception.laser_pulse_services') is null then raise exception 'طبّق 20261114173000 الأول'; end if;
  if to_regprocedure('clinic_reception.order_use_package_before_pulse(uuid,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.package_pulse_saved(name text primary key, def text not null);
revoke all on clinic_reception.package_pulse_saved from public, anon, authenticated;

create function clinic_reception.pulse_entitlement(p_entitlement uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_reception.entitlements e join clinic_reception.laser_pulse_services l on l.service_code = e.snapshot->>'code'
                  where e.id = p_entitlement)
$$;
revoke all on function clinic_reception.pulse_entitlement(uuid) from public, anon, authenticated;

-- «already used» = any non-cancelled order … except, for a pulse line, an order that is no longer open
do $$
declare d text; n int; f text;
  pat constant text := 'x\.entitlement_id = (e[0-9]?)\.id and x\.status <> ''cancelled''\)';
  rep constant text := 'x.entitlement_id = \1.id and x.status <> ''cancelled'' and (x.status = ''ordered'' or not clinic_reception.pulse_entitlement(\1.id)))';
begin
  foreach f in array array['clinic_reception.order_use_package(uuid,jsonb,uuid)', 'public.clinic_reception_legacy_packages(uuid,uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    insert into clinic_reception.package_pulse_saved values (f, d);
    n := (select count(*) from regexp_matches(d, pat, 'g'));
    if n = 0 then raise exception '% changed: «used» anchor not found', f; end if;
    d := regexp_replace(d, pat, rep, 'g');
    if f like 'public.clinic_reception_legacy_packages%' then
      if position('''legacy_paid_on'', k.legacy_paid_on,' in d) = 0 then raise exception 'sessions anchor not found'; end if;
      d := replace(d, '''legacy_paid_on'', k.legacy_paid_on,',
        '''legacy_paid_on'', k.legacy_paid_on, ''pulses'', clinic_reception.pulse_entitlement(e.id), ''remaining'', e.quantity - e.used, ''quantity'', e.quantity,');
    end if;
    execute d;
    raise notice '% patched (% anchors)', f, n;
  end loop;
end $$;
-- the patched entitlement check (en.id) inside order_use_package
do $$ declare d text := pg_get_functiondef('clinic_reception.order_use_package(uuid,jsonb,uuid)'::regprocedure);
  a constant text := 'x.entitlement_id = en.id and x.status <> ''cancelled'')';
begin
  if position(a in d) = 0 then raise exception 'order_use_package changed: entitlement check not found'; end if;
  execute replace(d, a, 'x.entitlement_id = en.id and x.status <> ''cancelled'' and (x.status = ''ordered'' or not clinic_reception.pulse_entitlement(en.id)))');
end $$;

alter function clinic_reception.order_use_package(uuid, jsonb, uuid) rename to order_use_package_before_pulse;
revoke all on function clinic_reception.order_use_package_before_pulse(uuid, jsonb, uuid) from public, anon, authenticated;

create function clinic_reception.order_use_package(p_workspace uuid, p jsonb, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare en clinic_reception.entitlements%rowtype; o clinic_reception.orders%rowtype; out jsonb; pulse boolean;
begin
  select * into en from clinic_reception.entitlements where id = nullif(p->>'entitlement_id', '')::uuid for update;
  pulse := en.id is not null and clinic_reception.pulse_entitlement(en.id);
  if pulse then
    if en.used >= en.quantity then raise exception 'نبضات الباكج دي خلصت — اختار باكج تاني'; end if;
    select * into o from clinic_reception.orders where id = nullif(p->>'order_id', '')::uuid and workspace_id = p_workspace for update;
    -- an open pulse service takes the remaining pulses; the laser execute then records the meter difference
    if o.id is not null and o.status = 'ordered' and o.entitlement_id is null and o.service_id = en.service_id then
      update clinic_reception.orders set quantity = en.quantity - en.used where id = o.id;
    end if;
  end if;
  out := clinic_reception.order_use_package_before_pulse(p_workspace, p, p_me);
  if pulse then
    if not coalesce((out->>'executed')::boolean, false) then
      update clinic_reception.orders set price = (en.allocated_value - en.recognized) / (en.quantity - en.used) where id = (out->>'order_id')::uuid;
    end if;
    out := out || jsonb_build_object('pulses', true, 'quantity', en.quantity,
      'remaining', (select e.quantity - e.used from clinic_reception.entitlements e where e.id = en.id));
  end if;
  return out;
end $$;
revoke all on function clinic_reception.order_use_package(uuid, jsonb, uuid) from public, anon, authenticated;

commit;
