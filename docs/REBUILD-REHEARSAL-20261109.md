# Clean-room rebuild rehearsal (2026-11-09, main 3d7f04a)

Goal: can the database be rebuilt from this repo alone (needed before any move off Supabase)? Read-only test on an EMPTY local Postgres 16
with stubs for the Supabase platform (auth, storage, vault, cron, net, pgcrypto functions). Nothing touched production.
Script: `tests/rehearse/clean-room-rebuild.py <repo> <empty-dir> <out.json>` (needs `pip install pgserver psycopg2-binary`).
Order used: setup.sql, supabase/migrations (sorted), loose scripts in supabase/*.sql + supabase/activation/, supabase/live-capture (tables first). Failed files retried until no progress.

## Result
| | rebuilt | production |
|---|---|---|
| SQL files that apply cleanly | 198 of 247 | - |
| tables (9 app schemas) | 325 | 405 |
| functions/procedures (7 schemas) | 627 | 844 |

**Verdict: NOT rebuildable from the repo today.** Roughly 80 tables and 217 functions do not get built.

## Findings
1. `supabase/setup.sql` could not run at all: lines 3922 and 3936 used `$` instead of `$$` (fixed in this PR).
2. Migration history is not self-contained:
   - loose scripts outside `migrations/` are needed (contracting_entities*.sql, operations-*.sql, activation/*.sql) and have no defined order;
   - `legacy_dashboard`, `hub`, `performance_private` schemas have no CREATE SCHEMA anywhere (the live-capture files assume them);
   - live-capture files are per-object reference dumps with cross-dependencies and no order; most still fail (tables_public, public_a/b/c, clinic_reception, legacy_dashboard, performance_private).
3. Real gaps behind the cascades (first failing object, not the 49 downstream files):
   - `20261103162725_digital_team_identity_core_v1`: references `p.login_email` that no repo SQL creates -> blocks `public.digital_team_members` -> about 9 digital-team files fail;
   - doctor-contract chain (20261108230000 ... 20261109130000, 12 files) all wait on `clinic_reception.sync_doctor_contract`, which only exists as a live object;
   - `clinic_reception.journey_settings / journey_events / queue_entries / external_providers / order_reports` and others: live-only tables whose captures fail on ordering;
   - `202610130002_financial_roles_permissions`: "cannot change return type of existing function" -> history was not applied in file order live;
   - `20261017141121_reception_native_cutover` (`booking_enabled`), `202610150001_content_media_archive` (`carousel_slides`), `20261103_reception_doctor_and_booking_notifications` (`o.payload`): columns added live without a migration.
4. Not rebuildable by SQL anyway: Auth users, Storage objects, Edge Functions, pg_cron secrets (Vault), Realtime.

## Recommended fix
Take a schema-only dump of production (`pg_dump --schema-only --no-owner` of public, legacy_dashboard, hub, performance_private, clinic_*, psychcare) and commit it as the baseline;
new migrations apply on top. A catalog-query reconstruction (what live-capture did) lacks grants, triggers, policies, defaults and ordering, so it cannot replace a dump.
The dump needs the database connection password (a secret): the owner would put it in a 0600 file on the server.
