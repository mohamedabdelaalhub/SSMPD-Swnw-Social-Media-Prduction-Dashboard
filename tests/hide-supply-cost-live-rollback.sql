-- LIVE dry-run for 20261128140000_hide_supply_cost (owner 2026-11-28). Everything is rolled back; read-only calls only.
-- Applies the wraps in one transaction, then as a real NURSING member / HEAD NURSING / SUPER ADMIN calls: «استهلاك أمس» list
-- (yesterday), the 3 stock reports (last 7 days) and reports whether any cost key is in each reply. Summary table last.
do $$ begin
  if to_regprocedure('public.clinic_reception_visit_usage(uuid,text,jsonb)') is null then raise exception 'clinic_reception_visit_usage مش موجودة'; end if;
  if to_regprocedure('clinic_reception.visit_usage_full(uuid,text,jsonb)') is not null then raise exception 'تم تطبيق 20261128140000 قبل كده'; end if;
end $$;
begin;
create or replace function clinic_reception.can_see_cost() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.has_role('accountant') or public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin')
$$;
revoke all on function clinic_reception.can_see_cost() from public, anon;
grant execute on function clinic_reception.can_see_cost() to authenticated;

create or replace function clinic_reception.strip_cost(j jsonb, k text[]) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case jsonb_typeof(j)
    when 'object' then
      coalesce((select jsonb_object_agg(e.key, clinic_reception.strip_cost(e.value, k)) from jsonb_each(j) e
                 where not (e.key = any(k))), '{}'::jsonb)
      || case when 'bom_cost' = any(k) and j ? 'bom_cost' then jsonb_build_object('bom', coalesce((j->>'bom_cost')::numeric, 0) > 0) else '{}'::jsonb end
    when 'array' then
      coalesce((select jsonb_agg(clinic_reception.strip_cost(a.v, k) order by a.n) from jsonb_array_elements(j) with ordinality a(v, n)), '[]'::jsonb)
    else j end
$$;
revoke all on function clinic_reception.strip_cost(jsonb, text[]) from public, anon;

-- 1) «استهلاك أمس»
alter function public.clinic_reception_visit_usage(uuid, text, jsonb) rename to clinic_reception_visit_usage_full;
alter function public.clinic_reception_visit_usage_full(uuid, text, jsonb) set schema clinic_reception;
alter function clinic_reception.clinic_reception_visit_usage_full(uuid, text, jsonb) rename to visit_usage_full;
revoke all on function clinic_reception.visit_usage_full(uuid, text, jsonb) from public, anon, authenticated;
create function public.clinic_reception_visit_usage(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb; see boolean := clinic_reception.can_see_cost();
begin
  r := clinic_reception.visit_usage_full(p_workspace, p_action, p_payload);
  if not see then r := clinic_reception.strip_cost(r, array['cost', 'total_cost', 'bom_cost', 'unit_cost', 'avg_cost']); end if;
  if jsonb_typeof(r) = 'object' then r := r || jsonb_build_object('can_see_cost', see); end if;
  return r;
end $$;
revoke all on function public.clinic_reception_visit_usage(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_visit_usage(uuid, text, jsonb) to authenticated;

-- 2) reports
do $r$ declare f text; begin
  foreach f in array array['report_supplies_consumption', 'report_medicines_consumption', 'report_nursing_variance'] loop
    continue when to_regprocedure('public.' || f || '(date,date,uuid)') is null;   -- (live has all three; partial test databases may not)
    execute format('alter function public.%I(date, date, uuid) set schema clinic_reception', f);
    execute format('alter function clinic_reception.%I(date, date, uuid) rename to %I', f, f || '_full');
    execute format('revoke all on function clinic_reception.%I(date, date, uuid) from public, anon, authenticated', f || '_full');
    execute format($w$create function public.%I(p_from date, p_to date, p_branch uuid default null) returns jsonb
      language plpgsql stable security definer set search_path = pg_catalog, public as $b$
      declare r jsonb := clinic_reception.%I(p_from, p_to, p_branch); see boolean := clinic_reception.can_see_cost();
      begin
        if not see then r := clinic_reception.strip_cost(r, array['cost', 'included_cost', 'loss_cost', 'sold_cost', 'margin', 'variance_value']); end if;
        return case when jsonb_typeof(r) = 'object' then r || jsonb_build_object('can_see_cost', see) else r end;
      end $b$ $w$, f, f || '_full');
    execute format('revoke all on function public.%I(date, date, uuid) from public, anon', f);
    execute format('grant execute on function public.%I(date, date, uuid) to authenticated', f);
  end loop;
end $r$;

-- 3) inventory workspace (non-manager staff only)
do $o$ begin
  if to_regprocedure('public.inventory_workspace_snapshot(uuid)') is null then return; end if;
  execute $x$alter function public.inventory_workspace_snapshot(uuid) set schema clinic_reception;
alter function clinic_reception.inventory_workspace_snapshot(uuid) rename to inventory_snapshot_full;
revoke all on function clinic_reception.inventory_snapshot_full(uuid) from public, anon, authenticated;
create function public.inventory_workspace_snapshot(p_location uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r jsonb := clinic_reception.inventory_snapshot_full(p_location); see boolean := clinic_reception.can_see_cost();
begin
  if jsonb_typeof(r) <> 'object' then return r; end if;
  if not see and not coalesce((r->>'can_manage')::boolean, false) then
    r := clinic_reception.strip_cost(r, array['unit_cost', 'profit_amount', 'requested_unit_cost', 'package_cost', 'current_average_cost',
                                             'highest_purchase_cost', 'reference_purchase_price', 'cost']);
  end if;
  return r || jsonb_build_object('can_see_cost', see or coalesce((r->>'can_manage')::boolean, false));
end $$;
revoke all on function public.inventory_workspace_snapshot(uuid) from public, anon;
grant execute on function public.inventory_workspace_snapshot(uuid) to authenticated;

$x$;
end $o$;

-- 4) nursing day (vitals kit cost was sent, never shown)
do $o$ begin
  if to_regprocedure('public.clinic_reception_nursing(uuid,text,jsonb)') is null then return; end if;
  execute $x$alter function public.clinic_reception_nursing(uuid, text, jsonb) rename to nursing_before_cost;
revoke all on function public.nursing_before_cost(uuid, text, jsonb) from public, anon, authenticated;
create function public.clinic_reception_nursing(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb := public.nursing_before_cost(p_workspace, p_action, p_payload);
begin
  if not clinic_reception.can_see_cost() then r := clinic_reception.strip_cost(r, array['cost', 'unit_cost', 'total_cost']); end if;
  return r;
end $$;
revoke all on function public.clinic_reception_nursing(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_nursing(uuid, text, jsonb) to authenticated;
$x$;
end $o$;

create temp table _r(who text, call text, user_name text, can_see boolean, has_cost boolean, err text) on commit drop;
grant all on _r to authenticated;
-- For each role, try the real users (named ones first, then every active one with that role, main or extra) until one is allowed;
-- a role with no allowed user reports the last refusal.
do $t$
declare ws uuid := 'dc6e99a1-0000-0000-0000-000000000000'; j jsonb; k text; f text; a record; done boolean; lasterr text; calls text[];
  d1 date := (now() at time zone 'Africa/Cairo')::date - 7; d2 date := (now() at time zone 'Africa/Cairo')::date - 1;
  ck text := '"(cost|total_cost|bom_cost|unit_cost|avg_cost|included_cost|loss_cost|sold_cost|margin|variance_value)"';
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' and id::text like 'dc6e99a1%' limit 1;
  if ws is null then select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1; end if;
  foreach k in array array['nursing', 'head_nursing', 'super_admin'] loop
    foreach f in array array['visit_usage', 'report_supplies_consumption', 'report_medicines_consumption', 'report_nursing_variance'] loop
      done := false; lasterr := null;
      for a in select ad.user_id, ad.name from public.admins ad
                where ad.active and ad.user_id is not null
                  and (ad.role = k or exists (select 1 from public.admin_extra_roles r where r.admin_id = ad.id and r.role = k))
                order by (ad.user_id in ('5a44711b-c34c-4ba5-8455-d3428baadb67', 'af35b972-f212-4441-ba7d-f5c7ec34adc4')) desc, ad.name loop
        perform set_config('request.jwt.claims', json_build_object('sub', a.user_id, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        begin
          if f = 'visit_usage' then j := public.clinic_reception_visit_usage(ws, 'list', jsonb_build_object('day', d2::text));
          else execute format('select public.%I($1, $2, null)', f) into j using d1, d2; end if;
          execute 'reset role';
          insert into _r values (k, f, a.name, (j->>'can_see_cost')::boolean, j::text ~ ck, null); done := true;
        exception when others then lasterr := left(sqlerrm, 120); execute 'reset role';
        end;
        exit when done;
      end loop;
      if not done then insert into _r values (k, f, null, null, null, coalesce(lasterr, 'no active user with this role')); end if;
    end loop;
  end loop;
end $t$;
select who, call, user_name, can_see, has_cost, err,
       case when err is not null then null when who = 'super_admin' then can_see else (can_see = false and not has_cost) end as ok
  from _r order by who, call;
rollback;
