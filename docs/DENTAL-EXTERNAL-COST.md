# Dental contracts: external lab cost per service line (draft, NOT applied)

## Problem
Implants and orthodontics are paid after the **external dental-lab invoice**. The lab is not a stock item, so `contract.deduction='cost'` (bill_items cost) cannot express it.

## Change (additive) — `supabase/migrations/20261108260000_dental_external_cost.sql`
* `service_lines[i].external_cost` (+ mandatory `external_ref` = lab invoice number when > 0) is accepted by `public.clinic_finance_bill`.
* Stored in two NEW columns of `clinic_finance.doctor_allocation_lines` (`external_cost`, `external_ref`) and added to the existing `line_deduction`; `doctor_allocations.original_deduction` is re-summed.
* `doctor_sync` is **not changed**: it already computes `rate * (base - sum(line_deduction))` per contract, floored at 0.
* `public.clinic_finance_bill` is moved to `clinic_finance.bill_before_external` and wrapped (no `external_cost` in the payload = delegates unchanged). Guard: md5 pin or structural check, "already applied" check, privileges copied from the wrapped function.
* Rollback keeps every stored deduction and copies the external costs to `doctor_allocation_lines_external_backup`.
* Prerequisite: `20261108231000_doctor_service_lines.sql` (already live).
* UI: not done. The service-line rows are rendered by `assets/js/finance-doctors.js` (owned by another branch). The tiny hook there is two optional inputs per row (`external_cost`, `external_ref`) copied into the row object next to `code/amount/kind`; the payload shape is already accepted by the server.

## Rates
| Case | Contract | Fee |
|---|---|---|
| Implant (0000127-0000130) | 30%, basis `collected` (or `performed`), deduction `none` | `30% * (amount - lab)`; with `collected` it follows `collected/revenue` |
| Orthodontics (0000131-0000134, 0000138, 0000080) | 30%, basis `collected` | each installment releases `30% * (total - lab) * installment/total` (pro-rata lab) |

## Installments (verified by test)
One invoice for the whole treatment + several `clinic_finance_collect` payments is supported: every payment re-runs `doctor_sync`, and a `collected` contract earns `target * min(1, collected/revenue)`. Test: invoice 12000, lab 3000, 30%:

| Payment | Pro-rata (built) | "Lab taken from the first payments" |
|---|---|---|
| 1000 | 225 | 0 |
| +3000 (4000) | 900 | 300 |
| +2000 (6000) | 1350 | 900 |
| +1000 (7000) | 1575 | 1200 |
| +5000 (12000) | 2700 | 2700 |

Both end at `30% * (12000-3000)`. They only differ in timing.

## Owner decision (not decided here)
If the first payment is smaller than the lab cost, should the doctor's fee stay **zero until the cost is covered** (cumulative fee = `30% * max(0, collected - lab)`), or is the lab spread pro-rata over the payments (built, never zero after a payment)? The first needs one more additive wrapper over `doctor_sync` (an `external_mode` flag on the line); say the word and it is built and tested the same way.

## Test
`tests/dental-external-cost-sql.cjs` (PGlite with the real finance chain + channels + department contracts + lines): implants 2100, mixed lines 140, collected 1050 -> 2100, ortho series, refund, replay, floor at 0, loud failures with no leftover invoice, legacy parity, byte-identical rollback and re-apply.
