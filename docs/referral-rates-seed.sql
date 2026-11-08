-- Referral rates seed — NOT EXECUTED. Owner decision 2026-11-09: 10% for ALL referring doctors on lab and radiology performed OUTSIDE the center. Dr. Elham = same as everyone (no 200 EGP).
-- Edit ONLY the two values in `params`, then run in the SQL editor / swnw-sql after the owner approves. Idempotent (on conflict do nothing); re-runnable.
-- Doctors = every doctor_key that has an ACTIVE finance contract, minus the nurse keys. Review the SELECT part first (change `insert` to nothing / run the `select` alone).
with params as (
  select date '2026-11-09' as valid_from,            -- the day the owner applies ("from now")
         10::numeric as percent,
         array['EMP-000001','EMP-000003','EMP-000007','EMP-000008','EMP-000011']::text[] as nurse_keys
), ws as (select id from clinic_reception.workspaces where mode = 'live' order by created_at limit 1),
docs as (select distinct c.doctor_key from clinic_finance.doctor_contracts c, params p where c.status = 'active' and c.doctor_key <> all (p.nurse_keys))
insert into clinic_reception.referral_rates(workspace_id, doctor_key, category, percent, valid_from)
select ws.id, d.doctor_key, cat, p.percent, p.valid_from from ws, docs d, params p, unnest(array['lab', 'radiology']) cat
on conflict (workspace_id, doctor_key, category, valid_from) do nothing;
-- check:  select doctor_key, category, percent from clinic_reception.referral_rates where valid_from = date '2026-11-09' order by 1, 2;
-- undo:   delete from clinic_reception.referral_rates where valid_from = date '2026-11-09' and percent = 10 and category in ('lab','radiology');
