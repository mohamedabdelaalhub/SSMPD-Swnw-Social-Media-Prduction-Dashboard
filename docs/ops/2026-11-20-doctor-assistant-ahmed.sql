-- Switch EMP-000005 (first «مساعد طبيب») to role doctor_assistant — owner «موافق على دور مساعد طبيب» (main chat 4, 2026-11-20).
-- Needs migration 20261120290000_doctor_assistant_role.sql applied first.
-- * admins.role → doctor_assistant; extra roles nursing / head_nursing removed (so he leaves the nurse picker and nursing
--   lists). Other extra roles stay.
-- * His provider record (doctor_key EMP-000005) stays as is: home-nursing scopes + 19 ACTIVE contracts kept (owner: «هو ممكن
--   يعمل خدمات منزلي»). One provider record, several departments = provider_service_scopes (the existing model).
-- * Adds scopes for: every active live service in department ~ 'العلاج الطبيعي', and EEG 0000011 / 0000012 / 0000013 (الاشعة).
--   Physio: NO fee contract (owner has not given it) → not bookable for him until a contract is entered and approved.
-- * EEG fee (owner «١٠٪», main chat 4 17:15Z): one PENDING contract per EEG code, same model as the nurse contracts: rate 10 %,
--   basis performed, base_scope service (the service net after discount), deduction none, valid today → 2027-12-31,
--   created_by = the OWNER (set below) → another finance reviewer approves it (الحسابات → الأطباء → «مراجعة المجموعة»).
--   EEG becomes bookable for him only after that approval.

-- ===================== 0. PREVIEW (read-only) =====================
select a.id, a.role, a.active, p.code, coalesce(p.full_name, a.name) name,
       (select array_agg(x.role) from public.admin_extra_roles x where x.admin_id = a.id) extra_roles
  from public.admins a join clinic_people.people p on p.admin_id = a.id where p.code = 'EMP-000005';
select pr.id, pr.name, pr.department, pr.active, (select count(*) from clinic_reception.provider_service_scopes s where s.provider_id = pr.id) scopes,
       (select count(*) from clinic_finance.doctor_contracts c where c.doctor_key = pr.doctor_key and c.status = 'active') active_contracts
  from clinic_reception.providers pr where pr.doctor_key = 'EMP-000005';
select s.code, s.name, s.department from clinic_reception.services s join clinic_reception.workspaces w on w.id = s.workspace_id and w.mode = 'live'
  where s.active and (s.department ~ 'العلاج الطبيعي' or s.code in ('0000011','0000012','0000013')) order by s.department, s.code;
select a.id, a.name, a.role from public.admins a where a.active and a.role = 'super_admin';   -- pick the OWNER's id for step 1

-- ===================== 1. APPLY =====================
begin;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admins_role_check' and pg_get_constraintdef(oid) like '%doctor_assistant%') then
    raise exception 'apply migration 20261120290000_doctor_assistant_role.sql first';
  end if;
end $$;
update public.admins a set role = 'doctor_assistant' from clinic_people.people p
  where p.admin_id = a.id and p.code = 'EMP-000005' and a.role in ('nursing', 'head_nursing');
delete from public.admin_extra_roles x using clinic_people.people p
  where p.admin_id = x.admin_id and p.code = 'EMP-000005' and x.role in ('nursing', 'head_nursing');
insert into clinic_reception.provider_service_scopes(provider_id, service_code)
select pr.id, s.code from clinic_reception.providers pr
  join clinic_reception.workspaces w on w.id = pr.workspace_id and w.mode = 'live'
  join clinic_reception.services s on s.workspace_id = pr.workspace_id and s.active
   and (s.department ~ 'العلاج الطبيعي' or s.code in ('0000011','0000012','0000013'))
where pr.doctor_key = 'EMP-000005' and pr.active
on conflict do nothing;
-- EEG fee contracts (pending)
create temp table _contract_creator on commit drop as select '<OWNER_ADMIN_ID>'::uuid id;   -- ← owner's admins.id
do $$ begin
  if not exists (select 1 from public.admins a join _contract_creator c on c.id = a.id where a.active) then
    raise exception 'set the owner admin id in _contract_creator';
  end if;
end $$;
insert into clinic_finance.doctor_contracts(doctor_key, doctor_name, service_scope, valid_from, valid_to, rate, fee_kind, basis, base_scope,
    deduction, refund_policy, reference, payload, created_by, token)
select p.code, coalesce(p.full_name, a.name), e.code, (now() at time zone 'Africa/Cairo')::date, date '2027-12-31', 10, 'percent', 'performed', 'service', 'none',
       'proportional_revenue', 'رسم مخ — مساعد طبيب 10% — قرار المالك 2026-11-20',
       jsonb_build_object('doctor_key', p.code, 'doctor_name', coalesce(p.full_name, a.name), 'scope', e.code, 'from', (now() at time zone 'Africa/Cairo')::date,
         'to', '2027-12-31', 'fee_kind', 'percent', 'rate', 10, 'basis', 'performed', 'base_scope', 'service', 'deduction', 'none',
         'refund_policy', 'proportional_revenue', 'reference', 'رسم مخ — مساعد طبيب 10% — قرار المالك 2026-11-20', 'source', 'ops 2026-11-20 doctor assistant eeg'),
       (select id from _contract_creator), gen_random_uuid()
from clinic_people.people p join public.admins a on a.id = p.admin_id
cross join (values ('0000011'), ('0000012'), ('0000013')) e(code)
where p.code = 'EMP-000005'
  and not exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = p.code and c.service_scope = e.code and c.status in ('pending','active'));
select service_scope, rate, status from clinic_finance.doctor_contracts where payload->>'source' = 'ops 2026-11-20 doctor assistant eeg' order by 1;  -- expect 3 pending

-- result
select a.role, (select array_agg(x.role) from public.admin_extra_roles x where x.admin_id = a.id) extra_roles
  from public.admins a join clinic_people.people p on p.admin_id = a.id where p.code = 'EMP-000005';
select s.department, count(*) scopes,
       count(*) filter (where clinic_reception.has_provider_service_scope(pr.id, s.code, (now() at time zone 'Africa/Cairo')::date)) bookable
  from clinic_reception.providers pr join clinic_reception.provider_service_scopes sc on sc.provider_id = pr.id
  join clinic_reception.services s on s.workspace_id = pr.workspace_id and s.code = sc.service_code
  where pr.doctor_key = 'EMP-000005' group by 1 order by 1;      -- expect home nursing bookable = 19; physio / EEG bookable = 0 until approval
commit;

-- ===================== 2. ROLLBACK =====================
-- begin;
-- delete from clinic_finance.doctor_contracts where status = 'pending' and payload->>'source' = 'ops 2026-11-20 doctor assistant eeg';
-- update public.admins a set role = 'nursing' from clinic_people.people p where p.admin_id = a.id and p.code = 'EMP-000005' and a.role = 'doctor_assistant';
-- delete from clinic_reception.provider_service_scopes sc using clinic_reception.providers pr, clinic_reception.services s
--   where sc.provider_id = pr.id and pr.doctor_key = 'EMP-000005' and s.workspace_id = pr.workspace_id and s.code = sc.service_code
--     and (s.department ~ 'العلاج الطبيعي' or s.code in ('0000011','0000012','0000013'));
-- commit;
