-- Reports center — wave 3 (owner request 2026-11-19): insurance / unions / contracting entities.
-- Built on clinic_reception.claims (the live reception claim path) and clinic_reception.entities; the entity's
-- public.contracting_entities name is shown when linked. Four read-only reports:
--   claims_monthly (consolidated claims per entity), ar_aging (outstanding per entity by invoice age),
--   claim_adjustments (corrections/returns, contractual reductions, write-offs, payments), entity_profitability.
-- Same rules as waves 1–2: SECURITY DEFINER, pinned search_path, gate first, live workspaces only, no patient names.
-- Note: claim amounts (paid / contractual / allowance) are the claim's CURRENT state; aging is by invoice date.
begin;

insert into public.report_registry(code, title, area, sort, sensitive) values
  ('claims_monthly',       'المطالبات المجمعة لكل جهة',          'insurance', 80, false),
  ('ar_aging',             'أعمار ديون الجهات',                  'insurance', 85, false),
  ('claim_adjustments',    'المرفوضات والتسويات',                'insurance', 90, false),
  ('entity_profitability', 'ربحية وحجم التعاقدات (نقابات وتأمين)', 'insurance', 95, true);

insert into public.report_access(report_code, role)
select r, x from (values
  ('claims_monthly','general_manager'), ('claims_monthly','financial_manager'), ('claims_monthly','accountant'),
  ('ar_aging','general_manager'), ('ar_aging','financial_manager'), ('ar_aging','accountant'),
  ('claim_adjustments','general_manager'), ('claim_adjustments','financial_manager'), ('claim_adjustments','accountant'),
  ('entity_profitability','general_manager'), ('entity_profitability','financial_manager')) v(r, x);

-- Claims of live workspaces with entity + invoice date. Internal helper (not granted).
create function public.report_claims(p_branch uuid)
returns table(claim_id uuid, workspace_id uuid, branch_name text, entity_id uuid, entity text, entity_kind text, day date,
              order_id uuid, amount numeric, paid numeric, contractual numeric, allowance numeric, outstanding numeric, status text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id, c.workspace_id, ws.branch_name, e.id, coalesce(ce.name, e.name), e.kind,
         (i.created_at at time zone 'Africa/Cairo')::date, i.order_id,
         c.amount, c.paid, c.contractual, c.allowance, round(c.amount - c.paid - c.contractual, 2), c.status
    from clinic_reception.claims c
    join public.report_workspaces(p_branch) ws on ws.workspace_id = c.workspace_id
    join clinic_reception.entities e on e.id = c.entity_id
    join clinic_reception.invoices i on i.id = c.invoice_id
    left join public.contracting_entities ce on ce.id = e.contracting_entity_id
$$;
revoke all on function public.report_claims(uuid) from public, anon, authenticated;

-- ── Consolidated claims per entity (period = invoice date) ─────────────────────────────────────────────
create function public.report_claims_monthly(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('claims_monthly');
  perform public.report_check_period(p_from, p_to);
  with c as (select * from public.report_claims(p_branch) where day between p_from and p_to),
  g as (
    select entity_id, entity, entity_kind, count(*) claims,
           count(*) filter (where status = 'ready') ready, count(*) filter (where status = 'submitted') submitted,
           count(*) filter (where status = 'correction') correction, count(*) filter (where status = 'settled') settled,
           sum(amount) amount, sum(paid) paid, sum(contractual) contractual, sum(allowance) allowance, sum(outstanding) outstanding
      from c group by entity_id, entity, entity_kind)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) - 'entity_id' order by amount desc, entity) from g), '[]'::jsonb),
    'totals', (select jsonb_build_object('claims', coalesce(sum(claims), 0), 'amount', coalesce(sum(amount), 0), 'paid', coalesce(sum(paid), 0),
              'contractual', coalesce(sum(contractual), 0), 'allowance', coalesce(sum(allowance), 0), 'outstanding', coalesce(sum(outstanding), 0),
              'ready', coalesce(sum(ready), 0), 'submitted', coalesce(sum(submitted), 0), 'correction', coalesce(sum(correction), 0),
              'settled', coalesce(sum(settled), 0)) from g))
    into v;
  return v;
end $$;

-- ── AR aging per entity (as of a date; buckets by invoice age) ─────────────────────────────────────────
create function public.report_ar_aging(p_as_of date default null, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_as_of, (now() at time zone 'Africa/Cairo')::date); v jsonb;
begin
  perform public.report_require('ar_aging');
  with c as (select *, d - day age from public.report_claims(p_branch) where day <= d and outstanding > 0),
  g as (
    select entity, entity_kind, count(*) claims,
           coalesce(sum(outstanding) filter (where age <= 30), 0) b0_30,
           coalesce(sum(outstanding) filter (where age between 31 and 60), 0) b31_60,
           coalesce(sum(outstanding) filter (where age between 61 and 90), 0) b61_90,
           coalesce(sum(outstanding) filter (where age > 90), 0) b90_plus,
           sum(outstanding) total, sum(allowance) allowance, max(age) oldest_days
      from c group by entity_id, entity, entity_kind)
  select jsonb_build_object(
    'as_of', d,
    'rows', coalesce((select jsonb_agg(to_jsonb(g) order by total desc, entity) from g), '[]'::jsonb),
    'totals', (select jsonb_build_object('claims', coalesce(sum(claims), 0), 'b0_30', coalesce(sum(b0_30), 0), 'b31_60', coalesce(sum(b31_60), 0),
              'b61_90', coalesce(sum(b61_90), 0), 'b90_plus', coalesce(sum(b90_plus), 0), 'total', coalesce(sum(total), 0),
              'allowance', coalesce(sum(allowance), 0)) from g))
    into v;
  return v;
end $$;

-- ── Claim adjustments: corrections (returned), contractual reductions, write-offs, payments ────────────
create function public.report_claim_adjustments(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('claim_adjustments');
  perform public.report_check_period(p_from, p_to);
  with x as (
    select (r.created_at at time zone 'Africa/Cairo')::date as day, c.entity, r.kind, r.amount, r.reason, r.status,
           ad.full_name requested_by, rv.full_name reviewed_by, c.amount claim_amount
      from clinic_reception.requests r
      join public.report_claims(p_branch) c on c.claim_id = r.subject_id and c.workspace_id = r.workspace_id
      left join public.admins ad on ad.id = r.created_by
      left join public.admins rv on rv.id = r.reviewed_by
     where r.kind in ('claim_correction', 'claim_contractual', 'claim_loss', 'claim_payment', 'claim_submit')
       and (r.created_at at time zone 'Africa/Cairo')::date between p_from and p_to)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by day desc, entity) from x), '[]'::jsonb),
    'by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'count', n, 'amount', a) order by kind)
                           from (select kind, count(*) n, sum(amount) a from x where status <> 'rejected' group by kind) k), '[]'::jsonb),
    'totals', (select jsonb_build_object('count', count(*),
              'returned', count(*) filter (where kind = 'claim_correction'),
              'contractual', coalesce(sum(amount) filter (where kind = 'claim_contractual' and status = 'approved'), 0),
              'loss', coalesce(sum(amount) filter (where kind = 'claim_loss' and status = 'approved'), 0),
              'collected', coalesce(sum(amount) filter (where kind = 'claim_payment' and status = 'approved'), 0),
              'pending', count(*) filter (where status = 'pending')) from x))
    into v;
  return v;
end $$;

-- ── Entity profitability & volume (period = service completion date) ───────────────────────────────────
create function public.report_entity_profitability(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('entity_profitability');
  perform public.report_check_period(p_from, p_to);
  with o as (
    select c.entity, c.entity_kind, ro.order_id, ro.visit_id, ro.net, c.amount claim_amount, c.contractual, c.paid,
           coalesce((select sum(l.credit - l.debit) from clinic_reception.journal j
                       join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
                      where j.workspace_id = c.workspace_id and j.source = 'doctor_fee' and j.source_id = ro.order_id), 0) doctor_fee,
           coalesce(od.cost, 0) supplies_cost, v.patient_id
      from public.report_orders(p_from, p_to, p_branch) ro
      join public.report_claims(p_branch) c on c.order_id = ro.order_id
      join clinic_reception.orders od on od.id = ro.order_id
      join clinic_reception.visits v on v.id = ro.visit_id),
  g as (
    select entity, entity_kind, count(distinct patient_id) patients, count(distinct visit_id) visits, count(*) services,
           sum(net) revenue, sum(claim_amount) claimed, sum(contractual) contractual, sum(paid) collected,
           sum(doctor_fee) doctor_fees, sum(supplies_cost) supplies_cost,
           sum(net - contractual - doctor_fee - supplies_cost) margin
      from o group by entity, entity_kind)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object('margin_pct', case when revenue > 0 then round(100 * margin / revenue, 1) end)
              order by revenue desc, entity) from g), '[]'::jsonb),
    'totals', (select jsonb_build_object('patients', coalesce(sum(patients), 0), 'visits', coalesce(sum(visits), 0), 'services', coalesce(sum(services), 0),
              'revenue', coalesce(sum(revenue), 0), 'claimed', coalesce(sum(claimed), 0), 'contractual', coalesce(sum(contractual), 0),
              'collected', coalesce(sum(collected), 0), 'doctor_fees', coalesce(sum(doctor_fees), 0), 'supplies_cost', coalesce(sum(supplies_cost), 0),
              'margin', coalesce(sum(margin), 0),
              'margin_pct', case when sum(revenue) > 0 then round(100 * sum(margin) / sum(revenue), 1) end) from g))
    into v;
  return v;
end $$;

revoke all on function public.report_claims_monthly(date, date, uuid), public.report_ar_aging(date, uuid),
  public.report_claim_adjustments(date, date, uuid), public.report_entity_profitability(date, date, uuid) from public, anon;
grant execute on function public.report_claims_monthly(date, date, uuid), public.report_ar_aging(date, uuid),
  public.report_claim_adjustments(date, date, uuid), public.report_entity_profitability(date, date, uuid) to authenticated;

commit;
