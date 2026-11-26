-- Live rollback dry-run for 20261126200000_platform_doctor_fee.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- Needs #899 (20261126180000) applied. Applies the migration inside the transaction: the one-time correction runs on the REAL live
-- orders and every corrected order is printed (visit_no, source, old fee → new fee, already-paid-out flag, amount owed back). Then a
-- REAL reception user (Mazen if present, never «Admin Test») executes ONE real open live كشف order three times, each in a throwaway
-- sub-transaction (appointment fields changed with triggers off for that update only): as vezeeta → fee = (net − 25%) × rate; as
-- «فيزيتا شامل» → same fee as walk-in (no platform cut); as walk-in → net × rate, unchanged. Notices print amounts only; errors print the
-- message and constraint name only.
begin;
do $$ declare d text; a constant text := $a$fee:=round(greatest(0,net-case when agreement.deduct_material_cost then included_cost else 0 end)*agreement.rate/100,2);$a$; begin
  if to_regclass('clinic_finance.platform_audits') is null then raise exception 'طبّق مراجعة المنصات (20261126180000) أولًا'; end if;
  if to_regprocedure('clinic_reception.service_operation(uuid,text,jsonb,uuid)') is null or to_regprocedure('clinic_reception.consult_kind(text)') is null
     or to_regprocedure('clinic_reception.post(uuid,text,uuid,text,text,text,numeric,jsonb)') is null then raise exception 'مكونات الاستقبال غير موجودة'; end if;
  if to_regclass('clinic_finance.platform_fee_fixes') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  d := pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'سطر أتعاب الطبيب في service_operation اتغيّر (md5 %)', md5(d); end if;
end $$;

create table clinic_finance.platform_fee_saved_defs(name text primary key, def text not null);
alter table clinic_finance.platform_fee_saved_defs enable row level security;
revoke all on clinic_finance.platform_fee_saved_defs from public, anon, authenticated;
insert into clinic_finance.platform_fee_saved_defs values
  ('service_operation', pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure));

create function clinic_reception.platform_cut(p_order uuid, p_net numeric) returns numeric
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select round(greatest(coalesce(p_net, 0), 0) * q.percent / 100, 2)
      from clinic_reception.orders o
      join clinic_reception.workspaces w on w.id = o.workspace_id and w.mode = 'live'
      join clinic_reception.visits v on v.id = o.visit_id
      join clinic_reception.appointments a on a.id = v.appointment_id and a.service_id = o.service_id
      join clinic_reception.services s on s.id = o.service_id
      join clinic_finance.month_end_parties q on q.key = a.source and q.key in ('vezeeta', 'clinidu', 'akshef', 'kafaret') and q.percent is not null
     where o.id = p_order and coalesce(a.discount_kind, '') <> 'vezeeta' and coalesce(clinic_reception.consult_kind(s.name), '') in ('K', 'S')), 0)
$$;
revoke all on function clinic_reception.platform_cut(uuid, numeric) from public, anon, authenticated;

do $$ begin
  execute replace(pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure),
    $a$fee:=round(greatest(0,net-case when agreement.deduct_material_cost then included_cost else 0 end)*agreement.rate/100,2);$a$,
    $b$fee:=round(greatest(0,net-clinic_reception.platform_cut(o.id,net)-case when agreement.deduct_material_cost then included_cost else 0 end)*agreement.rate/100,2);$b$);
end $$;

-- one-time correction of live platform visits completed since 2026-11-01
create table clinic_finance.platform_fee_fixes (
  order_id uuid primary key references clinic_reception.orders(id), workspace_id uuid not null, visit_no bigint, source text not null,
  net numeric(14,2) not null, platform_cut numeric(14,2) not null, rate numeric not null, old_fee numeric(14,2) not null, new_fee numeric(14,2) not null,
  paid_out boolean not null, receivable numeric(14,2) not null default 0, fixed_at timestamptz not null default now());
alter table clinic_finance.platform_fee_fixes enable row level security;
revoke all on clinic_finance.platform_fee_fixes from public, anon, authenticated;

do $$
declare r record; diff numeric; liability numeric; dims jsonb; paid boolean; recv numeric; n int := 0;
begin
  for r in
    select o.id, o.workspace_id, v.visit_no, a.source, o.doctor_fee old_fee, ag.rate, o.net_revenue,
           coalesce(o.net_revenue, round(o.price * o.quantity * (1 - o.discount / 100), 2)) net
      from clinic_reception.orders o
      join clinic_reception.workspaces w on w.id = o.workspace_id and w.mode = 'live'
      join clinic_reception.visits v on v.id = o.visit_id
      join clinic_reception.appointments a on a.id = v.appointment_id
      join clinic_reception.doctor_agreements ag on ag.id = o.agreement_id
     where o.status = 'completed' and o.doctor_fee > 0 and coalesce(o.completed_at, o.created_at) >= timestamptz '2026-11-01 00:00 Africa/Cairo'
       and clinic_reception.platform_cut(o.id, 1) > 0
     order by v.visit_no
  loop
    -- the fee the order should have had: (net − platform cut) × rate, never above the old fee (material deduction kept)
    diff := least(r.old_fee, round(clinic_reception.platform_cut(r.id, r.net) * r.rate / 100, 2));
    if diff <= 0 then continue; end if;
    select j.dimensions into dims from clinic_reception.journal j where j.workspace_id = r.workspace_id and j.source = 'doctor_fee' and j.source_id = r.id;
    if dims is null then raise exception 'قيد أتعاب الطبيب للزيارة % مش موجود — راجعه قبل التطبيق', r.visit_no; end if;
    liability := -clinic_reception.balance(r.workspace_id, '2120', 'provider_id', dims->>'provider_id');
    paid := exists (select 1 from clinic_finance.desk_payout_rx x where x.rx_invoice_id = nullif(dims->>'invoice_id', '')::uuid);
    perform clinic_reception.event_post(r.workspace_id, 'doctor_fee_platform', r.id, 'تصحيح أتعاب الطبيب — نسبة المنصة تتخصم الأول', '2120', '5111', diff, dims);
    recv := greatest(0, diff - greatest(liability, 0));
    if recv > 0 then
      perform clinic_reception.event_post(r.workspace_id, 'doctor_receivable_platform', r.id, 'مبلغ مستحق من الطبيب بعد تصحيح أتعاب سبق صرفها', '1194', '2120', recv, dims);
    end if;
    update clinic_reception.orders set doctor_fee = r.old_fee - diff where id = r.id;
    insert into clinic_finance.platform_fee_fixes(order_id, workspace_id, visit_no, source, net, platform_cut, rate, old_fee, new_fee, paid_out, receivable)
      values (r.id, r.workspace_id, r.visit_no, r.source, r.net, clinic_reception.platform_cut(r.id, r.net), r.rate, r.old_fee, r.old_fee - diff, paid, recv);
    raise notice 'fee fix: visit % (%): net %, platform cut %, doctor rate %, fee % -> %, already paid out: %', r.visit_no, r.source, r.net,
      clinic_reception.platform_cut(r.id, r.net), r.rate, r.old_fee, r.old_fee - diff, paid;
    n := n + 1;
  end loop;
  raise notice 'platform doctor-fee fixes: % order(s)', n;
end $$;

-- ===================== checks (everything below is rolled back) =====================
do $$
declare cn text; rec uuid; rec_name text; o record; ag record; net numeric; cut numeric; f_vez numeric; f_shamel numeric; f_walk numeric; want numeric;
  n int; x record; tok uuid;
begin
  -- 1) the patched execute path carries the platform cut
  if position('clinic_reception.platform_cut(o.id,net)' in pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure)) = 0
    then raise exception 'service_operation not patched'; end if;
  -- 2) the one-time correction list (visit_no, old → new fee, paid-out flag) — counts and amounts only
  select count(*) into n from clinic_finance.platform_fee_fixes;
  raise notice 'corrections: % order(s)', n;
  for x in select visit_no, source, old_fee, new_fee, paid_out, receivable from clinic_finance.platform_fee_fixes order by visit_no loop
    raise notice '  visit %: % fee % -> % (already paid out: %, owed back: %)', x.visit_no, x.source, x.old_fee, x.new_fee, x.paid_out, x.receivable;
  end loop;
  -- 3) a REAL reception user (Mazen if present, never «Admin Test») executes ONE real open live order whose booked service is a كشف /
  --    استشارة, three times in throwaway sub-transactions: as vezeeta, as «فيزيتا شامل», as walk-in
  select a.user_id, a.name into rec, rec_name from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test'
     and public.has_role_for(a.id, 'reception') order by (a.name like '%مازن%') desc, a.id limit 1;
  if rec is null then raise exception 'no real reception login'; end if;
  select o0.id, o0.workspace_id, o0.provider_id, v.appointment_id ap, round(o0.price * o0.quantity, 2) - round(o0.price * o0.quantity * o0.discount / 100, 2) net
    into o
    from clinic_reception.orders o0 join clinic_reception.workspaces w on w.id = o0.workspace_id and w.mode = 'live'
    join clinic_reception.visits v on v.id = o0.visit_id join clinic_reception.appointments ap on ap.id = v.appointment_id and ap.service_id = o0.service_id
    join clinic_reception.services s on s.id = o0.service_id join clinic_reception.providers p on p.id = o0.provider_id
   where o0.status = 'ordered' and o0.entitlement_id is null and coalesce(clinic_reception.consult_kind(s.name), '') in ('K', 'S')
     and nullif(btrim(coalesce(p.doctor_key, '')), '') is not null and jsonb_array_length(coalesce(o0.snapshot->'bom', '[]'::jsonb)) = 0
   order by o0.created_at desc limit 1;
  if o.id is null then raise exception 'no open live كشف order to execute'; end if;
  net := o.net; cut := round(net * 25 / 100, 2);
  raise notice 'executing as reception (%): one real open كشف order, net %', case when rec_name like '%مازن%' then 'Mazen' else 'another reception user' end, net;
  -- vezeeta
  begin
    set local session_replication_role = replica;
    begin update clinic_reception.appointments set source = 'vezeeta', discount_kind = null where id = o.ap;
    exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end;
    set local session_replication_role = origin;
    perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
    perform public.clinic_reception_command(o.workspace_id, 'execute', jsonb_build_object('id', o.id, 'provider_id', coalesce(o.provider_id::text, '')), gen_random_uuid());
    execute 'reset role';
    select doctor_fee into f_vez from clinic_reception.orders where id = o.id;
    select g.rate, g.deduct_material_cost into ag from clinic_reception.orders z join clinic_reception.doctor_agreements g on g.id = z.agreement_id where z.id = o.id;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; raise exception 'vezeeta execute: % [%]', sqlerrm, cn; end if; end;
  -- «فيزيتا شامل»
  begin
    set local session_replication_role = replica;
    begin update clinic_reception.appointments set source = 'vezeeta', discount_kind = 'vezeeta', discount_percent = 40, discount_card_no = 'DRY-RUN',
            discount_card_expiry = current_date + 30, discount_card_path = 'dry-run/none' where id = o.ap;
    exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end;
    set local session_replication_role = origin;
    perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
    perform public.clinic_reception_command(o.workspace_id, 'execute', jsonb_build_object('id', o.id, 'provider_id', coalesce(o.provider_id::text, '')), gen_random_uuid());
    execute 'reset role';
    select doctor_fee into f_shamel from clinic_reception.orders where id = o.id;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; raise exception '«شامل» execute: % [%]', sqlerrm, cn; end if; end;
  -- walk-in
  begin
    set local session_replication_role = replica;
    begin update clinic_reception.appointments set source = 'walk_in', discount_kind = null where id = o.ap;
    exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end;
    set local session_replication_role = origin;
    perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
    perform public.clinic_reception_command(o.workspace_id, 'execute', jsonb_build_object('id', o.id, 'provider_id', coalesce(o.provider_id::text, '')), gen_random_uuid());
    execute 'reset role';
    select doctor_fee into f_walk from clinic_reception.orders where id = o.id;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; raise exception 'walk-in execute: % [%]', sqlerrm, cn; end if; end;
  raise notice 'fees: vezeeta %, «شامل» % (patient −40%%), walk-in % (doctor rate %, deducts material: %)', f_vez, f_shamel, f_walk, ag.rate, ag.deduct_material_cost;
  if coalesce(ag.deduct_material_cost, false) = false then
    want := round(greatest(0, net - cut) * ag.rate / 100, 2);
    if f_vez <> want then raise exception 'vezeeta fee % ≠ (net % − 25%% %) × % = %', f_vez, net, cut, ag.rate, want; end if;
    if f_walk <> round(net * ag.rate / 100, 2) then raise exception 'walk-in fee changed: % ≠ %', f_walk, round(net * ag.rate / 100, 2); end if;
  elsif not (f_vez < f_walk) then raise exception 'vezeeta fee % not below walk-in fee %', f_vez, f_walk;
  end if;
  if f_shamel <> f_walk then raise exception '«فيزيتا شامل» fee % ≠ walk-in fee % — it must get no platform cut', f_shamel, f_walk; end if;
  raise notice 'platform doctor fee dry-run OK: vezeeta % = (net − 25%%) × rate, walk-in % unchanged, «شامل» % with no platform cut; % correction(s) listed above; nothing kept', f_vez, f_walk, f_shamel, n;
exception when others then
  get stacked diagnostics cn = constraint_name;
  raise exception '%', sqlerrm || coalesce(' [' || nullif(cn, '') || ']', '');
end $$;
rollback;
