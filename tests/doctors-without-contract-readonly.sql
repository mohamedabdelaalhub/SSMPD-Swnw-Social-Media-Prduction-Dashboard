-- READ-ONLY (owner «اعمل التعديل والقايمة» 2026-11-26): which doctors / providers did completed services in the LIVE reception
-- workspace since 2026-11-01 that NO active finance contract covers on the service date — their fees are not computed at all.
-- One row per provider. No patient data. Nothing is written; ends with ROLLBACK.
begin read only;
with o as (
  select p.id pid, p.name provider, p.department, p.doctor_key, s.code, s.department sdept,
         (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date d,
         round(o.price * o.quantity * (1 - o.discount / 100), 2) amount
  from clinic_reception.orders o
  join clinic_reception.providers p on p.id = o.provider_id
  join clinic_reception.workspaces w on w.id = o.workspace_id and w.mode = 'live'
  join clinic_reception.services s on s.id = o.service_id
  where o.status = 'completed' and (coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date >= date '2026-11-01'),
x as (
  select o.*, exists(select 1 from clinic_finance.doctor_contracts c where o.doctor_key is not null and c.doctor_key = o.doctor_key and c.status = 'active'
                       and (c.service_scope = o.code or c.service_scope = 'قسم:' || o.sdept) and c.valid_from <= o.d and c.valid_to >= o.d) covered
  from o)
select x.provider, x.department, coalesce(x.doctor_key, '— مش مربوط بكود دكتور —') doctor_key,
  (select count(*) from clinic_finance.doctor_contracts c where c.doctor_key = x.doctor_key and c.status = 'active') active_contracts,
  (select count(*) from clinic_finance.doctor_contracts c where c.doctor_key = x.doctor_key and c.status = 'pending') pending_contracts,
  count(*) completed_orders,
  count(*) filter (where not covered) uncovered_orders,
  coalesce(sum(amount) filter (where not covered), 0) uncovered_amount,
  string_agg(distinct x.code, ', ') filter (where not covered) uncovered_service_codes,
  min(d) filter (where not covered) first_uncovered, max(d) filter (where not covered) last_uncovered
from x
group by x.pid, x.provider, x.department, x.doctor_key
having count(*) filter (where not covered) > 0
order by (x.doctor_key is null), uncovered_amount desc, x.provider;
rollback;
