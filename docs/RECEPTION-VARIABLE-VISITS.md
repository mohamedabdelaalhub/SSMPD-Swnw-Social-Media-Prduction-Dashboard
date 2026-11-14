# Packages with patient-chosen visits (2026-11-14)

Owner decision: laser packages are one package per device (Candela, Diode, Fractional) and **the patient decides the number of visits**.

## How it works
- In the pricing screen, a package has a new option «عدد الزيارات تحدده المريضة». When ticked, the package is a **one-visit pattern**
  (visits is forced to 1, exactly one service line) and its price is the price of **one visit**. A database check refuses anything else.
- The reception sale form (`package_sell`) shows «زيارات تحددها المريضة» for those packages: the receptionist enters the number of visits
  (1–365) and optionally the validity in days. The contract price is `price per visit × visits` (no free price entry, so no hidden discount).
  The line is repeated for every visit and the value is split per visit exactly (to the piastre). Installments, if sent, must add up to that total.
- Templates are still produced by `sync_catalog` from the pricing package; a trigger copies the flag to the template, and toggling it updates the active template.
  `sync_catalog` itself is not changed.
- Orthodontic packages and fixed-visit packages behave exactly as before. `visit_terms` and `orthodontic_terms` cannot be combined.

## Not included (ask first)
- Changing the number of visits **after** the sale (the existing `amend_plan` only handles orthodontic plans with `payment_schedule = 'visit'`).
- Pulse-meter services (`laser_pulse_services`) are separate and not touched here.

## Apply order
1. PR #456 migrations (already applied on production on 2026-11-14), 2. this migration, 3. release the front end.
The migration refuses to run if the catalog-readiness columns are missing or if it was already applied.
Rollback: `supabase/rollbacks/20261114190000_reception_variable_visits.rollback.sql`.

## Tests
`tests/reception-variable-visits.cjs` (SQL: sale, entitlements, validation, snapshot flag, catalog trigger, check constraint, double apply) and
`tests/reception-variable-visits-dom.cjs` (the real sale form). `tests/reception-packages.cjs` currently fails between 00:00 and 02:00 Cairo time
(Cairo date ahead of UTC date) even on the untouched #456 commit; it passes at other hours.
