# Fixed-amount doctor fees + a second performer on one invoice (2026-11-08)

Migration `supabase/migrations/20261108270000_doctor_fixed_fee.sql` (+ `supabase/rollbacks/20261108270000_doctor_fixed_fee.rollback.sql`). **Not applied to production.** Additive. Tests: `tests/doctor-fixed-fee-sql.cjs`, `tests/doctor-fixed-fee-dom.cjs`.

## What the owner asked

| Case | Today | After this change |
|---|---|---|
| Nursing: 20% of an external service after supplies | already expressible: exact-service contract, `rate 20`, `deduction sale` (or `cost`) | unchanged |
| Nursing: 100 EGP when the nurse goes out with a doctor (home visit / doctor's external service) | **not expressible** (`rate` is a percent 0..100) | fixed contract: `fee_kind = 'fixed'`, `fixed_amount = 100` on the home-visit service code; the nurse is an *extra performer* on the doctor's invoice |
| Doctor who asks a FIXED amount per outside visit | **not expressible** | fixed contract on that service code (the doctor is the primary performer) |
| Doctor + nurse on ONE home-visit invoice | **not expressible** (`doctor_allocations` PK = `invoice_id`, one `doctor_key`) | `extra_performers` in the bill payload (see below) |

## 1. Fixed fee

* `doctor_contracts.fee_kind` (`'percent'` default | `'fixed'`) and `fixed_amount numeric(12,2)`. CHECK: percent ⇒ `fixed_amount is null`; fixed ⇒ `fixed_amount > 0 and rate = 0 and deduction = 'none'`. Every existing row is `percent`, untouched. A fixed contract has `rate = 0`, so any reader of `rate` sees a harmless 0.
* Creating: `clinic_finance_doctor_command('contract' | 'contract_batch' | 'contract_revise', {…, fee_kind:'fixed', fixed_amount:100})` (no `rate`). The command function is **wrapped, not edited** (so the revisions patch and the payout-phase-2 wrapper keep working). The wrapper validates the amount (> 0, ≤ 100000, 2 decimals), refuses a fixed contract with supplies deduction, refuses `fixed_amount` on a percent request, forces `rate = 0`; a BEFORE INSERT trigger copies `fee_kind`/`fixed_amount` from the stored payload into the columns.
* Overlap check (review) is **unchanged**: same doctor + same scope + overlapping dates, whatever the kind. Maker-checker unchanged.
* `contract_revise` works as before and may switch kind (percent → fixed, fixed → percent). Tested.
* Accrual (`doctor_sync`): **one fixed amount per service line of the invoice that resolves to that contract** (exact service first, then department — the existing resolver). Invoice without service lines (single `doctor_contract_id`): one amount per invoice. Money rules are the same as percent: refund / contractual discount scale it by `revenue / invoice amount`, a voided invoice earns 0, a `collected` contract scales it by `min(1, collected / revenue)`. Posting is the same (Dr 5111 / Cr 2120 on the delta, row in `doctor_accruals`), so `doctor_balance`, payouts, payout cap and the statement work unchanged.
* Mixed invoices work: percent line(s) + fixed line(s) of the same doctor (e.g. 30% consultation + 100 for the visit).
* **Percent contracts and invoices are byte-for-byte unchanged**: an invoice with no fixed contract delegates to the previous `doctor_sync`; test compares fees before/after for plain, lines, channel, refund, returned-deduction, external-cost and collected scenarios and re-syncs every existing invoice (no new accrual row).
* Guards: a fixed contract cannot carry a lab/external cost nor the `first_payment` mode (nothing to deduct from); a reception order agreement (`clinic_reception.doctor_agreements.finance_contract_id`) cannot point to a fixed contract (that path copies the percent).
* UI (contract form only, `finance-doctors.js`): "نوع الأتعاب" selector (نسبة / مبلغ ثابت) in create **and** revise forms, fixed amount field, list/group/allocation shows "100 ج ثابت". The selector is hidden until `clinic_finance_fixed_fee_enabled()` answers true, so the UI can ship before the migration.
* Statement: `doctor_statement` lines show `fee_kind`, `fixed_amount` and a correct `fee_estimate` (patched by exact text anchors; refused if the function drifted).

### Implementation note worth knowing (stale sessions)
`clinic_finance_bill` (lines version) snapshots the contract row into `terms` with a `%rowtype` variable. A database session that compiled it **before** the migration keeps the old column list, so `terms` would lack `fee_kind`. The new accrual therefore reads the kind/amount from the **contract row by id**, never from `terms` (the test runs exactly this situation). No pool recycle is needed.

## 2. The second limitation: one `doctor_key` per invoice

`doctor_allocations` has `PRIMARY KEY (invoice_id)` and one `doctor_key`; `doctor_accruals.invoice_id` FK → `doctor_allocations(invoice_id)` (no uniqueness), `doctor_balance(key)` sums `doctor_accruals` by `doctor_key`.

Options considered:

1. **Change the PK to `(invoice_id, doctor_key)`** — invasive: `doctor_accruals`, `doctor_allocation_lines`, the sync functions, payout cap, statement, reception bridge and the existing finance tests all rely on one row per invoice. Rejected.
2. **Extra rows in new tables, accruing through the existing `doctor_accruals`** — chosen. The PRIMARY doctor stays exactly as today. `doctor_extra_allocations (invoice_id, doctor_key)` + `doctor_extra_lines (invoice_id, doctor_key, line_no)` hold the extra performers; their fee is posted with their own `doctor_key` (the FK to the invoice's primary allocation is satisfied), so `doctor_balance`, payouts and the statement (which is driven by accruals) pick them up with no change.
3. Two invoices (one per performer) — workable today but splits one patient visit into two invoices/receipts; not what the owner asked.

Usage: `clinic_finance_bill({…, doctor_key:'DOC-H', service_lines:[{code:'HV', amount:500}], extra_performers:[{doctor_key:'EMP-000007'}]})`. For every service line the extra performer's **own contract** (exact service, then department, same resolver) decides; lines he has no contract for earn him nothing; at least one line must match; 1–3 extras; not the primary; no duplicates; replay of the same token is idempotent. Refund/void/collected scale his fee like the primary's. Payout cap (`doctor_held_fees`) includes his unpaid-invoice fees when payout phase 2 is present.

Risks / limits (documented, not hidden):

* The primary doctor still needs a contract for **every** line of the invoice (existing rule). If the nurse's line is not the doctor's service, give the doctor a 0% contract on it.
* Extras ignore booking-channel shares and the "returned stock" deduction (those are doctor-consultation notions). An invoice with a channel cannot take extras (refused).
* The statement shows the extra performer's invoice and fee (from accruals) but not the per-line breakdown (lines are listed for the primary only).
* **Invoice UI for extra performers is NOT in this PR** (kept the UI change to the contract form, as requested; `finance-doctors.js` invoice block is shared with another chat). Until it ships the payload is used via the API/`swnw-sql` or a small follow-up field "مشاركون في الأداء" in the invoice form. Proposed follow-up, small.
* Reception order flow (`clinic_reception.orders`) is not touched: it still pays one provider per order (and refuses fixed contracts).
* `pricing_doctor_contracts()` (reception price preview) still exposes `rate` (0 for fixed). It is informational; a fixed contract is shown as 0% there until that function is extended.
* Apply order: after `20261108260000_dental_external_cost` and `20261108240000_contract_revisions`; works with or without statement / payout phase 2 (both are patched only if present). Needs the usual Docker-Postgres rehearsal + backup before production; structural anchors (no md5 pins) are checked against the production text at apply time.

## 3. How the owner's cases are entered (examples, NOT executed)

```
-- Nurse EMP-000007, 100 EGP per home visit (service code HOME_VISIT_CODE), 2027:
clinic_finance_doctor_command('contract', {doctor_key:'EMP-000007', doctor_name:'هدى حمدى ابراهيم', scope:'<home-visit code>', from:'2027-01-01', to:'2027-12-31',
   fee_kind:'fixed', fixed_amount:100, basis:'performed', base_scope:'service', deduction:'none', refund_policy:'proportional_revenue', reference:'اتفاق مكتوب بتاريخ 1/1/2027'}, token)
-- Nurse 20% of an outside service after supplies (existing mechanism):
clinic_finance_doctor_command('contract_batch', {doctor_key:'EMP-000007', …, scopes:[<external service codes>], rate:20, basis:'performed', base_scope:'service', deduction:'sale', …}, token)
-- Doctor asking 300 EGP per outside visit: same as the nurse block with his doctor_key and fixed_amount:300.
```

## 4. Owner decision (2026-11-08): the fee comes OUT OF the service price
The fixed fee (and the nurse percentage) is a deduction from what the patient paid for the service; the center keeps the remainder, nothing is settled on top. Ledger-wise this is how the accrual already works (Dr 5111 / Cr 2120, patient pays the full price). Added rule: a fixed fee never exceeds the price of its line (`least(fixed, line price)`, tested: 100 on a 60 EGP line = 60). Still open: when doctor and nurse share one invoice, is the doctor's percent computed on the full price or on the price after the nurse's fixed amount? (Current: full price, each performer independently.)

## 5. Other owner questions

1. هل المبلغ الثابت بيتخصم من اللي دفعه المريض للخدمة، ولا المركز بيسدده لوحده؟ (التنفيذ الحالي = زي النسبة تمامًا: المريض بيدفع سعر الخدمة كامل، والمبلغ بيتسجّل مستحق للطبيب/الممرضة على المركز (حساب 2120) ويتصرف بالتسوية. لو عايزه يتخصم من سعر الخدمة نفسه ده قرار تسعير مختلف.)
2. إيه أكواد الخدمات الخارجية / الزيارة المنزلية، وإيه أسماء الممرضين (كود الموظف) والدكاترة اللي ليهم مبلغ ثابت وكام؟
3. لما الممرضة تروح مع دكتور: الفاتورة تتسجل باسم الدكتور وهي «مشاركة» (التصميم الحالي)، موافق؟
