-- Reports center — wave 2 (owner request 2026-11-19). Builds on wave 1 (report_registry / report_allowed / report_workspaces).
-- Six read-only reports: cashier variance, patient balances (credit 2150 / receivable 1122), adjustments log,
-- deferred revenue (remaining package sessions), no-show & cancellations per doctor, doctor slot occupancy.
-- Same rules as wave 1: SECURITY DEFINER, pinned search_path, gate first, live workspaces only, patients by file number only.
begin;

insert into public.report_registry(code, title, area, sort, sensitive) values
  ('cashier_variance',  'فروقات الخزنة لكل كاشير',        'cash',       25, false),
  ('patient_balances',  'أرصدة المرضى (مقدمات ومديونيات)', 'cash',       45, false),
  ('adjustments_log',   'التعديلات والإلغاءات والخصومات',  'cash',       35, false),
  ('deferred_revenue',  'الجلسات المتبقية (إيراد مؤجل)',    'cash',       48, false),
  ('no_show_by_doctor', 'الغياب والإلغاء لكل دكتور',        'operations', 60, false),
  ('slot_occupancy',    'إشغال مواعيد الدكاترة',            'operations', 70, false);

insert into public.report_access(report_code, role)
select r, x from (values
  ('cashier_variance','general_manager'), ('cashier_variance','financial_manager'), ('cashier_variance','accountant'),
  ('patient_balances','general_manager'), ('patient_balances','financial_manager'), ('patient_balances','accountant'),
  ('adjustments_log','general_manager'), ('adjustments_log','financial_manager'), ('adjustments_log','accountant'),
  ('deferred_revenue','general_manager'), ('deferred_revenue','financial_manager'), ('deferred_revenue','accountant'),
  ('no_show_by_doctor','general_manager'),
  ('slot_occupancy','general_manager')) v(r, x);

create function public.report_check_period(p_from date, p_to date) returns void
language plpgsql immutable set search_path = pg_catalog as $$
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then raise exception 'راجع الفترة'; end if;
end $$;
revoke all on function public.report_check_period(date, date) from public, anon, authenticated;

-- ── Cashier variance ───────────────────────────────────────────────────────────────────────────────────
create function public.report_cashier_variance(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('cashier_variance');
  perform public.report_check_period(p_from, p_to);
  with s as (
    select sh.cashier_id, a.full_name cashier, sh.expected, sh.counted, sh.difference, sh.status
      from clinic_reception.shifts sh
      join public.report_workspaces(p_branch) ws on ws.workspace_id = sh.workspace_id
      left join public.admins a on a.id = sh.cashier_id
     where (sh.opened_at at time zone 'Africa/Cairo')::date between p_from and p_to),
  g as (
    select cashier_id, cashier, count(*) shifts, count(*) filter (where status = 'open') open_shifts,
           coalesce(sum(expected), 0) expected, coalesce(sum(counted), 0) counted,
           coalesce(sum(difference) filter (where difference < 0), 0) short_total,
           coalesce(sum(difference) filter (where difference > 0), 0) over_total,
           coalesce(sum(difference), 0) net_difference,
           count(*) filter (where difference < 0) short_count, count(*) filter (where difference > 0) over_count,
           coalesce(min(difference), 0) worst_short
      from s group by cashier_id, cashier)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) - 'cashier_id' order by net_difference, cashier) from g), '[]'::jsonb),
    'totals', (select jsonb_build_object('shifts', coalesce(sum(shifts), 0), 'expected', coalesce(sum(expected), 0), 'counted', coalesce(sum(counted), 0),
              'short_total', coalesce(sum(short_total), 0), 'over_total', coalesce(sum(over_total), 0), 'net_difference', coalesce(sum(net_difference), 0),
              'short_count', coalesce(sum(short_count), 0)) from g))
    into v;
  return v;
end $$;

-- ── Patient balances: money held for patients (2150) and owed by patients (1122), as of a date ─────────
create function public.report_patient_balances(p_as_of date default null, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_as_of, (now() at time zone 'Africa/Cairo')::date); v jsonb;
begin
  perform public.report_require('patient_balances');
  with mv as (
    select ws.branch_name, nullif(j.dimensions->>'patient_id', '')::uuid patient_id, l.account, l.debit, l.credit, j.created_at
      from clinic_reception.journal j
      join clinic_reception.journal_lines l on l.entry_id = j.id and l.account in ('2150', '1122')
      join public.report_workspaces(p_branch) ws on ws.workspace_id = j.workspace_id
     where (j.created_at at time zone 'Africa/Cairo')::date <= d and j.dimensions ? 'patient_id'),
  g as (
    select mv.patient_id, max(mv.branch_name) branch, pt.file_no patient_file,
           round(coalesce(sum(credit - debit) filter (where account = '2150'), 0), 2) credit_held,
           round(coalesce(sum(debit - credit) filter (where account = '1122'), 0), 2) receivable,
           (max(created_at) at time zone 'Africa/Cairo')::date last_movement
      from mv left join clinic_reception.patients pt on pt.id = mv.patient_id
     group by mv.patient_id, pt.file_no),
  f as (select * from g where credit_held <> 0 or receivable <> 0)
  select jsonb_build_object(
    'as_of', d,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('branch', branch, 'patient_file', patient_file, 'credit_held', credit_held,
              'receivable', receivable, 'last_movement', last_movement, 'age_days', d - last_movement)
              order by greatest(credit_held, receivable) desc) from f), '[]'::jsonb),
    'totals', (select jsonb_build_object('patients', count(*), 'credit_held', coalesce(sum(credit_held), 0), 'receivable', coalesce(sum(receivable), 0)) from f))
    into v;
  return v;
end $$;

-- ── Adjustments log: discounts, refunds, credit notes, voids, package cancels, method fixes ────────────
create function public.report_adjustments_log(p_from date, p_to date, p_branch uuid default null, p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('adjustments_log');
  perform public.report_check_period(p_from, p_to);
  with x as (
    select ws.branch_name branch, (r.created_at at time zone 'Africa/Cairo')::date as day, r.kind, r.amount, r.reason, r.status,
           c.full_name requested_by, rv.full_name reviewed_by, 'reception' source
      from clinic_reception.requests r
      join public.report_workspaces(p_branch) ws on ws.workspace_id = r.workspace_id
      left join public.admins c on c.id = r.created_by
      left join public.admins rv on rv.id = r.reviewed_by
     where r.kind in ('refund', 'credit_note', 'service_void', 'package_cancel', 'method_fix', 'claim_contractual', 'claim_loss')
       and (r.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
    union all
    select ws.branch_name, (o.created_at at time zone 'Africa/Cairo')::date, 'discount',
           round(o.price * o.quantity * d.percent / 100, 2), d.reason, d.status, c.full_name, rv.full_name, 'reception'
      from clinic_reception.discount_requests d
      join clinic_reception.orders o on o.id = d.order_id
      join public.report_workspaces(p_branch) ws on ws.workspace_id = d.workspace_id
      left join public.admins c on c.id = d.created_by
      left join public.admins rv on rv.id = d.reviewed_by
     where (o.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
    union all
    select null, (r.created_at at time zone 'Africa/Cairo')::date, 'finance_' || r.kind, r.amount, r.reason, r.status,
           c.full_name, rv.full_name, 'finance'
      from clinic_finance.requests r
      left join public.admins c on c.id = r.created_by
      left join public.admins rv on rv.id = r.reviewed_by
     where p_branch is null and r.kind in ('refund', 'void')
       and (r.created_at at time zone 'Africa/Cairo')::date between p_from and p_to),
  f as (select * from x where p_kind is null or kind = p_kind)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by day desc, kind) from f), '[]'::jsonb),
    'by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'count', n, 'amount', a, 'approved', ap) order by a desc)
                           from (select kind, count(*) n, sum(amount) a, coalesce(sum(amount) filter (where status = 'approved'), 0) ap from f group by kind) k), '[]'::jsonb),
    'totals', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0),
              'approved', coalesce(sum(amount) filter (where status = 'approved'), 0),
              'pending', count(*) filter (where status = 'pending')) from f))
    into v;
  return v;
end $$;

-- ── Deferred revenue: what is still owed to patients in package sessions ───────────────────────────────
create function public.report_deferred_revenue(p_as_of date default null, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_as_of, (now() at time zone 'Africa/Cairo')::date); v jsonb;
begin
  perform public.report_require('deferred_revenue');
  with p as (
    select ws.branch_name branch, pt.file_no patient_file, k.name package, (k.purchased_at at time zone 'Africa/Cairo')::date purchased,
           k.expires_on, k.status, k.contract_price, k.funded, k.recognized,
           coalesce(sum(e.quantity), 0) sessions_total, coalesce(sum(e.used), 0) sessions_used,
           round(coalesce(sum(e.allocated_value - e.recognized), 0), 2) remaining_value
      from clinic_reception.packages k
      join public.report_workspaces(p_branch) ws on ws.workspace_id = k.workspace_id
      join clinic_reception.patients pt on pt.id = k.patient_id
      left join clinic_reception.entitlements e on e.package_id = k.id
     where k.status in ('active', 'frozen') and (k.purchased_at at time zone 'Africa/Cairo')::date <= d
     group by ws.branch_name, pt.file_no, k.id)
  select jsonb_build_object(
    'as_of', d,
    'rows', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('sessions_left', sessions_total - sessions_used,
              'days_to_expiry', expires_on - d) order by expires_on, patient_file) from p), '[]'::jsonb),
    'totals', (select jsonb_build_object('packages', count(*), 'contract', coalesce(sum(contract_price), 0), 'funded', coalesce(sum(funded), 0),
              'recognized', coalesce(sum(recognized), 0), 'remaining_value', coalesce(sum(remaining_value), 0),
              'sessions_left', coalesce(sum(sessions_total - sessions_used), 0),
              'expiring_30', count(*) filter (where expires_on - d between 0 and 30)) from p))
    into v;
  return v;
end $$;

-- ── No-show & cancellations per doctor ─────────────────────────────────────────────────────────────────
create function public.report_no_show_by_doctor(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('no_show_by_doctor');
  perform public.report_check_period(p_from, p_to);
  with a as (
    select ap.provider_id, pr.name doctor, pr.department specialty, ap.status, nullif(btrim(ap.cancel_reason), '') reason
      from clinic_reception.appointments ap
      join public.report_workspaces(p_branch) ws on ws.workspace_id = ap.workspace_id
      join clinic_reception.providers pr on pr.id = ap.provider_id
     where (ap.starts_at at time zone 'Africa/Cairo')::date between p_from and p_to),
  g as (
    select provider_id, doctor, specialty, count(*) booked,
           count(*) filter (where status in ('arrived', 'completed')) attended,
           count(*) filter (where status = 'no_show') no_show,
           count(*) filter (where status = 'cancelled') cancelled
      from a group by provider_id, doctor, specialty)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('doctor', doctor, 'specialty', specialty, 'booked', booked, 'attended', attended,
              'no_show', no_show, 'cancelled', cancelled,
              'no_show_rate', case when booked > 0 then round(100.0 * no_show / booked, 1) else 0 end,
              'cancel_rate', case when booked > 0 then round(100.0 * cancelled / booked, 1) else 0 end) order by no_show + cancelled desc, doctor) from g), '[]'::jsonb),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'count', n) order by n desc)
                           from (select reason, count(*) n from a where status = 'cancelled' and reason is not null group by reason order by n desc limit 10) r), '[]'::jsonb),
    'totals', (select jsonb_build_object('booked', coalesce(sum(booked), 0), 'attended', coalesce(sum(attended), 0), 'no_show', coalesce(sum(no_show), 0),
              'cancelled', coalesce(sum(cancelled), 0)) from g))
    into v;
  return v;
end $$;

-- ── Slot occupancy: booked minutes vs published availability ───────────────────────────────────────────
create function public.report_slot_occupancy(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('slot_occupancy');
  perform public.report_check_period(p_from, p_to);
  with av as (
    select a.provider_id, sum(extract(epoch from a.ends_at - a.starts_at) / 60) minutes
      from clinic_reception.availability a
      join public.report_workspaces(p_branch) ws on ws.workspace_id = a.workspace_id
     where (a.starts_at at time zone 'Africa/Cairo')::date between p_from and p_to
     group by a.provider_id),
  bk as (
    select ap.provider_id, count(*) appointments, sum(extract(epoch from ap.ends_at - ap.starts_at) / 60) minutes
      from clinic_reception.appointments ap
      join public.report_workspaces(p_branch) ws on ws.workspace_id = ap.workspace_id
     where ap.status <> 'cancelled' and (ap.starts_at at time zone 'Africa/Cairo')::date between p_from and p_to
     group by ap.provider_id),
  g as (
    select pr.name doctor, pr.department specialty, round(coalesce(av.minutes, 0)) available_minutes,
           round(coalesce(bk.minutes, 0)) booked_minutes, coalesce(bk.appointments, 0) appointments
      from clinic_reception.providers pr
      join public.report_workspaces(p_branch) ws on ws.workspace_id = pr.workspace_id
      left join av on av.provider_id = pr.id
      left join bk on bk.provider_id = pr.id
     where av.minutes is not null or bk.minutes is not null)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('doctor', doctor, 'specialty', specialty, 'available_hours', round(available_minutes / 60.0, 1),
              'booked_hours', round(booked_minutes / 60.0, 1), 'appointments', appointments,
              'occupancy', case when available_minutes > 0 then round(100.0 * booked_minutes / available_minutes, 1) end)
              order by case when available_minutes > 0 then booked_minutes / available_minutes end desc nulls last, doctor) from g), '[]'::jsonb),
    'totals', (select jsonb_build_object('available_hours', round(coalesce(sum(available_minutes), 0) / 60.0, 1),
              'booked_hours', round(coalesce(sum(booked_minutes), 0) / 60.0, 1), 'appointments', coalesce(sum(appointments), 0),
              'occupancy', case when sum(available_minutes) > 0 then round(100.0 * sum(booked_minutes) filter (where available_minutes > 0) / sum(available_minutes), 1) end) from g))
    into v;
  return v;
end $$;

revoke all on function public.report_cashier_variance(date, date, uuid), public.report_patient_balances(date, uuid),
  public.report_adjustments_log(date, date, uuid, text), public.report_deferred_revenue(date, uuid),
  public.report_no_show_by_doctor(date, date, uuid), public.report_slot_occupancy(date, date, uuid) from public, anon;
grant execute on function public.report_cashier_variance(date, date, uuid), public.report_patient_balances(date, uuid),
  public.report_adjustments_log(date, date, uuid, text), public.report_deferred_revenue(date, uuid),
  public.report_no_show_by_doctor(date, date, uuid), public.report_slot_occupancy(date, date, uuid) to authenticated;

commit;
