-- Home nursing — 6 nurses as reception providers + their PENDING finance contracts (owner via main chat 4, 2026-11-20:
-- «بدون شروق — وسجل العقود كلها وهخلي حد تاني يعتمدها»). Builds on 2026-11-20-nurses-as-providers.sql v2 (b5ecac14),
-- which this file replaces for the apply (same provider/scope/schedule logic, EMP-000004 excluded, contracts added).
-- * Providers: every active admin with role/extra role nursing|head_nursing and an HR code, EXCEPT EMP-000004;
--   department 'التمريض المنزلي', doctor_key = HR code, scopes = live services named ~ 'تمريض', schedule = center hours.
-- * Contracts: one clinic_finance.doctor_contracts row per nurse × nursing service code, status 'pending' (the table's normal
--   approval state — same as «تسجيل عقد أتعاب طبيب» in الحسابات): rate 20 %, basis 'performed', base_scope 'service',
--   deduction 'none', refund_policy 'proportional_revenue', valid <today Cairo> → 2027-12-31, created_by = the OWNER's admin
--   (set below). Approval: الحسابات → الأطباء → «مراجعة العقد» / «مراجعة المجموعة (n)» (one click approves the group).
--   Who may approve: super_admin, general_manager, or financial_manager with the accounting 'update' grant — never the
--   creator (contract_review refuses created_by = me), so the owner cannot approve them himself, as he wants.
-- * NOTHING IS BOOKABLE until those contracts are approved: the booking gate and execution need an ACTIVE contract per
--   (nurse HR code, service code).
-- * The single «التمريض المنزلي» provider (doctor_key null, 14:53Z) is deactivated if it has no appointments at all.

-- ===================== 0. PREVIEW (read-only) =====================
select a.id admin_id, coalesce(p.full_name, a.name) nurse, p.code hr_code, a.role,
       case when p.code = 'EMP-000004' then 'EXCLUDED (owner)' when p.code is null then 'NO HR CODE — skipped' else 'provider + contracts' end plan
  from public.admins a left join clinic_people.people p on p.admin_id = a.id
  where a.active and (a.role in ('nursing','head_nursing') or exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role in ('nursing','head_nursing')))
  order by 2;
select s.code, s.name, s.department from clinic_reception.services s join clinic_reception.workspaces w on w.id = s.workspace_id and w.mode = 'live'
  where s.active and s.name ~ 'تمريض' order by 3, 2;                                                   -- expect 19
select p.id, p.name, p.doctor_key, p.active, (select count(*) from clinic_reception.appointments x where x.provider_id = p.id) appts
  from clinic_reception.providers p where p.name = 'التمريض المنزلي' or p.department = 'التمريض المنزلي';
select a.id, a.name, a.role from public.admins a where a.active and a.role = 'super_admin';           -- pick the OWNER's id for step 1
select 'NOT BOOKABLE until the pending contracts are approved by another finance reviewer' note;

-- ===================== 1. APPLY =====================
begin;
create temp table _nurse_contract_creator on commit drop as select '<OWNER_ADMIN_ID>'::uuid id;   -- ← owner's admins.id
do $$ begin
  if not exists (select 1 from public.admins a join _nurse_contract_creator c on c.id = a.id where a.active) then
    raise exception 'set the owner admin id in _nurse_contract_creator';
  end if;
end $$;

create temp table _nurses on commit drop as
  select distinct coalesce(p.full_name, a.name) nm, p.code from public.admins a join clinic_people.people p on p.admin_id = a.id
  where a.active and p.code is not null and p.code <> 'EMP-000004'
    and (a.role in ('nursing','head_nursing') or exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role in ('nursing','head_nursing')));

-- providers
with ws as (select id, (select branch from clinic_reception.providers p where p.workspace_id = w.id and p.active limit 1) br
            from clinic_reception.workspaces w where w.mode = 'live')
insert into clinic_reception.providers(workspace_id, name, doctor_key, department, branch, active)
select ws.id, n.nm, n.code, 'التمريض المنزلي', coalesce(ws.br, 'حدائق الأهرام'), true from ws, _nurses n
on conflict (workspace_id, name) do update set doctor_key = excluded.doctor_key, department = excluded.department, active = true;

-- service scopes
insert into clinic_reception.provider_service_scopes(provider_id, service_code)
select p.id, s.code from clinic_reception.providers p
  join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live'
  join _nurses n on n.code = p.doctor_key
  join clinic_reception.services s on s.workspace_id = p.workspace_id and s.active and s.name ~ 'تمريض'
on conflict do nothing;

-- schedule = center hours (row «المركز بالكامل», English day abbrevs / digits / Arabic names; close 00:00 → 23:59)
with h as (select open_time::time o, case when close_time::time = '00:00' then time '23:59' else close_time::time end c, lower(btrim(d::text)) d
           from public.clinic_hours, unnest(days::text[]) d where department ~ '^المركز'),
     dw as (select o, c, case when d ~ '^[0-6]$' then d::int
              when d in ('sun','sunday') then 0 when d in ('mon','monday') then 1 when d in ('tue','tuesday') then 2 when d in ('wed','wednesday') then 3
              when d in ('thu','thursday') then 4 when d in ('fri','friday') then 5 when d in ('sat','saturday') then 6
              else case d when 'الأحد' then 0 when 'الاحد' then 0 when 'الإثنين' then 1 when 'الاثنين' then 1 when 'الثلاثاء' then 2
              when 'الأربعاء' then 3 when 'الاربعاء' then 3 when 'الخميس' then 4 when 'الجمعة' then 5 when 'الجمعه' then 5 when 'السبت' then 6 end end dow from h)
insert into clinic_reception.weekly_slots(workspace_id, provider_id, dow, starts, ends)
select p.workspace_id, p.id, dw.dow, dw.o, dw.c from dw
  join clinic_reception.providers p on true
  join _nurses n on n.code = p.doctor_key
  join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live'
where dw.dow is not null and dw.o <> dw.c
on conflict (provider_id, dow, starts) do nothing;
select clinic_reception.weekly_generate(p.workspace_id, p.id, 28) from clinic_reception.providers p
  join _nurses n on n.code = p.doctor_key
  join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live';

-- pending finance contracts: nurse × nursing code (skip a pair that already has a pending/active contract)
insert into clinic_finance.doctor_contracts(doctor_key, doctor_name, service_scope, valid_from, valid_to, rate, fee_kind, basis, base_scope,
    deduction, refund_policy, reference, payload, created_by, token)
select n.code, n.nm, s.code, (now() at time zone 'Africa/Cairo')::date, date '2027-12-31', 20, 'percent', 'performed', 'service', 'none',
       'proportional_revenue', 'تمريض منزلي — ممرض/ة لوحده 20% — قرار المالك 2026-11-20',
       jsonb_build_object('doctor_key', n.code, 'doctor_name', n.nm, 'scope', s.code, 'from', (now() at time zone 'Africa/Cairo')::date,
         'to', '2027-12-31', 'fee_kind', 'percent', 'rate', 20, 'basis', 'performed', 'base_scope', 'service', 'deduction', 'none',
         'refund_policy', 'proportional_revenue', 'reference', 'تمريض منزلي — ممرض/ة لوحده 20% — قرار المالك 2026-11-20', 'source', 'ops 2026-11-20 nurses'),
       (select id from _nurse_contract_creator), gen_random_uuid()
from _nurses n
cross join (select distinct s.code from clinic_reception.services s join clinic_reception.workspaces w on w.id = s.workspace_id and w.mode = 'live'
            where s.active and s.name ~ 'تمريض') s
where not exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = n.code and c.service_scope = s.code and c.status in ('pending','active'));

-- retire the single pseudo provider if it never got an appointment
update clinic_reception.providers pr set active = false where pr.name = 'التمريض المنزلي' and pr.doctor_key is null
  and not exists (select 1 from clinic_reception.appointments x where x.provider_id = pr.id);

-- result
select p.name, p.doctor_key, p.active,
       (select count(*) from clinic_reception.provider_service_scopes s where s.provider_id = p.id) scopes,
       (select count(*) from clinic_reception.weekly_slots s where s.provider_id = p.id) days,
       (select count(*) from clinic_finance.doctor_contracts c where c.doctor_key = p.doctor_key and c.status = 'pending') pending_contracts,
       (select count(*) from clinic_finance.doctor_contracts c where c.doctor_key = p.doctor_key and c.status = 'active') active_contracts
  from clinic_reception.providers p where p.department = 'التمريض المنزلي' or p.name = 'التمريض المنزلي' order by 1;   -- expect 6 × 19 pending
commit;

-- ===================== 2. ROLLBACK =====================
-- begin;
-- delete from clinic_finance.doctor_contracts where status = 'pending' and payload->>'source' = 'ops 2026-11-20 nurses';
-- delete from clinic_reception.availability a using clinic_reception.providers p where a.provider_id = p.id and p.department = 'التمريض المنزلي'
--   and p.doctor_key is not null and a.source = 'weekly' and not exists (select 1 from clinic_reception.appointments x where x.provider_id = p.id);
-- delete from clinic_reception.weekly_slots s using clinic_reception.providers p where s.provider_id = p.id and p.department = 'التمريض المنزلي' and p.doctor_key is not null;
-- delete from clinic_reception.provider_service_scopes s using clinic_reception.providers p where s.provider_id = p.id and p.department = 'التمريض المنزلي' and p.doctor_key is not null;
-- update clinic_reception.providers set active = false where department = 'التمريض المنزلي' and doctor_key is not null;
-- commit;
