-- Doctor fee on booking-platform visits: the platform's share comes off FIRST (owner 2026-11-26 ~22:03Z: «فيزيتا / اكشف / كلينيدو —
-- نشيل نسبة المنصة الأول وبعدين الباقي يتقسم بين الدكتور والمركز حسب العقد»). Reception reported (and main chat 6 verified on live)
-- that visit 196 (vezeeta, كشف الاستشاري 600, 50%) got a doctor fee of 300 instead of (600 − 150) × 50% = 225.
--   * clinic_reception.platform_cut(order, net): the platform's share of that order = round(net × percent / 100, 2) when — exactly the
--     scope of clinic_finance.month_end_lines (#899) — the order is the appointment's BOOKED service, that service is a كشف / استشارة
--     (consult_kind K / S; not متابعة), the appointment's source is a platform with a percent in clinic_finance.month_end_parties, the
--     appointment is not «فيزيتا شامل» (discount_kind 'vezeeta'), in a LIVE workspace. Otherwise 0.
--   * clinic_reception.referral_cut(order) (owner ~22:18Z: «نسبة الإحالة زي الخصم — تتخصم الأول»): the referral commission the
--     order will post (order_ext.priced.referral_commission when a referring doctor other than the performer is set and the visit is not
--     from a platform — exactly referral_try's rule). A patient comes from ONE source, so platform cut and referral never co-exist.
--   * clinic_reception.service_operation 'execute' (patched in place, anchor checked once; previous definition saved):
--       fee := (net − platform_cut − referral_cut − included material if the agreement deducts it) × agreement rate.
--     Revenue is unchanged: the invoice / 4110 stay at the patient's net (600), the platform's 25% is the 5233 expense posted when the
--     period audit is approved (#899), so the centre keeps net − platform − doctor (600 − 150 − 225 = 225). Nothing is counted twice.
--   * Applies to EVERY performer (doctor, nursing / unit provider, any agreement) — the one fee line serves them all; the patient
--     discount (خاص / staff / family / نقابة / «فيزيتا شامل») already comes off before the split (verified live: 195, 179).
--   * Correction of ALL past LIVE completed orders with a platform cut OR a posted referral commission (owner «صلح كل القديم بهذا
--     المنطق», one time, at apply; the referral taken is what was actually posted as referral_fee): the difference is reversed in the
--     reception journal with the original fee's dimensions — up to the performer's remaining 2120 balance: Dr 2120 / Cr 5111 (source
--     doctor_fee_platform, the order id); the part already paid out: Dr 1194 / Cr 5111 (source doctor_receivable_platform) — a debt the
--     existing post() wrapper nets off the performer's NEXT doctor_fee. The payout itself is never touched. The migration runs with no
--     JWT, so these lines are written by clinic_finance.platform_fix_post (journal + the clinic_finance mirror exactly like the live
--     clinic_reception posting, actor = a real super admin, never «Admin Test»), dropped at the end; no access check is disabled.
--   * Referrals (owner: a patient comes from ONE source): no referral commission is created for an order whose appointment source is a
--     platform with a percent — clinic_reception.referral_try returns 'platform' (ignored, nothing posted). orders.doctor_fee is set to the corrected fee; every row is kept in
--     clinic_finance.platform_fee_fixes (order, visit_no, old fee, new fee, paid-out flag) and printed as a notice.
-- Requires #899 (20261126180000). Rollback: supabase/rollbacks/20261126200000_platform_doctor_fee.rollback.sql
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

commit;
