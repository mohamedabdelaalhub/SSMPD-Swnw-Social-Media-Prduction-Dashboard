# Service saving and approved doctor contract lookup

The service editor previously discarded every database failure behind the same `تعذر الحفظ` toast. The supplied screenshot contains only this toast and the form footer; it does not identify the failed constraint or request. This patch does not claim a retrospectively proven cause for that particular request.

The editor now keeps errors in the dialog, preserves entered data for correction/retry, validates integer booking duration (5–480), nonnegative service price/markup, selected supplies and positive quantities, detects known duplicate service codes, maps server duplicate/permission/constraint failures, escapes other server messages as text, and prevents concurrent saves. The database remains the authority for races and permissions.

`pricing_doctor_contracts()` is a read-only, financial-view-guarded RPC that returns only explicit fields of approved contracts currently valid by the Cairo date. Pending, expired and future contracts, raw payloads, actor details and balances are excluded. Anonymous callers cannot execute it. It neither changes approved terms nor grants permissions.

Selecting a contract displays the doctor name/key, service scope, doctor percentage, accrual basis, percentage base, supply deduction, effective dates and reference. The percentage is not copied into the center's profit markup. Prices, department, duration and supplies remain sourced from the service definition because the contract does not contain those values. No doctor assignment is saved on the shared service; execution continues to bind the actual doctor and service to the visit.

For a new service, a blank code receives the selected contract's scope. Switching contracts updates only a code that was still automatically supplied; manual edits are preserved. If the scope points to an existing service by exact code, or uniquely by name, the form offers to open that original record. A name-based match explicitly warns when its saved code differs from the contract scope. This fallback is diagnostic only and does not loosen the booking backend's exact code match. Incompatible contract terms are explained without rewriting them.

The live reception doctor-link form previews the automatically sourced identity and department on selection. Its submitted payload uses that selected canonical option; a blank choice no longer coerces to index zero. Trial behavior and booking access restrictions are unchanged.

Validation

- `tests/pricing-doctor-contracts-sql.cjs` applies the migration to PGlite and verifies validity/status filtering, authorization, anonymous denial, output minimization and no contract writes.
- `tests/pricing-doctor-contracts-ui.cjs` runs the real accounting renderer in Chromium at 1280, 390 and 320 pixels with mocked data. It verifies source reuse, auto/manual code handling, mismatch notices, preserved prices, validation, escaped errors, retry, single submission and no doctor financial terms in a service write.
- `tests/reception-doctor-setup-dom.cjs` also verifies that selecting the second doctor previews and submits that doctor's canonical identity without manual code entry.
- Live lookup checks ran under authenticated owner context in a rolled-back transaction, including financial access denial with no authenticated identity. A separate authenticated-owner rollback also verified service insert/update and the real duplicate-code and duration constraints. No patient data, contracts, approvals or prices were persisted by these checks.
- Dashboard smoke, financial-role UI, field help coverage and help DOM checks pass. Smoke retains its existing simulated `requestAnimationFrame` warning.
