-- LIVE dry-run for 20261128140000_hide_supply_cost (owner 2026-11-28). Everything is rolled back.
-- Applies the wrap inside one transaction, then calls «استهلاك أمس» (list, yesterday) on the live workspace as a real NURSING
-- member and as a real SUPER ADMIN, and reports whether any cost key is in each reply. Nothing is saved (only 'list').
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

create or replace function clinic_reception.strip_cost(j jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case jsonb_typeof(j)
    when 'object' then
      coalesce((select jsonb_object_agg(e.k, clinic_reception.strip_cost(e.v)) from jsonb_each(j) e(k, v)
                 where e.k not in ('cost', 'total_cost', 'bom_cost', 'unit_cost', 'avg_cost')), '{}'::jsonb)
      || case when j ? 'bom_cost' then jsonb_build_object('bom', coalesce((j->>'bom_cost')::numeric, 0) > 0) else '{}'::jsonb end
    when 'array' then
      coalesce((select jsonb_agg(clinic_reception.strip_cost(a.v) order by a.n) from jsonb_array_elements(j) with ordinality a(v, n)), '[]'::jsonb)
    else j end
$$;
revoke all on function clinic_reception.strip_cost(jsonb) from public, anon;

alter function public.clinic_reception_visit_usage(uuid, text, jsonb) rename to clinic_reception_visit_usage_full;
alter function public.clinic_reception_visit_usage_full(uuid, text, jsonb) set schema clinic_reception;
alter function clinic_reception.clinic_reception_visit_usage_full(uuid, text, jsonb) rename to visit_usage_full;
revoke all on function clinic_reception.visit_usage_full(uuid, text, jsonb) from public, anon, authenticated;

create function public.clinic_reception_visit_usage(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb; see boolean := clinic_reception.can_see_cost();
begin
  r := clinic_reception.visit_usage_full(p_workspace, p_action, p_payload);
  if not see then r := clinic_reception.strip_cost(r); end if;
  if jsonb_typeof(r) = 'object' then r := r || jsonb_build_object('can_see_cost', see); end if;
  return r;
end $$;
revoke all on function public.clinic_reception_visit_usage(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_visit_usage(uuid, text, jsonb) to authenticated;

create temp table _r(who text, uid uuid, can_see boolean, has_cost boolean, rows int, err text) on commit drop;
grant all on _r to authenticated;
do $t$
declare ws uuid; nurse uuid; boss uuid; j jsonb; k text;
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select a.user_id into nurse from public.admins a join clinic_reception.members m on m.admin_id = a.id and m.workspace_id = ws
   where a.active and a.role in ('nursing', 'head_nursing') and 'view' = any(m.capabilities) and a.user_id is not null limit 1;
  select a.user_id into boss from public.admins a where a.active and a.role = 'super_admin' and a.user_id is not null limit 1;
  foreach k in array array['nursing', 'super_admin'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case k when 'nursing' then nurse else boss end, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      j := public.clinic_reception_visit_usage(ws, 'list', jsonb_build_object('day', ((now() at time zone 'Africa/Cairo')::date - 1)::text));
      insert into _r values (k, case k when 'nursing' then nurse else boss end, (j->>'can_see_cost')::boolean,
        j::text ~ '"(cost|total_cost|bom_cost|unit_cost|avg_cost)"', jsonb_array_length(j->'rows'), null);
    exception when others then insert into _r values (k, case k when 'nursing' then nurse else boss end, null, null, null, sqlerrm);
    end;
    execute 'reset role';
  end loop;
end $t$;
select who, uid is not null as found_user, can_see, has_cost, rows, err,
       case when who = 'nursing' then coalesce(not has_cost and can_see = false, false) else coalesce(has_cost or rows = 0, false) and can_see end as ok
  from _r order by who;
rollback;
