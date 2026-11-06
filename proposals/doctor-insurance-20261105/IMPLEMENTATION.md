# SWNW doctor and insurance workflow — isolated implementation handoff

Status: REVIEWED EXISTING CODE / NOT DEPLOYED. Owner approved implementation; no production writes or migration approved merely by this document.

## Confirmed current implementation
- `assets/js/entity-claims.js` already has a per-service invoice and entity claim batch workspace, server RPC ownership of writes, invoice print/export, copay and receivables, and explicit language that each invoice belongs to one service plus medications/supplies. Reuse it rather than build a second invoicing system.
- `assets/js/insurance-billing.js` has older visit billing fallback and defers to `SSMPDEntityClaims.openBilling()` when loaded.
- `assets/js/finance-doctors.js` manages doctor fee contracts, NOT a verified canonical doctor specialty/grade directory.
- `supabase/migrations/20261018005957_pricing_doctor_contract_lookup.sql` exposes active doctor fee contracts read-only; it does not implement the required specialty+grade consultation price lookup.
- `assets/js/price-list-governance.js` already handles versioned price lists, payer contract links and service terms.

## Approved business contract
1. Exactly one specialty per doctor. Scientific grade is a separate field. Reception may select only services belonging to the doctor's specialty. No client-only filtering as authorization: validate on server when creating a booking/invoice.
2. Consultation price comes from the approved specialty + scientific-grade tariff, then active payer contract. Example consultant EGP 1000/specialist EGP 500 are illustrative, not default data.
3. One insurer invoice per covered service, with linked medication/supply items in the same invoice. Service discounts do not apply to medication/supply prices. Payer responsibility for medication/supply follows the contract, not the absence of a discount.
4. Invoice header: invoice/medical record number, date, payer, patient, doctor, specialty. Line fields: sequence, service, pre-discount price, discount, after-discount price, patient copay, insurer receivable.
5. Detailed monthly claim: beneficiary, member/card number, service category, service, service date, pre-discount price, discount amount, copay, net claim. Claims must reference immutable approved invoice snapshots and reconcile sums.
6. Example: 300 pre-discount, 20% discount = 240, 10% copay = 24, insurer net = 216. Round monetary values at 2 decimal places using a documented deterministic rule.
7. Historical bookings, invoices and claim lines retain the original doctor, specialty, grade, price, contract and copay snapshots after any later directory or price change.

## Implementation boundaries and next code gates
- First inspect the canonical doctors/specialties schema, price-list service identity, active booking RPC, and entity invoice RPC and their permissions. Avoid duplicate doctor or invoice tables.
- Implement doctor specialty/grade validation in the existing server-side booking and billing flow, then scope the reception service picker to the selected doctor's specialty. Include migration only if the canonical schema cannot already express this rule; migration must be additive, RLS-reviewed, reversible where feasible.
- Extend existing entity invoice document/claim export for any missing fields; do not replace existing workflows.
- Test synthetic fixtures: wrong specialty rejected server-side; grade tariff; contracted price; medication/supply no discount; payer responsibility; one invoice per service; claim totals; duplicate idempotency; historical snapshots; unauthorized employee; refunds/rounding; rollback.
- Run isolated integration and UI tests, attach exact commands/logs and SHA before marking READY_FOR_REVIEW. No production Supabase writes, merge, deployment or real patient data before reviewed gate.

Ownership: feature/swnw-doctors-insurance-20261105, separate from P360/Digital/Offload/Booking branches. Claude can continue implementation after verifying task lock and active runtime; GitHub comments are not executable dispatch.
