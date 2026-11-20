-- Home nursing phase 2 (owner «صلح الاخطاء اللي قولتها دي كلها», main chat 4): a nurse-alone home visit must be billable.
-- DECISION: each nurse becomes a reception PROVIDER (her own schedule = center hours, doctor_key = her HR code). Booking,
-- arrival, execution, invoice, collection and the fee accrual then run on the EXISTING provider path — no money code changes:
--   * booking gate: department = service department OR clinic_reception.has_provider_service_scope (scope row + active
--     finance contract for doctor_key + service code) — scopes below, contracts by the accountant;
--   * execution: clinic_reception.sync_doctor_contract needs exactly one active finance contract per (doctor_key = nurse HR
--     code, service_scope = service code) with basis 'performed', base_scope 'service', deduction none/cost → fee =
--     net × rate / 100 posted Dr 5111 / Cr 2120 with dims.provider_id = the nurse's provider (desk payout / حساب الأطباء).
-- The accountant enters the REAL contracts (owner rule: no placeholder agreements): one per nurse per nursing service code,
-- rate 20 (owner's nurse-alone rule). Reception accrues at execution ('performed'); the finance-bill rule «20% of collected»
-- has no reception equivalent — for home visits paid upfront the two are equal; a later collected-basis option is P3.
-- «ممرض/ة مع طبيب» (fixed amount on top of the doctor) is NOT covered by this — the doctor stays the provider; P3.
-- In the booking: pick the nurse as «الطبيب» (her schedule) + «مين اللي هينفّذ؟ = ممرض/ة لوحده» + the same nurse (#641).

-- v2 (main chat preview 15:05Z): clinic_hours row is «المركز بالكامل», days English abbrevs, close 00:00 → handled below.
-- Live preview: 7 nurses with HR codes (one is general_manager with an extra nursing role — owner to confirm), 19 nursing
-- codes (17 الطوارئ, 2 الكيماوي), 0 nursing contracts → nurses are not bookable until the accountant enters contracts.

-- ===================== 0. PREVIEW (read-only) =====================
select a.id, coalesce(p.full_name, a.name) nurse, p.code hr_code, a.role, a.active
  from public.admins a left join clinic_people.people p on p.admin_id = a.id
  where a.active and (a.role in ('nursing','head_nursing') or exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role in ('nursing','head_nursing')))
  order by 2;                                                                                   -- nurses (need an HR code)
select s.code, s.name, s.department from clinic_reception.services s join clinic_reception.workspaces w on w.id = s.workspace_id and w.mode = 'live'
  where s.active and s.name ~ 'تمريض' order by 3, 2;                                              -- nursing service codes
select * from public.clinic_hours order by sort, department;                                     -- center hours
select doctor_key, service_scope, fee_kind, rate, basis, base_scope, deduction, status, valid_from, valid_to
  from clinic_finance.doctor_contracts where service_scope like 'تمريض:%' or doctor_key in (select code from clinic_people.people p join public.admins a on a.id = p.admin_id where a.role in ('nursing','head_nursing'));

-- ===================== 1. APPLY =====================
begin;
with ws as (select id, (select branch from clinic_reception.providers p where p.workspace_id = w.id and p.active limit 1) br
            from clinic_reception.workspaces w where w.mode = 'live'),
     n as (select coalesce(p.full_name, a.name) nm, p.code from public.admins a join clinic_people.people p on p.admin_id = a.id
           where a.active and p.code is not null
             and (a.role in ('nursing','head_nursing') or exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role in ('nursing','head_nursing'))))
insert into clinic_reception.providers(workspace_id, name, doctor_key, department, branch, active)
select ws.id, n.nm, n.code, 'التمريض المنزلي', coalesce(ws.br, 'حدائق الأهرام'), true from ws, n
on conflict (workspace_id, name) do update set doctor_key = excluded.doctor_key, active = true;

-- nursing services each nurse may take (still needs the accountant's contract per code to be bookable/executable)
insert into clinic_reception.provider_service_scopes(provider_id, service_code)
select p.id, s.code from clinic_reception.providers p
  join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live'
  join clinic_reception.services s on s.workspace_id = p.workspace_id and s.active and s.name ~ 'تمريض'
where p.department = 'التمريض المنزلي' and p.doctor_key is not null
on conflict do nothing;

-- schedule = center hours (live row «المركز بالكامل», days {sat,…,fri} English abbrevs; also int / Arabic names; close 00:00 → 23:59)
with h as (select open_time::time o, case when close_time::time = '00:00' then time '23:59' else close_time::time end c, lower(btrim(d::text)) d
           from public.clinic_hours, unnest(days::text[]) d where department ~ '^المركز'),
     dw as (select o, c, case when d ~ '^[0-6]$' then d::int
              when d in ('sun','sunday') then 0 when d in ('mon','monday') then 1 when d in ('tue','tuesday') then 2 when d in ('wed','wednesday') then 3
              when d in ('thu','thursday') then 4 when d in ('fri','friday') then 5 when d in ('sat','saturday') then 6
              else case d when 'الأحد' then 0 when 'الاحد' then 0 when 'الإثنين' then 1 when 'الاثنين' then 1 when 'الثلاثاء' then 2
              when 'الأربعاء' then 3 when 'الاربعاء' then 3 when 'الخميس' then 4 when 'الجمعة' then 5 when 'الجمعه' then 5 when 'السبت' then 6 end end dow from h)
insert into clinic_reception.weekly_slots(workspace_id, provider_id, dow, starts, ends)
select p.workspace_id, p.id, dw.dow, dw.o, dw.c from dw
  join clinic_reception.providers p on p.department = 'التمريض المنزلي' and p.doctor_key is not null
  join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live'
where dw.dow is not null and dw.o <> dw.c
on conflict (provider_id, dow, starts) do nothing;
select clinic_reception.weekly_generate(p.workspace_id, p.id, 28) from clinic_reception.providers p
  join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live' where p.department = 'التمريض المنزلي' and p.doctor_key is not null;
-- the single pseudo provider from 2026-11-20-home-nursing-provider.sql (if it was applied) is replaced by the nurses
update clinic_reception.providers set active = false where name = 'التمريض المنزلي' and doctor_key is null
  and not exists (select 1 from clinic_reception.appointments x where x.provider_id = clinic_reception.providers.id and x.status in ('booked','arrived'));
select p.name, p.doctor_key, (select count(*) from clinic_reception.provider_service_scopes s where s.provider_id = p.id) scopes,
       (select count(*) from clinic_reception.weekly_slots s where s.provider_id = p.id) days
  from clinic_reception.providers p where p.department = 'التمريض المنزلي' order by 1;
commit;

-- ===================== 2. ROLLBACK =====================
-- begin;
-- delete from clinic_reception.availability a using clinic_reception.providers p where a.provider_id = p.id and p.department = 'التمريض المنزلي' and a.source = 'weekly'
--   and not exists (select 1 from clinic_reception.appointments x where x.provider_id = p.id);
-- delete from clinic_reception.weekly_slots s using clinic_reception.providers p where s.provider_id = p.id and p.department = 'التمريض المنزلي';
-- delete from clinic_reception.provider_service_scopes s using clinic_reception.providers p where s.provider_id = p.id and p.department = 'التمريض المنزلي';
-- update clinic_reception.providers set active = false where department = 'التمريض المنزلي';
-- commit;
