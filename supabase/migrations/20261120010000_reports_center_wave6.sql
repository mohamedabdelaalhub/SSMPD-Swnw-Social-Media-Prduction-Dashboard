-- Reports center — wave 6 (owner request 2026-11-19): people, marketing and targets.
-- Six read-only reports + a targets table where editors propose and the owner approves (owner rule 2026-11-19).
-- Appointments with source 'sandbox' are excluded; lead status service_done counts as converted.
-- No lead or patient names/phones anywhere: aggregates per person / source / campaign only.
begin;

insert into public.report_registry(code, title, area, sort, sensitive) values
  ('attendance_summary',  'الحضور والانصراف والجزاءات',       'people',    150, false),
  ('staff_productivity',  'إنتاجية الاستقبال والكول سنتر',     'people',    155, false),
  ('lead_response',       'سرعة الرد على الليدز وتحويلها لحجز', 'marketing', 160, false),
  ('patient_sources',     'مصادر المرضى',                      'marketing', 165, false),
  ('ad_funnel',           'مسار الحملة الإعلانية',              'marketing', 170, false),
  ('targets_vs_actual',   'التارجت مقابل الفعلي',              'marketing', 175, false);

insert into public.report_access(report_code, role)
select r, x from (values
  ('attendance_summary','general_manager'), ('attendance_summary','financial_manager'),
  ('staff_productivity','general_manager'),
  ('lead_response','general_manager'), ('lead_response','page_manager'),
  ('patient_sources','general_manager'), ('patient_sources','page_manager'),
  ('ad_funnel','general_manager'), ('ad_funnel','page_manager'),
  ('targets_vs_actual','general_manager')) v(r, x);

-- ── Targets: proposed by editors, approved by the owner (owner rule 2026-11-19) ─────────────────────────
-- Proposers: super_admin, general_manager, financial_manager, plus admins the approver adds to report_target_editors
-- (e.g. the owner's assistant, Claude Creative, HR managers). Approvers: admins in report_target_approvers (the owner).
-- An approver's own entry is approved at once; everyone else's waits as «pending». Only approved targets count.
-- Campaign cost-per-booking targets (ads plan) live here too: metric 'campaign_cost_per_booking', campaign_code, month NULL.
create table public.report_target_approvers (admin_id uuid primary key references public.admins(id) on delete cascade, added_at timestamptz not null default now());
create table public.report_target_editors (admin_id uuid primary key references public.admins(id) on delete cascade, added_by uuid references public.admins(id),
  added_at timestamptz not null default now());
-- Approver: the owner «محمد عبدالعال» only. Editors seeded: Claude Creative and «سيا المساعدة» (the owner adds others from the UI).
insert into public.report_target_approvers(admin_id) select id from public.admins where id = 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92';
insert into public.report_target_editors(admin_id, added_by)
select a.id, (select id from public.admins where id = 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92') from public.admins a
 where a.id in ('a0fbdfee-d147-4282-b988-186a9ae3e88c', 'f153c808-ffd8-44d7-9fc2-2a270fa95b15');

create table public.report_targets (
  id uuid primary key default gen_random_uuid(),
  metric text not null check (metric in ('branch_revenue', 'branch_visits', 'new_leads', 'cost_per_lead', 'bookings', 'lead_attempts',
                                         'leads_booked', 'lead_first_response_minutes', 'campaign_cost_per_booking')),
  month date check (month is null or extract(day from month) = 1),
  campaign_code text check (campaign_code is null or campaign_code ~ '^[A-Za-z0-9_-]{2,30}$'),
  branch_id uuid references public.inventory_branches(id),
  admin_id uuid references public.admins(id) on delete cascade,
  role text,
  target numeric(14, 2) not null check (target >= 0),
  note text not null default '' check (length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_by uuid references public.admins(id), proposed_at timestamptz not null default now(),
  approved_by uuid references public.admins(id), approved_at timestamptz,
  check (admin_id is null or role is null),
  check ((metric = 'campaign_cost_per_booking') = (campaign_code is not null)),
  check (metric = 'campaign_cost_per_booking' or month is not null)
);
create unique index report_targets_uq on public.report_targets(coalesce(month, '0001-01-01'::date), coalesce(branch_id::text, ''), coalesce(admin_id::text, ''),
  coalesce(role, ''), metric, coalesce(campaign_code, '')) where status <> 'rejected';
alter table public.report_targets enable row level security;
alter table public.report_target_approvers enable row level security;
alter table public.report_target_editors enable row level security;
revoke all on public.report_targets, public.report_target_approvers, public.report_target_editors from anon, authenticated;

-- Campaign cost-per-booking targets from the ads plan the owner approved on 2026-11-13 (moved here from PR #606).
insert into public.report_targets(metric, campaign_code, target, note, status, proposed_by, proposed_at, approved_by, approved_at)
select 'campaign_cost_per_booking', v.code, v.target, 'خطة الإعلانات المعتمدة 2026-11-13', 'approved', o.id, now(), o.id, '2026-11-13 12:00+02'
  from (values ('PHY1', 120), ('LZF1-F', 45), ('DEN1', 105)) v(code, target)
  cross join (select id from public.admins where id = 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92') o;

create function public.report_target_is_approver() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.report_target_approvers where admin_id = public.my_admin_id())
$$;
create function public.report_target_can_propose() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and (public.report_target_is_approver() or public.has_role('super_admin') or public.has_role('general_manager')
    or public.has_role('financial_manager') or exists (select 1 from public.report_target_editors where admin_id = public.my_admin_id()))
$$;
revoke all on function public.report_target_is_approver(), public.report_target_can_propose() from public, anon;
grant execute on function public.report_target_is_approver(), public.report_target_can_propose() to authenticated;

create function public.report_metric_meta(p_metric text) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case p_metric
    when 'branch_revenue' then '{"label":"صافي إيراد الفرع","unit":"money","lower_better":false,"scope":"branch"}'
    when 'branch_visits' then '{"label":"زيارات الفرع","unit":"count","lower_better":false,"scope":"branch"}'
    when 'new_leads' then '{"label":"ليدز جديدة","unit":"count","lower_better":false,"scope":"branch"}'
    when 'cost_per_lead' then '{"label":"تكلفة الليد من الإعلانات","unit":"money","lower_better":true,"scope":"branch"}'
    when 'bookings' then '{"label":"حجوزات اتسجلت","unit":"count","lower_better":false,"scope":"person"}'
    when 'lead_attempts' then '{"label":"محاولات تواصل مع ليدز","unit":"count","lower_better":false,"scope":"person"}'
    when 'leads_booked' then '{"label":"ليدز اتحولت لحجز أو خدمة","unit":"count","lower_better":false,"scope":"person"}'
    when 'lead_first_response_minutes' then '{"label":"متوسط أول رد على الليد (دقيقة)","unit":"minutes","lower_better":true,"scope":"person"}'
    when 'campaign_cost_per_booking' then '{"label":"تكلفة الحجز للحملة","unit":"money","lower_better":true,"scope":"campaign"}'
  end::jsonb
$$;

-- Actual value of a metric for a month, a branch and (optionally) a person, a role or a campaign code. Internal helper.
create function public.report_metric_actual(p_metric text, p_month date, p_branch uuid, p_admin uuid, p_role text, p_campaign text default null) returns numeric
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare f date := p_month; t date := (p_month + interval '1 month')::date - 1; v numeric;
begin
  if p_metric = 'branch_revenue' then select coalesce(sum(net), 0) into v from public.report_orders(f, t, p_branch);
  elsif p_metric = 'branch_visits' then select count(distinct visit_id) into v from public.report_orders(f, t, p_branch);
  elsif p_metric = 'new_leads' then select count(*) into v from public.leads where (received_at at time zone 'Africa/Cairo')::date between f and t;
  elsif p_metric = 'cost_per_lead' then
    select case when sum(leads) > 0 then round(sum(spend) / sum(leads), 2) end into v from public.meta_ads_daily where day between f and t;
  elsif p_metric = 'campaign_cost_per_booking' then
    select case when b.n > 0 then round(s.spend / b.n, 2) end into v
      from (select coalesce(sum(spend), 0) spend from public.meta_ads_daily where day between f and t and campaign_name ilike '%' || p_campaign || '%') s,
           (select count(*) n from clinic_reception.attributions a join clinic_reception.appointments ap on ap.id = a.appointment_id
             where (ap.created_at at time zone 'Africa/Cairo')::date between f and t and coalesce(ap.source, '') <> 'sandbox'
               and a.campaign_id in (select distinct campaign_id from public.meta_ads_daily where campaign_name ilike '%' || p_campaign || '%')) b;
  elsif p_metric = 'bookings' then
    select count(*) into v from clinic_reception.appointments a join public.report_workspaces(p_branch) w on w.workspace_id = a.workspace_id
     where (a.created_at at time zone 'Africa/Cairo')::date between f and t and coalesce(a.source, '') <> 'sandbox'
       and (p_admin is null or a.created_by = p_admin)
       and (p_role is null or exists (select 1 from public.admins ad where ad.id = a.created_by and (ad.role = p_role or exists (select 1 from public.admin_extra_roles r where r.admin_id = ad.id and r.role = p_role))));
  elsif p_metric = 'lead_attempts' then
    select count(*) into v from public.lead_attempts la where (la.attempt_date at time zone 'Africa/Cairo')::date between f and t
       and (p_admin is null or la.employee_id = p_admin)
       and (p_role is null or exists (select 1 from public.admins ad where ad.id = la.employee_id and (ad.role = p_role or exists (select 1 from public.admin_extra_roles r where r.admin_id = ad.id and r.role = p_role))));
  elsif p_metric = 'leads_booked' then
    select count(*) into v from public.leads l where (l.received_at at time zone 'Africa/Cairo')::date between f and t
       and l.current_status in ('booked', 'booked_on_system', 'service_done')
       and (p_admin is null or l.assigned_to = p_admin)
       and (p_role is null or exists (select 1 from public.admins ad where ad.id = l.assigned_to and (ad.role = p_role or exists (select 1 from public.admin_extra_roles r where r.admin_id = ad.id and r.role = p_role))));
  elsif p_metric = 'lead_first_response_minutes' then
    select round(avg(extract(epoch from fa.first_at - l.received_at) / 60), 1) into v
      from public.leads l cross join lateral (select min(attempt_date) first_at from public.lead_attempts la where la.lead_id = l.id) fa
     where fa.first_at is not null and (l.received_at at time zone 'Africa/Cairo')::date between f and t
       and (p_admin is null or l.assigned_to = p_admin)
       and (p_role is null or exists (select 1 from public.admins ad where ad.id = l.assigned_to and (ad.role = p_role or exists (select 1 from public.admin_extra_roles r where r.admin_id = ad.id and r.role = p_role))));
  end if;
  return v;
end $$;
revoke all on function public.report_metric_actual(text, date, uuid, uuid, text, text) from public, anon, authenticated;

-- list {month} | set {...} | approve {id} | reject {id, note} | delete {id} | editors_set {admin_ids[]}.
create function public.report_targets_admin(p_action text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_month date := date_trunc('month', coalesce(nullif(p_payload->>'month', '')::date, (now() at time zone 'Africa/Cairo')::date))::date;
        v_me uuid := public.my_admin_id(); v_appr boolean := public.report_target_is_approver(); v_before jsonb; v_row public.report_targets%rowtype;
        v_metric text := p_payload->>'metric'; v_campaign text := nullif(btrim(coalesce(p_payload->>'campaign_code', '')), '');
begin
  if not public.report_target_can_propose() then raise exception 'مالكش صلاحية على التارجت'; end if;
  if p_action = 'set' then
    if public.report_metric_meta(v_metric) is null then raise exception 'مؤشر غير معروف'; end if;
    if nullif(p_payload->>'admin_id', '') is not null and nullif(p_payload->>'role', '') is not null then raise exception 'اختار شخص أو دور، مش الاتنين'; end if;
    if coalesce((p_payload->>'target')::numeric, -1) < 0 then raise exception 'التارجت لازم رقم موجب'; end if;
    if v_metric = 'campaign_cost_per_booking' and v_campaign is null then raise exception 'اكتب كود الحملة'; end if;
    select to_jsonb(t) into v_before from public.report_targets t
     where coalesce(t.month, '0001-01-01') = case when v_metric = 'campaign_cost_per_booking' then '0001-01-01'::date else v_month end
       and coalesce(t.branch_id::text, '') = coalesce(p_payload->>'branch_id', '') and coalesce(t.admin_id::text, '') = coalesce(p_payload->>'admin_id', '')
       and coalesce(t.role, '') = coalesce(p_payload->>'role', '') and t.metric = v_metric and coalesce(t.campaign_code, '') = coalesce(v_campaign, '') and t.status <> 'rejected';
    if v_before is not null then
      update public.report_targets set status = 'rejected', note = left(note || ' (اتستبدل)', 300) where id = (v_before->>'id')::uuid;
    end if;
    insert into public.report_targets(metric, month, campaign_code, branch_id, admin_id, role, target, note, status, proposed_by, approved_by, approved_at)
    values (v_metric, case when v_metric = 'campaign_cost_per_booking' then null else v_month end, v_campaign,
            nullif(p_payload->>'branch_id', '')::uuid, nullif(p_payload->>'admin_id', '')::uuid, nullif(p_payload->>'role', ''),
            (p_payload->>'target')::numeric, coalesce(p_payload->>'note', ''), case when v_appr then 'approved' else 'pending' end,
            v_me, case when v_appr then v_me end, case when v_appr then now() end);
    insert into public.report_access_audit(report_code, actor, before, after) values ('targets', v_me, coalesce(v_before, '{}'::jsonb), p_payload);
  elsif p_action in ('approve', 'reject') then
    if not v_appr then raise exception 'الموافقة على التارجت للمالك بس'; end if;
    update public.report_targets set status = case when p_action = 'approve' then 'approved' else 'rejected' end, approved_by = v_me, approved_at = now(),
           note = case when p_action = 'reject' and coalesce(p_payload->>'note', '') <> '' then left(note || ' — رفض: ' || (p_payload->>'note'), 300) else note end
     where id = (p_payload->>'id')::uuid and status = 'pending' returning * into v_row;
    if not found then raise exception 'التارجت مش مستني موافقة'; end if;
    insert into public.report_access_audit(report_code, actor, before, after) values ('targets', v_me, jsonb_build_object('id', v_row.id), jsonb_build_object('status', v_row.status));
  elsif p_action = 'delete' then
    delete from public.report_targets where id = (p_payload->>'id')::uuid and (v_appr or (proposed_by = v_me and status = 'pending')) returning to_jsonb(report_targets) into v_before;
    if v_before is null then raise exception 'مينفعش تمسح التارجت ده'; end if;
    insert into public.report_access_audit(report_code, actor, before, after) values ('targets', v_me, v_before, '{}'::jsonb);
  elsif p_action = 'editors_set' then
    if not v_appr then raise exception 'المالك بس بيحدد مين يقترح التارجت'; end if;
    select coalesce(jsonb_agg(admin_id), '[]'::jsonb) into v_before from public.report_target_editors;
    delete from public.report_target_editors;
    insert into public.report_target_editors(admin_id, added_by)
    select distinct a.id, v_me from jsonb_array_elements_text(coalesce(p_payload->'admin_ids', '[]'::jsonb)) x join public.admins a on a.id = x::uuid;
    insert into public.report_access_audit(report_code, actor, before, after) values ('target_editors', v_me, jsonb_build_object('editors', v_before), p_payload);
  elsif p_action <> 'list' then raise exception 'إجراء غير معروف';
  end if;
  return jsonb_build_object('month', v_month, 'is_approver', v_appr,
    'targets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'branch_id', t.branch_id, 'admin_id', t.admin_id, 'admin', a.full_name, 'role', t.role,
                 'metric', t.metric, 'campaign_code', t.campaign_code, 'meta', public.report_metric_meta(t.metric), 'target', t.target, 'note', t.note,
                 'status', t.status, 'proposed_by', pb.full_name, 'approved_by', ab.full_name, 'mine', t.proposed_by = v_me)
                 order by t.status desc, t.metric, a.full_name)
                 from public.report_targets t left join public.admins a on a.id = t.admin_id left join public.admins pb on pb.id = t.proposed_by
                 left join public.admins ab on ab.id = t.approved_by
                where (t.month = v_month or t.month is null) and t.status <> 'rejected'), '[]'::jsonb),
    'metrics', (select jsonb_agg(jsonb_build_object('key', m, 'meta', public.report_metric_meta(m))) from unnest(array['branch_revenue', 'branch_visits', 'new_leads',
                 'cost_per_lead', 'bookings', 'lead_attempts', 'leads_booked', 'lead_first_response_minutes', 'campaign_cost_per_booking']) m),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'role', role) order by full_name), '[]'::jsonb) from public.admins where active),
    'editors', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.full_name) order by a.full_name), '[]'::jsonb)
                  from public.report_target_editors e join public.admins a on a.id = e.admin_id),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb) from public.inventory_branches where active));
end $$;

-- Approved campaign cost-per-booking targets for the Meta Ads screen (ads chat, PR #606).
create function public.report_campaign_targets() returns table(code text, target numeric, approved_by text, approved_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public as $$
  select t.campaign_code, t.target, a.full_name, t.approved_at
    from public.report_targets t left join public.admins a on a.id = t.approved_by
   where t.metric = 'campaign_cost_per_booking' and t.status = 'approved'
     and (public.is_super() or coalesce((select public.can_manage_all_content()), false))
$$;

-- ── Targets vs actual (month; approved targets only, campaign targets measured in the same month) ──────
create function public.report_targets_vs_actual(p_month date default null, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare m date := date_trunc('month', coalesce(p_month, (now() at time zone 'Africa/Cairo')::date))::date; v jsonb;
begin
  perform public.report_require('targets_vs_actual');
  with t as (
    select t.*, a.full_name, public.report_metric_meta(t.metric) meta,
           public.report_metric_actual(t.metric, m, coalesce(t.branch_id, p_branch), t.admin_id, t.role, t.campaign_code) actual
      from public.report_targets t left join public.admins a on a.id = t.admin_id
     where t.status = 'approved' and (t.month = m or t.month is null) and (p_branch is null or t.branch_id is null or t.branch_id = p_branch)),
  r as (
    select coalesce(full_name, case when campaign_code is not null then 'حملة ' || campaign_code when role is not null then 'دور: ' || role else 'الفرع' end) owner,
           role, metric, meta->>'label' label, meta->>'unit' unit, (meta->>'lower_better')::boolean lower_better, target, actual,
           case when target > 0 and actual is not null then
             round(case when (meta->>'lower_better')::boolean then 100 * target / nullif(actual, 0) else 100 * actual / target end, 1) end achievement
      from t)
  select jsonb_build_object('month', m,
    'pending', (select count(*) from public.report_targets where status = 'pending' and (month = m or month is null)),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by owner, label) from r), '[]'::jsonb),
    'totals', (select jsonb_build_object('targets', count(*), 'met', count(*) filter (where achievement >= 100),
              'avg_achievement', round(avg(least(achievement, 150)), 1)) from r))
    into v;
  return v;
end $$;

-- ── Attendance, lateness, absence, overtime and deductions per person (company level) ─────────────────
create function public.report_attendance_summary(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  perform public.report_require('attendance_summary');
  perform public.report_check_period(p_from, p_to);
  with a as (
    select p.id person_id, p.full_name, p.department, at.day, at.status, at.scheduled_start, at.scheduled_end, at.actual_start, at.actual_end
      from clinic_people.attendance at join clinic_people.people p on p.id = at.person_id
     where at.day between p_from and p_to and at.status <> 'rejected'),
  g as (
    select person_id, full_name, department, count(*) scheduled_days,
           count(*) filter (where actual_start is not null) attended_days,
           count(*) filter (where actual_start is null and day < today) absent_days,
           count(*) filter (where actual_start > scheduled_start + interval '5 minutes') late_days,
           round(coalesce(sum(extract(epoch from actual_start - scheduled_start) / 60) filter (where actual_start > scheduled_start + interval '5 minutes'), 0)) late_minutes,
           round(coalesce(sum(extract(epoch from scheduled_end - actual_end) / 60) filter (where actual_end < scheduled_end - interval '5 minutes'), 0)) early_minutes
      from a group by person_id, full_name, department),
  ot as (select person_id, sum(minutes) minutes from clinic_people.overtime_requests where status = 'approved' and day between p_from and p_to group by person_id),
  ded as (select person_id, sum(amount) amount from clinic_people.pay_adjustments
           where kind = 'deduction' and month between date_trunc('month', p_from)::date and p_to group by person_id),
  r as (select g.*, coalesce(ot.minutes, 0) overtime_minutes, coalesce(ded.amount, 0) deductions
          from g left join ot on ot.person_id = g.person_id left join ded on ded.person_id = g.person_id)
  select jsonb_build_object('scope', 'company',
    'rows', coalesce((select jsonb_agg(to_jsonb(r) - 'person_id' order by absent_days desc, late_minutes desc, full_name) from r), '[]'::jsonb),
    'totals', (select jsonb_build_object('people', count(*), 'scheduled_days', coalesce(sum(scheduled_days), 0), 'attended_days', coalesce(sum(attended_days), 0),
              'absent_days', coalesce(sum(absent_days), 0), 'late_days', coalesce(sum(late_days), 0), 'late_minutes', coalesce(sum(late_minutes), 0),
              'early_minutes', coalesce(sum(early_minutes), 0), 'overtime_minutes', coalesce(sum(overtime_minutes), 0), 'deductions', coalesce(sum(deductions), 0)) from r))
    into v;
  return v;
end $$;

-- ── Reception & call-center productivity per person ────────────────────────────────────────────────────
create function public.report_staff_productivity(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('staff_productivity');
  perform public.report_check_period(p_from, p_to);
  with bk as (select a.created_by id, count(*) n, count(*) filter (where a.status in ('arrived', 'completed')) attended
                from clinic_reception.appointments a join public.report_workspaces(p_branch) w on w.workspace_id = a.workspace_id
               where (a.created_at at time zone 'Africa/Cairo')::date between p_from and p_to and coalesce(a.source, '') <> 'sandbox' group by a.created_by),
  vi as (select vs.opened_by id, count(*) n from clinic_reception.visits vs join public.report_workspaces(p_branch) w on w.workspace_id = vs.workspace_id
          where (vs.opened_at at time zone 'Africa/Cairo')::date between p_from and p_to group by vs.opened_by),
  py as (select p.created_by id, count(*) n, sum(p.amount) amount from clinic_reception.payments p join public.report_workspaces(p_branch) w on w.workspace_id = p.workspace_id
          where (p.created_at at time zone 'Africa/Cairo')::date between p_from and p_to group by p.created_by),
  la as (select employee_id id, count(*) n, count(distinct lead_id) leads, count(*) filter (where result = 'answered') answered
           from public.lead_attempts where (attempt_date at time zone 'Africa/Cairo')::date between p_from and p_to group by employee_id),
  lb as (select assigned_to id, count(*) assigned, count(*) filter (where current_status in ('booked', 'booked_on_system', 'service_done')) booked
           from public.leads where (received_at at time zone 'Africa/Cairo')::date between p_from and p_to group by assigned_to),
  ids as (select id from bk union select id from vi union select id from py union select id from la union select id from lb),
  r as (
    select ad.full_name employee, ad.role, coalesce(bk.n, 0) bookings, coalesce(bk.attended, 0) bookings_attended, coalesce(vi.n, 0) visits_opened,
           coalesce(py.n, 0) payments, coalesce(py.amount, 0) collected, coalesce(la.n, 0) lead_attempts, coalesce(la.answered, 0) answered_calls,
           coalesce(lb.assigned, 0) leads_assigned, coalesce(lb.booked, 0) leads_booked,
           case when coalesce(lb.assigned, 0) > 0 then round(100.0 * lb.booked / lb.assigned, 1) end conversion
      from ids join public.admins ad on ad.id = ids.id
      left join bk on bk.id = ids.id left join vi on vi.id = ids.id left join py on py.id = ids.id left join la on la.id = ids.id left join lb on lb.id = ids.id)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by bookings + lead_attempts desc, employee) from r), '[]'::jsonb),
    'totals', (select jsonb_build_object('bookings', coalesce(sum(bookings), 0), 'visits_opened', coalesce(sum(visits_opened), 0), 'payments', coalesce(sum(payments), 0),
              'collected', coalesce(sum(collected), 0), 'lead_attempts', coalesce(sum(lead_attempts), 0), 'leads_assigned', coalesce(sum(leads_assigned), 0),
              'leads_booked', coalesce(sum(leads_booked), 0)) from r))
    into v;
  return v;
end $$;

-- ── Lead response speed & conversion (per assignee + overall) ──────────────────────────────────────────
create function public.report_lead_response(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('lead_response');
  perform public.report_check_period(p_from, p_to);
  with l as (
    select l.id, l.source, l.assigned_to, l.current_status, l.received_at,
           (select min(attempt_date) from public.lead_attempts la where la.lead_id = l.id) first_at
      from public.leads l where (l.received_at at time zone 'Africa/Cairo')::date between p_from and p_to),
  x as (select *, extract(epoch from first_at - received_at) / 60 mins from l),
  g as (
    select coalesce(ad.full_name, 'مش متوزع') employee, count(*) leads, count(first_at) contacted, count(*) filter (where first_at is null) untouched,
           round(avg(mins)::numeric, 1) avg_first_response, round((percentile_cont(0.5) within group (order by mins))::numeric, 1) median_first_response,
           count(*) filter (where mins <= 15) within_15,
           count(*) filter (where current_status in ('booked', 'booked_on_system', 'service_done')) booked
      from x left join public.admins ad on ad.id = x.assigned_to group by ad.full_name)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object('conversion', case when leads > 0 then round(100.0 * booked / leads, 1) end)
              order by leads desc, employee) from g), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'leads', n, 'booked', b) order by n desc)
              from (select source, count(*) n, count(*) filter (where current_status in ('booked', 'booked_on_system', 'service_done')) b from x group by source) s), '[]'::jsonb),
    'totals', (select jsonb_build_object('leads', count(*), 'contacted', count(first_at), 'untouched', count(*) filter (where first_at is null),
              'avg_first_response', round(avg(mins)::numeric, 1), 'within_15', count(*) filter (where mins <= 15),
              'booked', count(*) filter (where current_status in ('booked', 'booked_on_system', 'service_done'))) from x))
    into v;
  return v;
end $$;

-- ── Patient sources (appointments by source; attendance and revenue) ───────────────────────────────────
create function public.report_patient_sources(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('patient_sources');
  perform public.report_check_period(p_from, p_to);
  with a as (
    select a.id, coalesce(nullif(t.source, ''), nullif(a.source, ''), 'unknown') source, a.status, a.patient_id,
           (select coalesce(sum(round(o.price * o.quantity * (1 - o.discount / 100), 2)), 0) from clinic_reception.visits vs
              join clinic_reception.orders o on o.visit_id = vs.id and o.status = 'completed' where vs.appointment_id = a.id) revenue
      from clinic_reception.appointments a join public.report_workspaces(p_branch) w on w.workspace_id = a.workspace_id
      left join clinic_reception.attributions t on t.appointment_id = a.id
     where (a.starts_at at time zone 'Africa/Cairo')::date between p_from and p_to and coalesce(a.source, '') <> 'sandbox'),
  g as (select source, count(*) appointments, count(distinct patient_id) patients, count(*) filter (where status in ('arrived', 'completed')) attended,
               count(*) filter (where status = 'no_show') no_show, sum(revenue) revenue from a group by source),
  tot as (select sum(appointments) n, sum(revenue) rv from g)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object('share', case when (select n from tot) > 0 then round(100.0 * appointments / (select n from tot), 1) end,
              'attendance_rate', case when appointments > 0 then round(100.0 * attended / appointments, 1) end) order by appointments desc) from g), '[]'::jsonb),
    'totals', (select jsonb_build_object('appointments', coalesce(sum(appointments), 0), 'patients', coalesce(sum(patients), 0), 'attended', coalesce(sum(attended), 0),
              'revenue', coalesce(sum(revenue), 0), 'unknown', coalesce(sum(appointments) filter (where source = 'unknown'), 0)) from g))
    into v;
  return v;
end $$;

-- ── Ad funnel per campaign: spend → leads (Meta) → bookings → attended → revenue ───────────────────────
create function public.report_ad_funnel(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('ad_funnel');
  perform public.report_check_period(p_from, p_to);
  with ads as (
    select coalesce(campaign_id, 'none') campaign_id, max(campaign_name) campaign, sum(spend) spend, sum(impressions) impressions, sum(clicks) clicks,
           sum(msg_started) messages, sum(leads) leads
      from public.meta_ads_daily where day between p_from and p_to group by coalesce(campaign_id, 'none')),
  bk as (
    select t.campaign_id, count(*) bookings, count(*) filter (where a.status in ('arrived', 'completed')) attended,
           coalesce(sum((select sum(round(o.price * o.quantity * (1 - o.discount / 100), 2)) from clinic_reception.visits vs
                     join clinic_reception.orders o on o.visit_id = vs.id and o.status = 'completed' where vs.appointment_id = a.id)), 0) revenue
      from clinic_reception.attributions t join clinic_reception.appointments a on a.id = t.appointment_id
      join public.report_workspaces(p_branch) w on w.workspace_id = a.workspace_id
     where t.campaign_id is not null and coalesce(a.source, '') <> 'sandbox' and (a.created_at at time zone 'Africa/Cairo')::date between p_from and p_to group by t.campaign_id),
  r as (
    select coalesce(ads.campaign, bk.campaign_id) campaign, coalesce(ads.spend, 0) spend, coalesce(ads.impressions, 0) impressions, coalesce(ads.clicks, 0) clicks,
           coalesce(ads.messages, 0) messages, coalesce(ads.leads, 0) leads, coalesce(bk.bookings, 0) bookings, coalesce(bk.attended, 0) attended,
           coalesce(bk.revenue, 0) revenue
      from ads full join bk on bk.campaign_id = ads.campaign_id)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object(
              'cost_per_lead', case when leads > 0 then round(spend / leads, 2) end,
              'cost_per_booking', case when bookings > 0 then round(spend / bookings, 2) end,
              'roas', case when spend > 0 then round(revenue / spend, 2) end) order by spend desc, campaign) from r), '[]'::jsonb),
    'totals', (select jsonb_build_object('spend', coalesce(sum(spend), 0), 'impressions', coalesce(sum(impressions), 0), 'clicks', coalesce(sum(clicks), 0),
              'messages', coalesce(sum(messages), 0), 'leads', coalesce(sum(leads), 0), 'bookings', coalesce(sum(bookings), 0), 'attended', coalesce(sum(attended), 0),
              'revenue', coalesce(sum(revenue), 0),
              'cost_per_booking', case when sum(bookings) > 0 then round(sum(spend) / sum(bookings), 2) end,
              'roas', case when sum(spend) > 0 then round(sum(revenue) / sum(spend), 2) end) from r))
    into v;
  return v;
end $$;

-- ── Daily flash (wave 1): same output, now without sandbox appointments ──────────────────────────────────
create or replace function public.report_daily_flash(p_day date default null, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date - 1); v jsonb;
begin
  perform public.report_require('daily_flash');
  with o as (select * from public.report_orders(d - 6, d, p_branch)),
  ap as (select a.* from clinic_reception.appointments a join public.report_workspaces(p_branch) w on w.workspace_id = a.workspace_id
          where (a.starts_at at time zone 'Africa/Cairo')::date = d and coalesce(a.source, '') <> 'sandbox')
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
                      where t.lead_id is not null and coalesce(a.source, '') <> 'sandbox' and (a.created_at at time zone 'Africa/Cairo')::date = d),
    'low_stock', (select count(*) from public.inventory_alerts where alert_type = 'low_stock' and resolved_at is null),
    'unbilled', (select jsonb_build_object('count', count(*), 'value', coalesce(sum(net), 0)) from public.report_orders(d - 29, d, p_branch) where not invoiced and not package_covered),
    'cash_difference', (select coalesce(sum(sh.difference), 0) from clinic_reception.shifts sh join public.report_workspaces(p_branch) w on w.workspace_id = sh.workspace_id
                         where (sh.opened_at at time zone 'Africa/Cairo')::date = d))
    into v;
  return v;
end $$;

revoke all on function public.report_campaign_targets(), public.report_targets_admin(text, jsonb), public.report_targets_vs_actual(date, uuid), public.report_attendance_summary(date, date, uuid),
  public.report_staff_productivity(date, date, uuid), public.report_lead_response(date, date, uuid), public.report_patient_sources(date, date, uuid),
  public.report_ad_funnel(date, date, uuid) from public, anon;
grant execute on function public.report_campaign_targets(), public.report_targets_admin(text, jsonb), public.report_targets_vs_actual(date, uuid), public.report_attendance_summary(date, date, uuid),
  public.report_staff_productivity(date, date, uuid), public.report_lead_response(date, date, uuid), public.report_patient_sources(date, date, uuid),
  public.report_ad_funnel(date, date, uuid) to authenticated;

commit;
