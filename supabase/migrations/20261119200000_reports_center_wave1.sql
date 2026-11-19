-- Reports center — wave 1 (owner request 2026-11-19).
--   * Registry of reports + per-report access (by role or by named admin), managed by the owner (super_admin) only.
--   * Branch dimension from day one: clinic_reception.workspaces.branch_id → public.inventory_branches.
--   * Five read-only reports: cash closing, revenue by specialty/doctor, doctor dues, unbilled services, daily flash.
-- Rules: every report RPC is SECURITY DEFINER, pinned search_path, checks public.report_allowed() first, never writes,
-- reads LIVE reception workspaces only, and shows patients by file number only (no names/phones/medical data).
-- Doctor dues are hard-limited to super_admin / general_manager / financial_manager whatever the grants say.
begin;

-- ── Branch dimension ────────────────────────────────────────────────────────────────────────────────────
alter table clinic_reception.workspaces add column if not exists branch_id uuid references public.inventory_branches(id);
update clinic_reception.workspaces w set branch_id = b.id
  from (select id from public.inventory_branches where active order by created_at limit 1) b
 where w.mode = 'live' and w.branch_id is null;

-- ── Registry + access ───────────────────────────────────────────────────────────────────────────────────
create table public.report_registry (
  code text primary key check (code ~ '^[a-z_]{3,40}$'),
  title text not null,
  area text not null,
  sort integer not null default 100,
  sensitive boolean not null default false,
  active boolean not null default true
);
create table public.report_access (
  id uuid primary key default gen_random_uuid(),
  report_code text not null references public.report_registry(code) on delete cascade,
  role text,
  admin_id uuid references public.admins(id) on delete cascade,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  check ((role is null) <> (admin_id is null))
);
create unique index report_access_role_uq on public.report_access(report_code, role) where role is not null;
create unique index report_access_admin_uq on public.report_access(report_code, admin_id) where admin_id is not null;
create table public.report_access_audit (
  id bigint generated always as identity primary key,
  report_code text not null,
  actor uuid references public.admins(id),
  before jsonb not null,
  after jsonb not null,
  at timestamptz not null default now()
);
alter table public.report_registry enable row level security;
alter table public.report_access enable row level security;
alter table public.report_access_audit enable row level security;
-- No direct policies: everything goes through the functions below.
revoke all on public.report_registry, public.report_access, public.report_access_audit from anon, authenticated;

insert into public.report_registry(code, title, area, sort, sensitive) values
  ('daily_flash',       'التقرير الصباحي',               'operations', 10, false),
  ('cash_closing',      'الإقفال اليومي للخزنة',          'cash',       20, false),
  ('revenue_by_doctor', 'إيرادات التخصصات والدكاترة',      'cash',       30, false),
  ('unbilled_services', 'خدمات اتنفذت ومتفوترتش',          'cash',       40, false),
  ('doctor_dues',       'مستحقات الدكاترة',               'doctors',    50, true);

insert into public.report_access(report_code, role)
select r, x from (values
  ('daily_flash','general_manager'), ('daily_flash','financial_manager'),
  ('cash_closing','general_manager'), ('cash_closing','financial_manager'), ('cash_closing','accountant'),
  ('revenue_by_doctor','general_manager'), ('revenue_by_doctor','financial_manager'), ('revenue_by_doctor','accountant'),
  ('unbilled_services','general_manager'), ('unbilled_services','financial_manager'), ('unbilled_services','accountant'),
  ('doctor_dues','general_manager'), ('doctor_dues','financial_manager')) v(r, x);

create function public.report_allowed(p_code text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and exists (select 1 from public.report_registry g where g.code = p_code and g.active) and (
    public.is_super()
    or (
      exists (select 1 from public.report_access a
               where a.report_code = p_code
                 and (a.admin_id = public.my_admin_id() or (a.role is not null and public.has_role(a.role))))
      and (not (select sensitive from public.report_registry where code = p_code)
           or public.has_role('general_manager') or public.has_role('financial_manager'))
    ))
$$;

create function public.report_require(p_code text) returns void
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not public.report_allowed(p_code) then raise exception 'ليس لديك صلاحية لهذا التقرير'; end if;
end $$;

-- Live workspaces in scope for a branch filter (null = all branches).
create function public.report_workspaces(p_branch uuid) returns table(workspace_id uuid, branch_id uuid, branch_name text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select w.id, w.branch_id, coalesce(b.name, 'بدون فرع')
    from clinic_reception.workspaces w left join public.inventory_branches b on b.id = w.branch_id
   where w.mode = 'live' and (p_branch is null or w.branch_id = p_branch)
$$;

create function public.report_catalog() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select case when public.my_admin_id() is null then '[]'::jsonb else jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'title', g.title, 'area', g.area, 'sensitive', g.sensitive,
                                                            'allowed', public.report_allowed(g.code)) order by g.sort)
                          from public.report_registry g where g.active), '[]'::jsonb),
    'branches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.created_at)
                           from public.inventory_branches b where b.active), '[]'::jsonb),
    'is_owner', public.is_super()) end
$$;

-- Owner-only management: list | set {code, roles[], admin_ids[]}.
create function public.report_access_admin(p_action text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_code text := p_payload->>'code'; v_before jsonb; v_after jsonb; v_me uuid := public.my_admin_id();
begin
  if not public.is_super() then raise exception 'صلاحيات التقارير للمالك فقط'; end if;
  if p_action = 'set' then
    if not exists (select 1 from public.report_registry where code = v_code) then raise exception 'تقرير غير معروف'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('role', role, 'admin_id', admin_id)), '[]'::jsonb) into v_before
      from public.report_access where report_code = v_code;
    delete from public.report_access where report_code = v_code;
    insert into public.report_access(report_code, role, created_by)
    select distinct v_code, r, v_me from jsonb_array_elements_text(coalesce(p_payload->'roles', '[]'::jsonb)) r where btrim(r) <> '';
    insert into public.report_access(report_code, admin_id, created_by)
    select distinct v_code, a.id, v_me from jsonb_array_elements_text(coalesce(p_payload->'admin_ids', '[]'::jsonb)) x
      join public.admins a on a.id = x::uuid;
    select coalesce(jsonb_agg(jsonb_build_object('role', role, 'admin_id', admin_id)), '[]'::jsonb) into v_after
      from public.report_access where report_code = v_code;
    insert into public.report_access_audit(report_code, actor, before, after) values (v_code, v_me, v_before, v_after);
  elsif p_action <> 'list' then
    raise exception 'إجراء غير معروف';
  end if;
  return jsonb_build_object(
    'reports', (select jsonb_agg(jsonb_build_object('code', g.code, 'title', g.title, 'area', g.area, 'sensitive', g.sensitive,
                  'roles', coalesce((select jsonb_agg(a.role order by a.role) from public.report_access a where a.report_code = g.code and a.role is not null), '[]'::jsonb),
                  'admins', coalesce((select jsonb_agg(jsonb_build_object('id', ad.id, 'name', ad.full_name) order by ad.full_name)
                                        from public.report_access a join public.admins ad on ad.id = a.admin_id where a.report_code = g.code), '[]'::jsonb)) order by g.sort)
                from public.report_registry g where g.active),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'role', role) order by full_name), '[]'::jsonb)
                 from public.admins where active));
end $$;

-- ── 1. Cash closing (desk shifts of live workspaces) ───────────────────────────────────────────────────
create function public.report_cash_closing(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('cash_closing');
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then raise exception 'راجع الفترة'; end if;
  with s as (
    select sh.id, ws.branch_name, r.name register_name, ca.full_name cashier, sh.opened_at, sh.closed_at, sh.status,
           sh.expected, sh.counted, sh.difference, rv.full_name reviewer,
           coalesce(sum(p.amount) filter (where p.method = 'cash'), 0) cash,
           coalesce(sum(p.amount) filter (where p.method = 'pos'), 0) pos,
           coalesce(sum(p.amount) filter (where p.method in ('instapay', 'wallet')), 0) instapay,
           coalesce(sum(p.amount) filter (where p.method = 'bank'), 0) bank
      from clinic_reception.shifts sh
      join public.report_workspaces(p_branch) ws on ws.workspace_id = sh.workspace_id
      join clinic_reception.registers r on r.id = sh.register_id
      left join public.admins ca on ca.id = sh.cashier_id
      left join public.admins rv on rv.id = sh.reviewed_by
      left join clinic_reception.payments p on p.shift_id = sh.id
     where (sh.opened_at at time zone 'Africa/Cairo')::date between p_from and p_to
     group by sh.id, ws.branch_name, r.name, ca.full_name, rv.full_name)
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object('branch', branch_name, 'register', register_name, 'cashier', cashier,
              'opened_at', opened_at, 'closed_at', closed_at, 'status', status, 'cash', cash, 'pos', pos, 'instapay', instapay, 'bank', bank,
              'expected', expected, 'counted', counted, 'difference', difference, 'reviewer', reviewer) order by opened_at desc), '[]'::jsonb),
    'totals', jsonb_build_object('shifts', count(*), 'cash', coalesce(sum(cash), 0), 'pos', coalesce(sum(pos), 0), 'instapay', coalesce(sum(instapay), 0),
              'bank', coalesce(sum(bank), 0), 'expected', coalesce(sum(expected), 0), 'counted', coalesce(sum(counted), 0),
              'difference', coalesce(sum(difference), 0), 'short_shifts', count(*) filter (where difference < 0)))
    into v from s;
  return v;
end $$;

-- Completed orders of live workspaces, with the money split. Internal helper (not granted).
create function public.report_orders(p_from date, p_to date, p_branch uuid)
returns table(order_id uuid, workspace_id uuid, branch_name text, day date, visit_id uuid, patient_file text, service_name text,
              specialty text, provider_id uuid, provider_name text, doctor_key text, gross numeric, discount numeric, net numeric,
              payer numeric, invoiced boolean, package_covered boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  select o.id, o.workspace_id, ws.branch_name, (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date,
         o.visit_id, pt.file_no, s.name, s.department, pr.id, pr.name, pr.doctor_key,
         round(o.price * o.quantity, 2), round(o.price * o.quantity * o.discount / 100, 2), round(o.price * o.quantity * (1 - o.discount / 100), 2),
         coalesce(i.payer_amount, 0), i.id is not null, o.entitlement_id is not null
    from clinic_reception.orders o
    join public.report_workspaces(p_branch) ws on ws.workspace_id = o.workspace_id
    join clinic_reception.visits v on v.id = o.visit_id
    join clinic_reception.patients pt on pt.id = v.patient_id
    join clinic_reception.services s on s.id = o.service_id
    join clinic_reception.providers pr on pr.id = o.provider_id
    left join clinic_reception.invoices i on i.order_id = o.id
   where o.status = 'completed'
     and (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date between p_from and p_to
$$;
revoke all on function public.report_orders(date, date, uuid) from public, anon, authenticated;
revoke all on function public.report_workspaces(uuid) from public, anon, authenticated;
revoke all on function public.report_require(text) from public, anon, authenticated;

-- ── 2. Revenue by specialty and doctor ─────────────────────────────────────────────────────────────────
create function public.report_revenue_by_doctor(p_from date, p_to date, p_branch uuid default null, p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb; f_spec text := nullif(p_filters->>'specialty', ''); f_doc uuid := nullif(p_filters->>'provider_id', '')::uuid; f_payer text := nullif(p_filters->>'payer', '');
begin
  perform public.report_require('revenue_by_doctor');
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then raise exception 'راجع الفترة'; end if;
  with o as (
    select * from public.report_orders(p_from, p_to, p_branch) x
     where (f_spec is null or x.specialty = f_spec) and (f_doc is null or x.provider_id = f_doc)
       and (f_payer is null or (f_payer = 'insurance' and x.payer > 0) or (f_payer = 'cash' and x.payer = 0))),
  g as (
    select specialty, provider_id, provider_name, count(distinct visit_id) visits, count(*) services,
           sum(gross) gross, sum(discount) discount, sum(net) net, sum(least(payer, net)) insurance
      from o group by specialty, provider_id, provider_name)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('specialty', specialty, 'provider_id', provider_id, 'doctor', provider_name, 'visits', visits,
              'services', services, 'gross', gross, 'discount', discount, 'net', net, 'insurance', insurance, 'patient', net - insurance)
              order by specialty, net desc) from g), '[]'::jsonb),
    'by_specialty', coalesce((select jsonb_agg(jsonb_build_object('specialty', specialty, 'net', net) order by net desc)
              from (select specialty, sum(net) net from g group by specialty) z), '[]'::jsonb),
    'totals', (select jsonb_build_object('visits', count(distinct visit_id), 'services', count(*), 'gross', coalesce(sum(gross), 0),
              'discount', coalesce(sum(discount), 0), 'net', coalesce(sum(net), 0), 'insurance', coalesce(sum(least(payer, net)), 0)) from o),
    'options', jsonb_build_object(
      'specialties', coalesce((select jsonb_agg(distinct s.department) from clinic_reception.services s join public.report_workspaces(p_branch) w on w.workspace_id = s.workspace_id), '[]'::jsonb),
      'doctors', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name) from clinic_reception.providers p
                             join public.report_workspaces(p_branch) w on w.workspace_id = p.workspace_id where p.active), '[]'::jsonb)))
    into v;
  return v;
end $$;

-- ── 3. Unbilled services (completed, not invoiced, not covered by a package) ───────────────────────────
create function public.report_unbilled_services(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('unbilled_services');
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then raise exception 'راجع الفترة'; end if;
  with o as (select * from public.report_orders(p_from, p_to, p_branch) where not invoiced and not package_covered)
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object('branch', branch_name, 'day', day, 'patient_file', patient_file, 'service', service_name,
              'specialty', specialty, 'doctor', provider_name, 'value', net, 'age_days', (now() at time zone 'Africa/Cairo')::date - day) order by day, service_name), '[]'::jsonb),
    'totals', jsonb_build_object('count', count(*), 'value', coalesce(sum(net), 0)))
    into v from o;
  return v;
end $$;

-- ── 4. Doctor dues (management + financial manager only) ───────────────────────────────────────────────
create function public.report_doctor_dues(p_from date, p_to date, p_branch uuid default null, p_provider uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('doctor_dues');
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then raise exception 'راجع الفترة'; end if;
  with mv as (
    select pr.id provider_id, pr.name, pr.doctor_key, j.source, j.source_id, (j.created_at at time zone 'Africa/Cairo')::date as day,
           l.credit, l.debit, j.description
      from clinic_reception.journal j
      join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
      join public.report_workspaces(p_branch) ws on ws.workspace_id = j.workspace_id
      join clinic_reception.providers pr on pr.id = nullif(j.dimensions->>'provider_id', '')::uuid and pr.workspace_id = j.workspace_id
     where (j.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
       and (p_provider is null or pr.id = p_provider)),
  fin as (
    select q.doctor_key, sum(q.gross) paid from clinic_finance.doctor_payouts q
     where q.status = 'approved' and (q.created_at at time zone 'Africa/Cairo')::date between p_from and p_to group by q.doctor_key),
  docs as (
    select pr.id, pr.name, pr.doctor_key from clinic_reception.providers pr
      join public.report_workspaces(p_branch) ws on ws.workspace_id = pr.workspace_id
     where (p_provider is null or pr.id = p_provider)),
  per as (
    select d.id, d.name, d.doctor_key,
           coalesce((select sum(credit) from mv where mv.provider_id = d.id), 0) accrued,
           coalesce((select sum(debit) from mv where mv.provider_id = d.id and mv.source <> 'doctor_payout'), 0) adjustments,
           coalesce((select sum(debit) from mv where mv.provider_id = d.id and mv.source = 'doctor_payout'), 0)
             + coalesce((select paid from fin where fin.doctor_key = d.doctor_key), 0) paid,
           case when d.doctor_key is not null then clinic_finance.doctor_balance(d.doctor_key) end balance
      from docs d)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('provider_id', id, 'doctor', name, 'doctor_key', doctor_key, 'accrued', accrued,
              'adjustments', adjustments, 'paid', paid, 'balance', balance) order by accrued desc, name)
              from per where accrued > 0 or adjustments > 0 or paid > 0 or coalesce(balance, 0) <> 0), '[]'::jsonb),
    'lines', case when p_provider is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('day', mv.day, 'source', mv.source,
              'description', mv.description, 'service', s.name, 'net_revenue', round(o.price * o.quantity * (1 - o.discount / 100), 2),
              'credit', mv.credit, 'debit', mv.debit) order by mv.day, mv.source)
              from mv left join clinic_reception.orders o on o.id = mv.source_id and mv.source = 'doctor_fee'
                      left join clinic_reception.services s on s.id = o.service_id), '[]'::jsonb) end,
    'totals', (select jsonb_build_object('accrued', coalesce(sum(accrued), 0), 'adjustments', coalesce(sum(adjustments), 0),
              'paid', coalesce(sum(paid), 0), 'balance', coalesce(sum(balance), 0)) from per),
    'options', jsonb_build_object('doctors', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from docs), '[]'::jsonb)))
    into v;
  return v;
end $$;

-- ── 5. Daily flash ─────────────────────────────────────────────────────────────────────────────────────
create function public.report_daily_flash(p_day date default null, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date - 1); v jsonb;
begin
  perform public.report_require('daily_flash');
  with o as (select * from public.report_orders(d - 6, d, p_branch)),
  ap as (select a.* from clinic_reception.appointments a join public.report_workspaces(p_branch) w on w.workspace_id = a.workspace_id
          where (a.starts_at at time zone 'Africa/Cairo')::date = d)
  select jsonb_build_object(
    'day', d,
    'revenue', (select coalesce(sum(net), 0) from o where day = d),
    'revenue_week', coalesce((select jsonb_agg(jsonb_build_object('day', g.day, 'net', coalesce((select sum(net) from o where o.day = g.day), 0)) order by g.day)
                                from (select gs::date as day from generate_series(d - 6, d, interval '1 day') gs) g), '[]'::jsonb),
    'collections', (select coalesce(sum(p.amount), 0) from clinic_reception.payments p join public.report_workspaces(p_branch) w on w.workspace_id = p.workspace_id
                     where (p.created_at at time zone 'Africa/Cairo')::date = d),
    'visits', (select count(*) from clinic_reception.visits vi join public.report_workspaces(p_branch) w on w.workspace_id = vi.workspace_id
                where (vi.opened_at at time zone 'Africa/Cairo')::date = d),
    'appointments', (select count(*) from ap),
    'no_show', (select count(*) from ap where status = 'no_show'),
    'cancelled', (select count(*) from ap where status = 'cancelled'),
    'leads_new', (select count(*) from public.leads l where (l.received_at at time zone 'Africa/Cairo')::date = d),
    'leads_booked', (select count(*) from clinic_reception.attributions t join clinic_reception.appointments a on a.id = t.appointment_id
                       join public.report_workspaces(p_branch) w on w.workspace_id = a.workspace_id
                      where t.lead_id is not null and (a.created_at at time zone 'Africa/Cairo')::date = d),
    'low_stock', (select count(*) from public.inventory_alerts where alert_type = 'low_stock' and resolved_at is null),
    'unbilled', (select jsonb_build_object('count', count(*), 'value', coalesce(sum(net), 0)) from public.report_orders(d - 29, d, p_branch) where not invoiced and not package_covered),
    'cash_difference', (select coalesce(sum(sh.difference), 0) from clinic_reception.shifts sh join public.report_workspaces(p_branch) w on w.workspace_id = sh.workspace_id
                         where (sh.opened_at at time zone 'Africa/Cairo')::date = d))
    into v;
  return v;
end $$;

revoke all on function public.report_allowed(text), public.report_catalog(), public.report_access_admin(text, jsonb),
  public.report_cash_closing(date, date, uuid), public.report_revenue_by_doctor(date, date, uuid, jsonb),
  public.report_unbilled_services(date, date, uuid), public.report_doctor_dues(date, date, uuid, uuid),
  public.report_daily_flash(date, uuid) from public, anon;
grant execute on function public.report_allowed(text), public.report_catalog(), public.report_access_admin(text, jsonb),
  public.report_cash_closing(date, date, uuid), public.report_revenue_by_doctor(date, date, uuid, jsonb),
  public.report_unbilled_services(date, date, uuid), public.report_doctor_dues(date, date, uuid, uuid),
  public.report_daily_flash(date, uuid) to authenticated;

commit;
