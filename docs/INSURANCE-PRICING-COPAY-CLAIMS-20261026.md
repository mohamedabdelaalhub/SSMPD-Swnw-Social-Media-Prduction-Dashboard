# Insurance pricing, copay, claims and collection — 2026-10-26

## Business rules

The insurance workflow is one connected operational and accounting cycle, not a standalone price-list feature.

1. Each insurer has one or more contracts.
2. A contract can have multiple card categories/plans.
3. Each plan can use its own price list, or inherit the contract price-list logic.
4. Copay can be:
   - none
   - percentage
   - fixed amount
5. A service can override the plan-level copay rule.
6. Contract pricing supports both discount-based pricing and direct/net fixed pricing.
7. Patient copay is an actual collection at service time and is recorded through the normal finance payment/treasury flow.
8. Insurer net is a receivable and becomes an insurance claim until collected.
9. Contractual discount is neither patient debt nor insurer debt.
10. Each insurer can be linked to a receivable account in the chart of accounts. Account 1121 remains the fallback insurance-claims account.

## Pricing equation

Center price -> contractual pricing -> contracted price -> patient copay -> insurer net.

- `contractual_discount = max(center_price - contracted_price, 0)`
- percentage copay = `contracted_price * percentage / 100`
- fixed copay = `min(fixed_amount, contracted_price)`
- `insurer_net = contracted_price - patient_copay`

## Data model

### `public.insurance_plans`
Stores card category/plan, contract, optional price list, copay type/value, validity and status.

### `public.insurance_plan_service_rules`
Stores service-specific copay overrides. `inherit` means use the plan default.

### Patient and visit context
- `contract_patient_links.insurance_plan_id` stores the patient's linked card plan/category.
- `contract_patient_links.member_reference` stores card/member reference.
- `patient_visits.insurance_plan_id` snapshots the insurance plan on the visit.

### Insurer accounting link
`contracting_entities.receivable_account_code` links the insurer to its receivable account.

### Claims
`clinic_finance.insurance_claims` stores contract, plan, service, center price, contracted price, contractual discount, patient copay, insurer receivable account, collection state and collected amount.

`clinic_finance.insurance_claim_receipts` stores insurer collections and supports partial collection.

## Accounting flow

For an insured visit:

1. Invoice records the full contracted price using the existing service receivable/revenue flow.
2. Patient copay is collected through the normal payment method (cash, POS, bank, wallet or InstaPay).
3. Insurer net is transferred from service receivables to the insurer receivable/claims account.
4. When the insurer pays, the collection debits the actual cash/bank/payment channel and credits the insurer receivable account.
5. Partial collection keeps the claim open as `partially_collected`; full collection marks it `collected`.

## Main RPCs

- `insurance_quote`
- `insurance_workspace`
- `insurance_command`
- `insurance_contract_options`
- `insurance_patient_context`
- `insurance_patient_link_set`
- `clinic_finance_insurance_claim_v2`
- `clinic_finance_insurance_collect`
- `insurance_claims_workspace`
- `insurance_billable_visits`
- `insurance_visit_billing_context`
- `insurance_bill_visit`

The new plan tables are not granted directly to `anon` or `authenticated`; UI access goes through controlled RPCs.

## Frontend

### `assets/js/insurance-contracts.js`
Adds insurance management to the existing contracting module:
- card plans/categories
- percentage/fixed/no copay
- optional plan price list
- service-specific overrides
- receivable account selection
- quote calculator
- claim status and insurer collection
- insurance plan selection during patient registration and visit entry

### `assets/js/insurance-billing.js`
Adds insured-visit billing:
- search by patient/file/visit
- choose covered service
- preview pricing split before posting
- create invoice, collect patient copay and create insurer claim as one database operation

### `supabase/functions/patients-create/index.ts`
Accepts and validates `insurance_plan_id` and member/card reference when creating a patient linked to an insurance contract.

## Compatibility

Existing contract pricing and `clinic_prices` structures remain in place. The new insurance layer extends them rather than replacing them.

Legacy insurance contracts without a card plan receive a default plan derived from the former `booking_coverage` value, so their financial meaning is preserved until staff configure the real card categories. At implementation time there were no live insurance contracts requiring this conversion.

## Verification performed

Transaction/rollback verification covered:
- percentage copay
- fixed copay
- service-specific fixed override
- contractual discount
- insurer-net calculation
- claim creation
- partial insurer collection and remaining balance
- direct-table access restrictions
- no temporary test entities, patients or plans remained after tests

Example verified calculation:
- center price: 600
- contractual price: 540
- contractual discount: 60
- 20% patient copay: 108
- insurer net: 432

A separate fixed-amount plan correctly produced a 100 patient copay and 440 insurer net on the same 540 contracted price.

## Applied migrations

- `insurance_plans_copay_claims`
- `insurance_contract_options`
- `insurance_workspace_finance_helpers`
- `insurance_visit_billing_flow`
- `insurance_visit_billing_context`
- `insurance_supporting_indexes`
