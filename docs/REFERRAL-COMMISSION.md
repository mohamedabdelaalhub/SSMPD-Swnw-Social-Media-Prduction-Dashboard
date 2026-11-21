# Referral commission (عمولة التحويل) — 2026-11-09

Owner decisions: 10% to the referring doctor, ALL doctors, on lab/radiology performed OUTSIDE the center, computed AFTER the partner cost and supplies. Dr. Elham's 200 EGP is cancelled (same as every doctor). Nothing here is applied.

| Step | File | Effect |
|---|---|---|
| 1 report-only | `supabase/migrations/20261109110000_referral_commission_external.sql` (+ rollback) | replaces `clinic_reception_so_attach` (pinned to production md5 9d6dfad2…): commission only for `mode='external'` lab/radiology; base = `net - provider_payable - supplies` (provider-billed radiology: `center_receivable - supplies`); stored in `order_ext.priced` (`referral_commission`, `referral_base`, `referral_supplies`). No balance changes. |
| 2 data | `docs/referral-rates-seed.sql` | 10% lab + radiology rows in `referral_rates` for every doctor with an active contract (nurses excluded), `valid_from` = day of applying. Not executed. |
| 3 posting (needs owner OK) | `supabase/migrations/20261109111000_referral_commission_posting.sql` (+ rollback) | at status `done` of an external order: recompute with actual supplies, post Dr 5111 / Cr 2120 with `provider_id` of the referring doctor, so `doctor_balance` sees it. Idempotent table `referral_postings`; a doctor without a `providers` row = state `no_provider` (reported, not posted). |

Notes: supplies (`orders.cost`) are 0 at booking and known only after execution, so step 1 shows the figure before supplies and step 3 recomputes. `referral_rates` has 0 rows today. Referring doctors need a `providers` row (doctor_key) to be paid through step 3.
Test: `node tests/referral-commission-sql.cjs` (PGlite, using the production text of the functions from `supabase/live-capture`). Before applying: Docker Postgres rehearsal on a prod-shaped DB + backup.
