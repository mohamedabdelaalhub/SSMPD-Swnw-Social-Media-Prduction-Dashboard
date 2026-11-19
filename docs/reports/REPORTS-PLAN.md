# Reports tab — Phase 0 inventory & wave plan (no code)

Status legend: **R** = data ready · **P** = partial (needs a column/link or confirmation) · **M** = needs a module that doesn't exist yet.
Source = repo migrations (supabase/migrations). Live row counts not verified yet (see "Server reads").

## Cross-cutting design
- **Registry**: `public.report_registry(code, title_ar, group, status, sort)` + `public.report_access(report_code, admin_id NULL, role NULL)` — owner (super_admin) manages it from Control Panel → «صلاحيات التقارير». Default rows seeded per report (below); owner edits freely.
- **Gate**: `public.report_allowed(code)` SECURITY DEFINER; every report RPC = `public.report_<code>(p_from, p_to, p_branch, p_filters jsonb)` SECURITY DEFINER, `set search_path`, calls the gate first, read-only (no INSERT/UPDATE), no medical data.
- **Branch dimension**: every RPC takes `p_branch` and returns a `branch` column from day 1. Today one branch; mapping source to confirm: `inventory_branches` / `org_branch_details` / `clinic_reception.workspaces` (live only).
- **UI**: one `render-reports.js` shell: list grouped by area → report page = filter bar + KPI tiles + table + totals row + Excel (CSV/XLSX client-side) + PDF (print stylesheet, Swnw header). Help article + version per wave (rule 6).

## A) Inventory
| # | Report | Main sources | Status |
|---|---|---|---|
|1|Daily cash/shift closing|clinic_finance.shifts/registers/payments/entries/lines, cash_limit; (clinic_reception.shifts if live)|R|
|2|Void/refund/discount log|clinic_finance.requests + audit, journal_corrections; clinic_reception.discount_requests/requests|R/P (refund kinds to confirm)|
|3|Revenue by specialty & doctor|clinic_finance.invoices/bill_items + clinic_reception.services/service_specialties/service_performers|R|
|4|Doctor payout statement|clinic_finance.doctor_accruals/allocations/allocation_lines/extra_lines/payouts/payout_invoices, doctor_contracts|R|
|5|Cross-referral efficiency|clinic_reception.referral_issues/referral_rates, orders, attributions|P|
|6|Monthly consolidated claims|clinic_finance.entity_claim_batches/lines, insurance_claims, entity_service_invoices|R|
|7|AR aging|insurance_claims/payments, entity_claim_batches, claim_followups, installments|R|
|8|Claim rejections & adjustments|clinic_finance.insurance_actions, claim_followups|P (rejection reasons coverage)|
|9|Supplies consumption per clinic/procedure|inventory_movements, clinic_reception.patient_supplies, inventory_locations|R|
|10|Medicines consumption|same + item category=drug; visit_medications are clinical (not stock)|P (drug flag in inventory_items?)|
|11|Stock shortages & expiry|inventory_items/lots/alerts, min levels|R|
|12|Branch P&L|clinic_finance.entries/lines + accounts (chart)|R (needs account→P&L mapping check)|
|13|Balance sheet|same ledger + legacy_assets/opening_details|R|
|14|G&A expenses|ledger expense accounts, cash_vouchers, business_requests|R|
|15|Cash flow|ledger cash/bank accounts, treasury_transfers, bank_rows|R/P (direct method by account tags)|
|16|Tax position & e-invoices|tax_types/tax_payments, clinic_people.tax_entries|P; **e-invoice (ETA) = M**|
|17|Fixed assets & depreciation|payroll_assets_tax + legacy_assets migrations|R|
|18|Attendance, shifts, penalties|clinic_people.attendance/device_punches/person_shifts/pay_adjustments/overtime|R|
|19|Reception & call-center productivity|appointments/visits/invoices by actor; leads/lead_attempts; call_events|P (no telephony log beyond call_events?)|
|20|Patient sources|clinic_reception.attributions, leads.source, meta|R|
|21|Target vs actual|public.kpi_targets + actuals|P (what targets are filled?)|
|22|Unions/insurance contracts profitability & volume|clinic_reception.entities/entity_contracts, insurance claims, payments|R|
|23|Device utilization & ROI|clinic_reception.devices/device_uses + revenue; cost from assets|P (device↔asset link)|
|24|Remaining sessions (deferred revenue)|clinic_reception.packages/entitlements/installments, orders.entitlement_id|R (if packages live)|
|25|Margin per service|revenue − doctor share − supplies cost (patient_supplies.cost) − external cost|P (overheads allocation rule)|
|26|Full ad funnel|meta_campaigns/meta_ads_daily → leads → appointments → invoices|P (lead→patient match coverage)|
|27|Nursing variance (custody vs sessions)|clinic_people.custody_items/movements, inventory_location_staff, patient_supplies vs orders|P (standard consumption per service missing)|
|+|Unbilled services (leakage)|orders/visits without invoice|R|
|+|No-show/cancel per doctor|appointments status, masa_cancelled_bookings|R|
|+|Doctor slot occupancy|availability/weekly_slots/schedule_exceptions vs appointments|R|
|+|Waiting time|visits check-in vs start (checkin_tokens, order_status_log)|P (start timestamp?)|
|+|Open deposits/advances|payments unallocated, installments, advances|R|
|+|Cash variance per cashier|shifts counted vs book|R|
|+|Lead response speed & conversion|leads, lead_status_log, lead_attempts|R|
|+|Daily flash|composite of 1,3,no-show,leads|R (after wave 1–2)|

## B) Waves (each = one small PR)
1. Framework + registry + per-report access (owner-managed) + reports **1, 2, 3, 4, 24**.
2. Cashier variance, open deposits, unbilled services, no-show, occupancy, Daily Flash.
3. Claims/AR: 6, 7, 8, 22.
4. Ledger statements: 12, 13, 14, 15, 17, 16 (tax only).
5. Stock: 9, 10, 11, 27.
6. People/marketing: 18, 19, 20, 26, lead speed, 21.
7. Profitability: 25, 23, 5, waiting time.
Later/M: e-invoicing (ETA), pharmacy module.

## C) Per-report spec template (wave 1 detailed)
Common filters: date range, branch, (doctor, specialty where relevant). Every table has totals row, Excel + PDF.
- **1 Cash closing** — filters: date, branch, register, cashier. Cols: shift, cashier, opened/closed, opening, cash in, cash out, expected, counted, variance, cards/InstaPay/bank, status, reviewer. Totals per method + variance. Default: super_admin, general_manager, financial_manager.
- **2 Void/refund/discount** — filters: period, branch, kind, actor, approver. Cols: date, invoice ref, kind, amount, original amount, reason, requested by, approved by, status. Totals by kind/actor. Default: super_admin, GM, financial_manager.
- **3 Revenue by specialty/doctor** — filters: period, branch, specialty, doctor, payer (cash/insurance/entity). Cols: specialty, doctor, visits, gross, discounts, net, cash vs insurance, share %. Totals + chart. Default: super_admin, GM, financial_manager.
- **4 Doctor payout statement** — filters: month, branch, doctor. Cols: service, date, invoice, net revenue, contract rule, doctor share, extras, deductions, paid, balance. Totals per doctor. Default: super_admin, financial_manager (+ doctor sees own only? owner decides).
- **24 Deferred revenue** — filters: as-of date, branch, package template, specialty. Cols: patient code (name only if allowed), package, sold date, paid, sessions total/used/remaining, remaining value, expiry. Totals remaining value. Default: super_admin, GM, financial_manager.

## Server reads needed (main chat)
1. Which cash system is live: `clinic_finance.shifts` vs `clinic_reception.shifts` — counts last 30 days of each; `clinic_reception.workspaces` rows by mode.
2. Branch source: rows of `public.inventory_branches`, `public.org_branch_details`.
3. Row counts: clinic_reception.packages/entitlements, clinic_finance.doctor_accruals/doctor_payouts, clinic_finance.requests grouped by kind, clinic_reception.discount_requests, clinic_finance.bill_items, public.kpi_targets.
4. Distinct roles in `public.admins` and whether a `has_role()` multi-role table exists live.

## Live facts (main chat, 2026-11-19 02:16Z)
- Branch key = `public.inventory_branches.id` (1 row: الفرع الرئيسي - حدائق الأهرام); details in `org_branch_details`.
- Live reception workspace: `dc6e99a1-…` (4 trial workspaces must be excluded from all reports).
- Both cash layers run: clinic_finance (treasury/registers) + clinic_reception (desk shifts linked to finance). Report 1 joins both. Only 2 shifts each in the last 30 days.
- Empty today: packages/entitlements (→ report 24 empty), clinic_finance.requests + discount_requests (→ report 2 empty), doctor_accruals/payouts, bill_items.
- Doctor fees live in `clinic_reception.journal` (2120 lines, desk_payout_rx, #590) → report 4 sources there, not doctor_accruals. Report 3 sources reception invoices/orders.
- kpi_targets has 32 rows → report 21 is closer to ready.
- Roles: admins.role + public.admin_extra_roles (has_role()). Access rows may target role or admin.
- Reserved: migration prefix 20261119200000, help version 20261118-54.

## Relations map (from migrations + live-capture snapshot; owner decisions 2026-11-19)
Owner decisions: tax report yes, no e-invoice link (ETA postponed) · targets for branch manager / social media / call center / reception, set by «محمد ابراهيم» (admin 7e608973…, role reception — owner to confirm) · pharmacy = an inventory store (live: substore «الادوية - تمريض») · doctor sees only patients examined/scheduled today, no money · payouts = management + financial manager only.

| Report | Join path | Date · Amount · Doctor · Specialty · Branch |
|---|---|---|
|1 Cash closing|reception.shifts.finance_shift_id → finance.shifts → registers; finance.payments(shift_id, method); cash_cases(shift_id) = variance case|closed_at · counted/expected/difference · – · – · register→workspace|
|2 Adjustments|finance.requests(kind refund/void) + finance.invoices.voided + journal_corrections; reception.requests(kind refund/credit_note/service_void/package_cancel/method_fix) + discount_requests(order_id, percent)|created_at · amount · via order.provider_id · – · workspace|
|3 Revenue|orders(visit_id, service_id, provider_id, price, discount%, qty, status, completed_at) → invoices(order_id) ; providers(doctor_key, department, branch); service_specialties (live-only)|completed_at · net · provider · service_specialties/department · providers.branch|
|4 Doctor statement|reception.journal(dimensions doctor_key/provider_id/order_id) + journal_lines account 2120; finance.doctor_payouts/desk_payouts/desk_payout_rx; doctor_agreements/doctor_contracts(fee_kind)|journal date · 2120 credit/debit · doctor_key · – · dimensions.branch|
|Doctor day view|admins.id ← clinic_people.people.admin_id → people.doctor_key → providers.doctor_key → appointments/orders.provider_id|today only, no amounts|
|24 Deferred revenue|packages → entitlements(quantity, used, allocated_value, recognized) + installments|as-of · allocated_value×remaining · – · service · workspace|
|No-show/occupancy/wait|appointments(status booked/arrived/completed/cancelled/no_show, cancel_reason, starts_at) vs weekly_slots/availability/schedule_exceptions; visits.opened_at − starts_at; order_status_log (live-only)|
|6/7/8 Claims & AR|reception.claims(entity_id, amount, paid, contractual, status) + entities; finance.insurance_claims/insurance_actions(kind correction/resubmit/contractual/credit_loss/payment), claim_followups, entity_claim_batches(+lines)|
|9/10/11 Stock & pharmacy|inventory_movements(type issue/sale/waste/expired…, location_id, lot_id, reference_type/id); patient_supplies (= drug/supply sold to patient); inventory_items(category text, minimum_quantity); inventory_lots(expiry_date); inventory_alerts|
|12–15 Statements|finance.accounts(kind) + account_config(parent_code); entries(business_date)/lines|
|16 Tax|tax_types(liability_account 2141/2142/2143), tax_payments, clinic_people.tax_entries|
|17 Assets|business_requests(kind asset/depreciation) + legacy_assets|
|18 HR|clinic_people.attendance(scheduled vs actual), person_shifts, pay_adjustments(kind deduction), overtime_requests|
|19/26 Leads & funnel|meta_ads_daily(spend, leads) → leads(received_at, source, patient_id) → lead_attempts (first contact = min attempt − received_at) → attributions(appointment_id, lead_id, campaign_id) → visit → invoice|
|21 Targets|kpi_targets(role, kpi, target, weight) = role KPIs only, super_admin write|
|23 Devices|devices(meter_kind, asset_key text) ← device_uses(order_id, minutes, meters)|

### Gaps to close inside report waves (no new modules)
1. **Branch**: reception tables have no branch_id (providers.branch is text). Add `branch_id` on clinic_reception.workspaces (live workspace → inventory_branches main) — one tiny migration in wave 1.
2. **Targets**: new `public.report_targets(branch_id, owner_admin_id|role, metric, period, target)` + grant `targets_setter` (Mohamed Ibrahim) — wave 6.
3. **Drug flag**: inventory_items.category is free text → use location «الادوية» + optional `is_medicine` flag later; "included in service" = issue movements, "sold to patient" = patient_supplies.
4. **Penalties**: no penalty kind → show pay_adjustments kind=deduction with note.
5. **Device ↔ asset**: asset_key text only → match by text; ROI partial until linked.
6. **Specialty**: service_specialties exists live only (not in migrations) → main chat to confirm before wave 1.
