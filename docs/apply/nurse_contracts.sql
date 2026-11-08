-- NOT EXECUTED. Prepared 2026-11-09 for the owner's go. Registers PENDING nursing contracts (a second admin approves them, as for every other contract).
-- Run AFTER migration 20261109100000_external_service_nurse.sql (and 20261108270000_doctor_fixed_fee.sql, which adds fee_kind / fixed_amount) is applied.
-- Parameters (psql):  psql -v valid_from=2026-11-09 -v valid_to=2027-12-31 -f nurse_contracts.sql   (defaults below if not given)
-- Owner rules (2026-11-09):
--   * nurse ALONE on an external service  = 20% of the amount COLLECTED, after supplies/medications  -> scope 'تمريض:وحده', percent 20, basis collected, base_scope service (supplies excluded), deduction none
--   * nurse WITH a doctor (consultation or any service involving a doctor) = flat 100 EGP, no percentage, on top of the doctor's share -> scope 'تمريض:مع طبيب', fixed 100, basis performed
-- Nurses (HR codes): EMP-000001, EMP-000003, EMP-000007, EMP-000008, EMP-000011. Names come from clinic_people.people; a code missing there is reported by the check at the end and gets NO row.
-- Same pattern as apply-dental/contracts_dental.sql (created_by = the same maker admin used for the other batches).
\if :{?valid_from} \else \set valid_from 2026-11-09 \endif
\if :{?valid_to} \else \set valid_to 2027-12-31 \endif
begin;
with nurses(code) as (values ('EMP-000001'),('EMP-000003'),('EMP-000007'),('EMP-000008'),('EMP-000011')),
kinds(scope, fee_kind, rate, fixed_amount, basis, label) as (values
  ('تمريض:وحده',     'percent', 20, null::numeric, 'collected', 'تمريض: ممرض وحده 20% من المحصّل بعد المستلزمات'),
  ('تمريض:مع طبيب',  'fixed',    0, 100,           'performed', 'تمريض: مع طبيب 100 ج ثابتة للفاتورة'))
insert into clinic_finance.doctor_contracts
 (doctor_key, doctor_name, service_scope, valid_from, valid_to, rate, basis, base_scope, deduction, refund_policy, reference, status, payload, created_by, token)
select n.code, p.full_name, k.scope, date :'valid_from', date :'valid_to', k.rate, k.basis, 'service', 'none', 'proportional_revenue', 'قرار المالك 2026-11-09 — ' || k.label,
       'pending',
       jsonb_strip_nulls(jsonb_build_object('from', :'valid_from', 'to', :'valid_to', 'rate', k.rate, 'basis', k.basis, 'scope', k.scope, 'deduction', 'none', 'base_scope', 'service',
         'refund_policy', 'proportional_revenue', 'reference', 'قرار المالك 2026-11-09 — ' || k.label, 'doctor_key', n.code, 'doctor_name', p.full_name,
         'fee_kind', case when k.fee_kind = 'fixed' then 'fixed' end, 'fixed_amount', k.fixed_amount)),
       '3e1f9a1f-7789-4cf0-a756-93caa6d9cc73', gen_random_uuid()
from nurses n cross join kinds k join clinic_people.people p on p.code = n.code
where not exists (select 1 from clinic_finance.doctor_contracts c where c.doctor_key = n.code and c.service_scope = k.scope and c.status in ('pending', 'active') and c.valid_from <= date :'valid_to' and c.valid_to >= date :'valid_from')
returning doctor_key, service_scope, fee_kind, rate, fixed_amount;
-- check: expect 10 rows (5 nurses x 2); anything missing from clinic_people.people is listed here
select n.code as nurse_without_people_row from (values ('EMP-000001'),('EMP-000003'),('EMP-000007'),('EMP-000008'),('EMP-000011')) n(code) where not exists (select 1 from clinic_people.people p where p.code = n.code);
commit;
-- UNDO (before approval): delete from clinic_finance.doctor_contracts where service_scope in ('تمريض:وحده','تمريض:مع طبيب') and status = 'pending';  (or reject them in the contracts screen)
