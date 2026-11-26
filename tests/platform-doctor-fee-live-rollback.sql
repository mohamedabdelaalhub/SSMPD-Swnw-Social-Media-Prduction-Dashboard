-- Live rollback dry-run for 20261126200000_platform_doctor_fee.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- Needs #899 (20261126180000) applied. Applies the migration inside the transaction: the one-time correction runs on ALL past REAL
-- live platform orders and every corrected order is printed (visit_no, service, performer kind, source, old fee → new fee, already
-- paid out, owed back) with totals. Read-only check that the patient discount already comes off before the split (doctor + unit). Then a
-- REAL reception user (Mazen if present, never «Admin Test») executes ONE real open live كشف order three times, each in a throwaway
-- sub-transaction (appointment fields changed with triggers off for that update only): as vezeeta → fee = (net − 25%) × rate; as
-- «فيزيتا شامل» → same fee as walk-in (no platform cut); as walk-in → net × rate, unchanged; as a referred walk-in (another doctor,
-- commission 10% of net) → (net − referral) × rate. Notices print amounts only; errors print the
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

create function clinic_reception.referral_cut(p_order uuid) returns numeric
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; ref text; perf text; amt numeric;
begin
  if to_regclass('clinic_reception.order_ext') is null then return 0; end if;
  select * into o from clinic_reception.orders where id = p_order;
  if not found then return 0; end if;
  execute 'select nullif(trim(referring_doctor_key), ''''), nullif(trim(performing_doctor_key), ''''), round(coalesce((priced->>''referral_commission'')::numeric, 0), 2) from clinic_reception.order_ext where order_id = $1'
    into ref, perf, amt using p_order;
  if ref is null or coalesce(amt, 0) <= 0 then return 0; end if;
  if ref = perf or ref = (select doctor_key from clinic_reception.providers where id = o.provider_id) then return 0; end if;
  if exists (select 1 from clinic_reception.visits v join clinic_reception.appointments ap on ap.id = v.appointment_id
             join clinic_finance.month_end_parties q on q.key = ap.source and q.key in ('vezeeta', 'clinidu', 'akshef', 'kafaret') and q.percent is not null
             where v.id = o.visit_id) then return 0; end if;
  return amt;
end $$;
revoke all on function clinic_reception.referral_cut(uuid) from public, anon, authenticated;

do $$ begin
  execute replace(pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure),
    $a$fee:=round(greatest(0,net-case when agreement.deduct_material_cost then included_cost else 0 end)*agreement.rate/100,2);$a$,
    $b$fee:=round(greatest(0,net-clinic_reception.platform_cut(o.id,net)-clinic_reception.referral_cut(o.id)-case when agreement.deduct_material_cost then included_cost else 0 end)*agreement.rate/100,2);$b$);
end $$;

-- referral: none when a platform brought the patient
do $$ declare d text; a constant text := $a$    if ref = perf or ref = (select doctor_key from clinic_reception.providers where id = o.provider_id) then return 'self'; end if;$a$; begin
  if to_regprocedure('clinic_reception.referral_try(uuid)') is null then return; end if;
  d := pg_get_functiondef('clinic_reception.referral_try(uuid)'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط في referral_try اتغيّرت (md5 %)', md5(d); end if;
  insert into clinic_finance.platform_fee_saved_defs values ('referral_try', d);
  execute replace(d, a, a || $b$
    if exists (select 1 from clinic_reception.visits v join clinic_reception.appointments ap on ap.id = v.appointment_id
               join clinic_finance.month_end_parties q on q.key = ap.source and q.key in ('vezeeta', 'clinidu', 'akshef', 'kafaret') and q.percent is not null
               where v.id = o.visit_id) then return 'platform'; end if;  -- مريض جه من منصة: مفيش نسبة إحالة (المالك)$b$);
end $$;

-- writer for the one-time correction (no JWT in a migration): same journal + finance mirror as the live reception posting
create function clinic_finance.platform_fix_post(p_workspace uuid, p_source text, p_id uuid, p_description text, p_debit text, p_credit text,
  p_amount numeric, p_dims jsonb, p_actor uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v uuid; e uuid;
begin
  if p_amount <= 0 then return null; end if;
  insert into clinic_reception.journal(workspace_id, source, source_id, description, dimensions, actor_id)
    values (p_workspace, p_source, p_id, p_description, p_dims, p_actor) returning id into v;
  insert into clinic_reception.journal_lines values (v, p_debit, p_amount, 0), (v, p_credit, 0, p_amount);
  insert into clinic_finance.entries(source, source_id, description, shift_id, created_by) values ('reception_' || p_source, v, p_description, null, p_actor) returning id into e;
  insert into clinic_finance.lines(entry_id, account, debit, credit) values (e, clinic_reception.account(p_debit), p_amount, 0), (e, clinic_reception.account(p_credit), 0, p_amount);
  update clinic_reception.journal set finance_entry_id = e where id = v;
  return v;
end $$;
revoke all on function clinic_finance.platform_fix_post(uuid, text, uuid, text, text, text, numeric, jsonb, uuid) from public, anon, authenticated;

-- one-time correction of ALL past live platform orders (any performer)
create table clinic_finance.platform_fee_fixes (
  order_id uuid primary key references clinic_reception.orders(id), workspace_id uuid not null, visit_no bigint, source text not null, service text, performer text,
  net numeric(14,2) not null, platform_cut numeric(14,2) not null, referral numeric(14,2) not null default 0, rate numeric not null, old_fee numeric(14,2) not null, new_fee numeric(14,2) not null,
  paid_out boolean not null, receivable numeric(14,2) not null default 0, fixed_at timestamptz not null default now());
alter table clinic_finance.platform_fee_fixes enable row level security;
revoke all on clinic_finance.platform_fee_fixes from public, anon, authenticated;

do $$
declare actor uuid; r record; cut numeric; refc numeric; diff numeric; liability numeric; dims jsonb; paid boolean; recv numeric; n int := 0; t_old numeric := 0; t_new numeric := 0; t_recv numeric := 0; n_paid int := 0;
begin
  select a.id into actor from public.admins a where a.active and coalesce(a.name, '') <> 'Admin Test' and a.role = 'super_admin'
   order by (a.name like '%عبدالعال%') desc, a.id limit 1;
  if actor is null then raise exception 'مفيش سوبر أدمن حقيقي يتسجل باسمه التصحيح'; end if;
  perform clinic_finance.lock_day();
  for r in
    select o.id, o.workspace_id, v.visit_no, a.source, o.doctor_fee old_fee, ag.rate, o.net_revenue, s.name service,
           case when nullif(btrim(coalesce(p.doctor_key, '')), '') is null then 'unit' else 'doctor' end performer,
           coalesce(o.net_revenue, round(o.price * o.quantity * (1 - o.discount / 100), 2)) net
      from clinic_reception.orders o
      join clinic_reception.workspaces w on w.id = o.workspace_id and w.mode = 'live'
      join clinic_reception.visits v on v.id = o.visit_id
      join clinic_reception.appointments a on a.id = v.appointment_id
      join clinic_reception.doctor_agreements ag on ag.id = o.agreement_id
      join clinic_reception.services s on s.id = o.service_id
      left join clinic_reception.providers p on p.id = o.provider_id
     where o.status = 'completed' and o.doctor_fee > 0
       and (clinic_reception.platform_cut(o.id, 1) > 0
            or exists (select 1 from clinic_reception.journal rj where rj.workspace_id = o.workspace_id and rj.source = 'referral_fee' and rj.source_id = o.id))
     order by v.visit_no
  loop
    -- the fee the order should have had: (net − platform cut − posted referral) × rate, never above the old fee (material kept)
    cut := clinic_reception.platform_cut(r.id, r.net);
    select coalesce(sum(l.credit - l.debit), 0) into refc from clinic_reception.journal rj join clinic_reception.journal_lines l on l.entry_id = rj.id and l.account = '2120'
     where rj.workspace_id = r.workspace_id and rj.source in ('referral_fee', 'referral_reversal', 'referral_restore') and rj.source_id = r.id;
    refc := greatest(refc, 0);
    diff := least(r.old_fee, round((cut + refc) * r.rate / 100, 2));
    if diff <= 0 then continue; end if;
    select j.dimensions into dims from clinic_reception.journal j where j.workspace_id = r.workspace_id and j.source = 'doctor_fee' and j.source_id = r.id;
    if dims is null then raise exception 'قيد أتعاب الطبيب للزيارة % مش موجود — راجعه قبل التطبيق', r.visit_no; end if;
    liability := -clinic_reception.balance(r.workspace_id, '2120', 'provider_id', dims->>'provider_id');
    paid := exists (select 1 from clinic_finance.desk_payout_rx x where x.rx_invoice_id = nullif(dims->>'invoice_id', '')::uuid);
    recv := greatest(0, diff - greatest(liability, 0));
    perform clinic_finance.platform_fix_post(r.workspace_id, 'doctor_fee_platform', r.id, 'تصحيح أتعاب المنفّذ — نسبة المنصة أو الإحالة تتخصم الأول', '2120', '5111', diff - recv, dims, actor);
    perform clinic_finance.platform_fix_post(r.workspace_id, 'doctor_receivable_platform', r.id, 'مبلغ مستحق من الطبيب بعد تصحيح أتعاب سبق صرفها', '1194', '5111', recv, dims, actor);
    update clinic_reception.orders set doctor_fee = r.old_fee - diff where id = r.id;
    insert into clinic_finance.platform_fee_fixes(order_id, workspace_id, visit_no, source, service, performer, net, platform_cut, referral, rate, old_fee, new_fee, paid_out, receivable)
      values (r.id, r.workspace_id, r.visit_no, r.source, r.service, r.performer, r.net, cut, refc, r.rate, r.old_fee, r.old_fee - diff, paid, recv);
    raise notice 'fee fix: visit % — % (%, %): net %, platform cut %, referral %, rate %, fee % -> %, already paid out: %, owed back: %', r.visit_no, r.service, r.performer,
      r.source, r.net, cut, refc, r.rate, r.old_fee, r.old_fee - diff, paid, recv;
    t_old := t_old + r.old_fee; t_new := t_new + r.old_fee - diff; t_recv := t_recv + recv; if paid then n_paid := n_paid + 1; end if;
    n := n + 1;
  end loop;
  drop function clinic_finance.platform_fix_post(uuid, text, uuid, text, text, text, numeric, jsonb, uuid);
  raise notice 'platform fee fixes: % order(s), fees % -> % (returned %), % already paid out, owed back by performers %', n, t_old, t_new, t_old - t_new, n_paid, t_recv;
end $$;

-- ===================== checks (everything below is rolled back) =====================
do $$
declare cn text; rec uuid; rec_name text; od record; ag record; net numeric; cut numeric; f_vez numeric; f_shamel numeric; f_walk numeric; f_ref numeric; refx numeric; refkey text; want numeric;
  n int; x record; tok uuid;
begin
  -- 1) the patched execute path carries the platform cut
  if position('clinic_reception.platform_cut(o.id,net)' in pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure)) = 0
    then raise exception 'service_operation not patched'; end if;
  -- 2) the one-time correction list (visit_no, old → new fee, paid-out flag) — counts and amounts only
  select count(*) into n from clinic_finance.platform_fee_fixes;
  raise notice 'corrections: % order(s)', n;
  -- (the migration itself printed one line per corrected order: visit, service, performer, source, old -> new fee, paid out, owed back)
  -- 2b) the patient discount already comes off BEFORE the split, for doctors and for unit / nursing providers (read-only, live,
  --     completed orders with a discount, no platform cut, no package, agreement without material deduction)
  for x in
    select case when nullif(btrim(coalesce(p.doctor_key, '')), '') is null then 'unit' else 'doctor' end kind, count(*) n,
           count(*) filter (where o.doctor_fee <> round((round(o.price * o.quantity, 2) - round(o.price * o.quantity * o.discount / 100, 2)) * g.rate / 100, 2)) bad,
           string_agg(case when o.doctor_fee <> round((round(o.price * o.quantity, 2) - round(o.price * o.quantity * o.discount / 100, 2)) * g.rate / 100, 2)
                           then v.visit_no::text end, ', ') bad_visits
      from clinic_reception.orders o join clinic_reception.workspaces w on w.id = o.workspace_id and w.mode = 'live'
      join clinic_reception.visits v on v.id = o.visit_id join clinic_reception.doctor_agreements g on g.id = o.agreement_id and not g.deduct_material_cost
      left join clinic_reception.providers p on p.id = o.provider_id
     where o.status = 'completed' and o.discount > 0 and o.entitlement_id is null and clinic_reception.platform_cut(o.id, 1) = 0
     group by 1
  loop
    raise notice 'patient discount before split — %: % discounted order(s), % not matching (net after discount × rate)%', x.kind, x.n, x.bad,
      case when x.bad > 0 then ': visits ' || x.bad_visits else '' end;
    if x.bad > 0 then raise exception 'patient discount not taken off before the split for % order(s) (%) — see visits above', x.bad, x.kind; end if;
  end loop;
  -- 3) a REAL reception user (Mazen if present, never «Admin Test») executes ONE real open live order whose booked service is a كشف /
  --    استشارة, three times in throwaway sub-transactions: as vezeeta, as «فيزيتا شامل», as walk-in
  select a.user_id, a.name into rec, rec_name from public.admins a where a.active and a.user_id is not null and coalesce(a.name, '') <> 'Admin Test'
     and public.has_role_for(a.id, 'reception') order by (a.name like '%مازن%') desc, a.id limit 1;
  if rec is null then raise exception 'no real reception login'; end if;
  select o0.id, o0.workspace_id, o0.provider_id, v.appointment_id ap, round(o0.price * o0.quantity, 2) - round(o0.price * o0.quantity * o0.discount / 100, 2) net
    into od
    from clinic_reception.orders o0 join clinic_reception.workspaces w on w.id = o0.workspace_id and w.mode = 'live'
    join clinic_reception.visits v on v.id = o0.visit_id join clinic_reception.appointments ap on ap.id = v.appointment_id and ap.service_id = o0.service_id
    join clinic_reception.services s on s.id = o0.service_id join clinic_reception.providers p on p.id = o0.provider_id
   where o0.status = 'ordered' and o0.entitlement_id is null and coalesce(clinic_reception.consult_kind(s.name), '') in ('K', 'S')
     and nullif(btrim(coalesce(p.doctor_key, '')), '') is not null and jsonb_array_length(coalesce(o0.snapshot->'bom', '[]'::jsonb)) = 0
   order by o0.created_at desc limit 1;
  if od.id is null then raise exception 'no open live كشف order to execute'; end if;
  net := od.net; cut := round(net * 25 / 100, 2);
  raise notice 'executing as reception (%): one real open كشف order, net %', case when rec_name like '%مازن%' then 'Mazen' else 'another reception user' end, net;
  -- vezeeta
  begin
    set local session_replication_role = replica;
    begin update clinic_reception.appointments set source = 'vezeeta', discount_kind = null where id = od.ap;
    exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end;
    set local session_replication_role = origin;
    perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
    perform public.clinic_reception_command(od.workspace_id, 'execute', jsonb_build_object('id', od.id, 'provider_id', coalesce(od.provider_id::text, '')), gen_random_uuid());
    execute 'reset role';
    select doctor_fee into f_vez from clinic_reception.orders where id = od.id;
    select g.rate, g.deduct_material_cost into ag from clinic_reception.orders z join clinic_reception.doctor_agreements g on g.id = z.agreement_id where z.id = od.id;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; raise exception 'vezeeta execute: % [%]', sqlerrm, cn; end if; end;
  -- «فيزيتا شامل»
  begin
    set local session_replication_role = replica;
    begin update clinic_reception.appointments set source = 'vezeeta', discount_kind = 'vezeeta', discount_percent = 40, discount_card_no = 'DRY-RUN',
            discount_card_expiry = current_date + 30, discount_card_path = 'dry-run/none' where id = od.ap;
    exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end;
    set local session_replication_role = origin;
    perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
    perform public.clinic_reception_command(od.workspace_id, 'execute', jsonb_build_object('id', od.id, 'provider_id', coalesce(od.provider_id::text, '')), gen_random_uuid());
    execute 'reset role';
    select doctor_fee into f_shamel from clinic_reception.orders where id = od.id;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; raise exception '«شامل» execute: % [%]', sqlerrm, cn; end if; end;
  -- walk-in
  begin
    set local session_replication_role = replica;
    begin update clinic_reception.appointments set source = 'walk_in', discount_kind = null where id = od.ap;
    exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end;
    set local session_replication_role = origin;
    perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
    perform public.clinic_reception_command(od.workspace_id, 'execute', jsonb_build_object('id', od.id, 'provider_id', coalesce(od.provider_id::text, '')), gen_random_uuid());
    execute 'reset role';
    select doctor_fee into f_walk from clinic_reception.orders where id = od.id;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; raise exception 'walk-in execute: % [%]', sqlerrm, cn; end if; end;
  -- referral (owner: deducted first like a discount): walk-in with a referring doctor other than the performer, commission 10% of net
  select p2.doctor_key into refkey from clinic_reception.providers p2 where p2.workspace_id = od.workspace_id and nullif(btrim(coalesce(p2.doctor_key, '')), '') is not null
     and p2.doctor_key is distinct from (select doctor_key from clinic_reception.providers where id = od.provider_id) order by p2.id limit 1;
  refx := round(net * 10 / 100, 2);
  if refkey is null then raise notice 'skipped: referral scenario — no second doctor in the live workspace';
  else
    begin
      set local session_replication_role = replica;
      begin
        update clinic_reception.appointments set source = 'walk_in', discount_kind = null where id = od.ap;
        insert into clinic_reception.order_ext(order_id, kind, referring_doctor_key, priced) values (od.id, 'service', refkey, jsonb_build_object('referral_commission', refx))
          on conflict (order_id) do update set referring_doctor_key = excluded.referring_doctor_key, performing_doctor_key = null,
            priced = coalesce(clinic_reception.order_ext.priced, '{}'::jsonb) || excluded.priced;
      exception when others then get stacked diagnostics cn = constraint_name; raise exception 'fixture update failed (% %)', sqlstate, cn; end;
      set local session_replication_role = origin;
      perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
      perform public.clinic_reception_command(od.workspace_id, 'execute', jsonb_build_object('id', od.id, 'provider_id', coalesce(od.provider_id::text, '')), gen_random_uuid());
      execute 'reset role';
      select doctor_fee into f_ref from clinic_reception.orders where id = od.id;
      raise exception 'SCENARIO_DONE';
    exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; raise exception 'referral execute: % [%]', sqlerrm, cn; end if; end;
    if coalesce(ag.deduct_material_cost, false) = false and f_ref <> round(greatest(0, net - refx) * ag.rate / 100, 2) then
      raise exception 'referral fee % ≠ (net % − referral %) × % = %', f_ref, net, refx, ag.rate, round(greatest(0, net - refx) * ag.rate / 100, 2); end if;
    raise notice 'OK referral: net %, referral %, fee % = (net − referral) × rate', net, refx, f_ref;
  end if;
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
