# Live schema capture (2026-11-07)

Read-only snapshot of production objects that had no `CREATE` under `supabase/`.
Read with `pg_get_functiondef`. These files are NOT migrations. Nothing here was applied.

- Inventory and gap list: `docs/live-schema/`
- Captured: 100 of 135 functions (clinic_reception 6, legacy_dashboard 23, performance_private 9, public 62).
- Still missing: 35 public functions (see docs/live-schema/still-missing.txt), plus table DDL for 55 tables.
- The SQL Editor markdown export doubles backslashes; they were un-doubled here
  (checked against proposals/doctor-insurance-20261105/service-orders-rpcs.sql: `[\x00-\x1f]`).

## Finding (not fixed)
- `clinic_reception_checkin_candidates`, `clinic_reception_checkin_static`, `clinic_reception_pbx_event` use `'\\D'`
  under standard strings: that regex matches a literal backslash + D, so phones are compared without stripping
  non-digits. The repo `_screen` variants use `'[^0-9]'`. Needs live confirmation before any fix.
