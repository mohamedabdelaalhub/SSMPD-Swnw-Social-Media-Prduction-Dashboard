-- READ ONLY. Who did the source review (name linking) on each union/insurer list, and which approvers (super admin /
-- financial manager) did NOT and so may press «تفعيل العقد» for it (clinic_prices.guard_mapping_price_approval).
-- Staff names and roles only; no patient data. Ends in ROLLBACK.
begin read only;
select 'per_list' part, jsonb_agg(jsonb_build_object('list', l.name, 'contract_status', c.status,
  'source_reviewers', (select jsonb_object_agg(coalesce(nullif(a.name, ''), a.email) || ' (' || a.role || ')', n) from (
      select x.actor_id, count(*) n from clinic_prices.audit x where x.list_id = l.id and x.action = 'source_review' group by x.actor_id) r
      join public.admins a on a.id = r.actor_id),
  'may_activate', (select jsonb_agg(coalesce(nullif(a.name, ''), a.email) || ' (' || a.role || ')' order by a.role) from public.admins a
      where a.active and a.role in ('super_admin', 'financial_manager')
        and not exists (select 1 from clinic_prices.audit x where x.list_id = l.id and x.action = 'source_review' and x.actor_id = a.id)))
  order by l.name)
from clinic_prices.lists l join public.contracting_entity_contracts c on c.price_list_id = l.id
where l.list_kind = 'reference' and l.deleted_at is null and c.status not in ('expired');
rollback;
