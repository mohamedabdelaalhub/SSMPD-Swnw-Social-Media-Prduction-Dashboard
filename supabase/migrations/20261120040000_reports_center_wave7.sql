-- Reports center — wave 7 (owner request 2026-11-19, last wave): service margin, device utilization & contribution,
-- internal referrals, waiting time. Read-only, SECURITY DEFINER, gate first, live workspaces only, sandbox appointments
-- excluded, no patient names.
-- Margin = net revenue − insurer contractual cut − executing doctor fee − referral fee − supplies included in the service
-- (stock cost). Overheads (rent, salaries…) are NOT allocated per service; see the P&L for those.
begin;

insert into public.report_registry(code, title, area, sort, sensitive) values
  ('service_margin',     'هامش ربح كل خدمة',              'profitability', 180, true),
  ('device_roi',         'تشغيل وعائد كل جهاز',            'profitability', 185, true),
  ('referral_efficiency','كفاءة التحويل الداخلي',          'profitability', 190, true),
  ('waiting_time',       'وقت الانتظار',                   'operations',     75, false);

insert into public.report_access(report_code, role)
select r, x from (values
  ('service_margin','general_manager'), ('service_margin','financial_manager'),
  ('device_roi','general_manager'), ('device_roi','financial_manager'),
  ('referral_efficiency','general_manager'), ('referral_efficiency','financial_manager'),
  ('waiting_time','general_manager')) v(r, x);

-- Per completed order: revenue and its direct costs. Internal helper (not granted).
create function public.report_order_costs(p_from date, p_to date, p_branch uuid)
returns table(order_id uuid, workspace_id uuid, day date, service text, specialty text, provider_id uuid, doctor text, visit_id uuid,
              net numeric, contractual numeric, doctor_fee numeric, referral_fee numeric, supplies numeric)
language sql stable security definer set search_path = pg_catalog, public as $$
  select o.order_id, o.workspace_id, o.day, o.service_name, o.specialty, o.provider_id, o.provider_name, o.visit_id, o.net,
         coalesce((select c.contractual * o.net / nullif(i.amount, 0) from clinic_reception.invoices i join clinic_reception.claims c on c.invoice_id = i.id
                    where i.order_id = o.order_id), 0),
         coalesce((select sum(l.credit - l.debit) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
                    where j.workspace_id = o.workspace_id and j.source_id = o.order_id and j.source in ('doctor_fee', 'doctor_contractual', 'doctor_credit_note')), 0),
         coalesce((select sum(l.credit - l.debit) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
                    where j.workspace_id = o.workspace_id and j.source_id = o.order_id and j.source in ('referral_fee', 'referral_reversal', 'referral_restore')), 0),
         coalesce((select sum(-m.quantity_delta * m.unit_cost) from clinic_reception.movements rm join public.inventory_movements m on m.id = rm.inventory_movement_id
                    where rm.kind = 'included' and rm.source_id = o.order_id), 0)
    from public.report_orders(p_from, p_to, p_branch) o
$$;
revoke all on function public.report_order_costs(date, date, uuid) from public, anon, authenticated;

-- ── Margin per service ─────────────────────────────────────────────────────────────────────────────────
create function public.report_service_margin(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('service_margin');
  perform public.report_check_period(p_from, p_to);
  with o as (select * from public.report_order_costs(p_from, p_to, p_branch)),
  g as (
    select service, specialty, count(*) orders, round(sum(net), 2) revenue, round(sum(contractual), 2) contractual, round(sum(doctor_fee), 2) doctor_fees,
           round(sum(referral_fee), 2) referral_fees, round(sum(supplies), 2) supplies,
           round(sum(net - contractual - doctor_fee - referral_fee - supplies), 2) margin
      from o group by service, specialty)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object('margin_pct', case when revenue > 0 then round(100 * margin / revenue, 1) end,
              'margin_per_order', case when orders > 0 then round(margin / orders, 2) end) order by margin desc, service) from g), '[]'::jsonb),
    'totals', (select jsonb_build_object('orders', coalesce(sum(orders), 0), 'revenue', coalesce(sum(revenue), 0), 'contractual', coalesce(sum(contractual), 0),
              'doctor_fees', coalesce(sum(doctor_fees), 0), 'referral_fees', coalesce(sum(referral_fees), 0), 'supplies', coalesce(sum(supplies), 0),
              'margin', coalesce(sum(margin), 0), 'margin_pct', case when sum(revenue) > 0 then round(100 * sum(margin) / sum(revenue), 1) end,
              'negative_services', count(*) filter (where margin < 0)) from g))
    into v;
  return v;
end $$;

-- ── Device utilization and contribution ────────────────────────────────────────────────────────────────
create function public.report_device_roi(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb; days integer := p_to - p_from + 1;
begin
  perform public.report_require('device_roi');
  perform public.report_check_period(p_from, p_to);
  with oc as (select * from public.report_order_costs(p_from, p_to, p_branch)),
  u as (
    select d.id device_id, d.code, d.name, d.meter_kind, d.asset_key, count(du.id) uses, coalesce(sum(du.minutes), 0) minutes,
           coalesce(sum(du.meter_after - du.meter_before), 0) meter,
           coalesce(sum(oc.net), 0) revenue, coalesce(sum(oc.contractual + oc.doctor_fee + oc.referral_fee + oc.supplies), 0) direct_costs
      from clinic_reception.devices d
      join public.report_workspaces(p_branch) w on w.workspace_id = d.workspace_id
      left join clinic_reception.device_uses du on du.device_id = d.id
      left join oc on oc.order_id = du.order_id
     where du.id is null or oc.order_id is not null
     group by d.id, d.code, d.name, d.meter_kind, d.asset_key)
  select jsonb_build_object('days', days,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'device', name, 'meter_kind', meter_kind, 'uses', uses, 'hours', round(minutes / 60.0, 1),
              'meter', round(meter, 2), 'uses_per_day', round(uses::numeric / days, 2), 'revenue', round(revenue, 2), 'direct_costs', round(direct_costs, 2),
              'contribution', round(revenue - direct_costs, 2), 'asset_linked', asset_key is not null and btrim(asset_key) <> '') order by revenue - direct_costs desc, name) from u), '[]'::jsonb),
    'totals', (select jsonb_build_object('devices', count(*), 'uses', coalesce(sum(uses), 0), 'hours', round(coalesce(sum(minutes), 0) / 60.0, 1),
              'revenue', round(coalesce(sum(revenue), 0), 2), 'direct_costs', round(coalesce(sum(direct_costs), 0), 2), 'contribution', round(coalesce(sum(revenue - direct_costs), 0), 2),
              'idle_devices', count(*) filter (where uses = 0)) from u))
    into v;
  return v;
end $$;

-- ── Internal referrals: who refers, how many are executed, revenue and referral fees ───────────────────
create function public.report_referral_efficiency(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('referral_efficiency');
  perform public.report_check_period(p_from, p_to);
  with r as (
    select x.referring_doctor_key ref_key, o.id order_id, o.status, s.department specialty, v.patient_id,
           round(o.price * o.quantity * (1 - o.discount / 100), 2) net, (x.referring_doctor_key = pr.doctor_key or x.referring_doctor_key = x.performing_doctor_key) self_ref
      from clinic_reception.order_ext x
      join clinic_reception.orders o on o.id = x.order_id
      join public.report_workspaces(p_branch) w on w.workspace_id = o.workspace_id
      join clinic_reception.visits v on v.id = o.visit_id
      join clinic_reception.services s on s.id = o.service_id
      join clinic_reception.providers pr on pr.id = o.provider_id
     where nullif(btrim(x.referring_doctor_key), '') is not null and (o.created_at at time zone 'Africa/Cairo')::date between p_from and p_to),
  fees as (
    select j.source_id order_id, sum(l.credit - l.debit) fee from clinic_reception.journal j
      join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
     where j.source in ('referral_fee', 'referral_reversal', 'referral_restore') group by j.source_id),
  g as (
    select r.ref_key, coalesce((select max(name) from clinic_reception.providers p where p.doctor_key = r.ref_key), r.ref_key) doctor,
           count(*) referred, count(distinct patient_id) patients, count(*) filter (where status = 'completed') executed,
           count(*) filter (where status = 'cancelled') cancelled, count(*) filter (where self_ref) self_referrals,
           coalesce(sum(net) filter (where status = 'completed'), 0) revenue, coalesce(sum(f.fee), 0) referral_fees,
           string_agg(distinct specialty, '، ') specialties
      from r left join fees f on f.order_id = r.order_id group by r.ref_key)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) - 'ref_key' || jsonb_build_object('conversion', case when referred > 0 then round(100.0 * executed / referred, 1) end)
              order by revenue desc, doctor) from g), '[]'::jsonb),
    'open_issues', (select count(*) from clinic_reception.referral_issues ri join public.report_workspaces(p_branch) w on w.workspace_id = ri.workspace_id where ri.resolved_at is null),
    'totals', (select jsonb_build_object('referred', coalesce(sum(referred), 0), 'executed', coalesce(sum(executed), 0), 'cancelled', coalesce(sum(cancelled), 0),
              'revenue', coalesce(sum(revenue), 0), 'referral_fees', coalesce(sum(referral_fees), 0), 'self_referrals', coalesce(sum(self_referrals), 0)) from g))
    into v;
  return v;
end $$;

-- ── Waiting time: punctuality and arrival → first finished service, per doctor ─────────────────────────
create function public.report_waiting_time(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('waiting_time');
  perform public.report_check_period(p_from, p_to);
  with a as (
    select ap.id, pr.name doctor, pr.department specialty, ap.starts_at,
           coalesce(ap.arrived_at, vs.opened_at) arrived,
           (select min(o.completed_at) from clinic_reception.orders o where o.visit_id = vs.id and o.status = 'completed') done
      from clinic_reception.appointments ap
      join public.report_workspaces(p_branch) w on w.workspace_id = ap.workspace_id
      join clinic_reception.providers pr on pr.id = ap.provider_id
      join clinic_reception.visits vs on vs.appointment_id = ap.id
     where coalesce(ap.source, '') <> 'sandbox' and (ap.starts_at at time zone 'Africa/Cairo')::date between p_from and p_to),
  x as (select *, extract(epoch from arrived - starts_at) / 60 late_min,
               extract(epoch from done - greatest(arrived, starts_at)) / 60 wait_min from a where arrived is not null),
  g as (
    select doctor, specialty, count(*) visits, round(avg(wait_min) filter (where wait_min >= 0)::numeric, 1) avg_wait,
           round((percentile_cont(0.5) within group (order by wait_min) filter (where wait_min >= 0))::numeric, 1) median_wait,
           count(*) filter (where wait_min > 30) over_30, count(*) filter (where wait_min > 60) over_60,
           round(avg(late_min) filter (where late_min > 0)::numeric, 1) avg_patient_late, count(*) filter (where done is null) not_finished
      from x group by doctor, specialty)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) order by avg_wait desc nulls last, doctor) from g), '[]'::jsonb),
    'by_hour', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'avg_wait', w) order by h)
              from (select extract(hour from starts_at at time zone 'Africa/Cairo')::int h, round(avg(wait_min)::numeric, 1) w from x where wait_min >= 0 group by 1) z), '[]'::jsonb),
    'totals', (select jsonb_build_object('visits', count(*), 'avg_wait', round(avg(wait_min) filter (where wait_min >= 0)::numeric, 1),
              'over_30', count(*) filter (where wait_min > 30), 'over_60', count(*) filter (where wait_min > 60),
              'not_finished', count(*) filter (where done is null)) from x))
    into v;
  return v;
end $$;

revoke all on function public.report_service_margin(date, date, uuid), public.report_device_roi(date, date, uuid),
  public.report_referral_efficiency(date, date, uuid), public.report_waiting_time(date, date, uuid) from public, anon;
grant execute on function public.report_service_margin(date, date, uuid), public.report_device_roi(date, date, uuid),
  public.report_referral_efficiency(date, date, uuid), public.report_waiting_time(date, date, uuid) to authenticated;

commit;
