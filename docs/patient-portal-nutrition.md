# Nutrition daily tracking — staged release, 2026-09-12

## Deployment order

1. Run `supabase/migrations/20260912_nutrition_daily_tracking.sql` in project
   `uuijfbpgvtdxgaosqpxo`. The same DDL is in setup.sql section 54.
2. Replace `patient-portal-nutrition` with the complete index.ts from this release.
   Deploy in Supabase Dashboard; legacy Verify JWT OFF. auth.getUser() still validates sessions.
3. Merge/publish this release's dashboard and portal assets to main, then refresh.

The existing visit-level table and API operations remain supported throughout rollout.
The new UI must not publish before the SQL and Edge Function. No secrets change.

## Daily model

New table: patient_nutrition_daily_completions. Unique key is
(visit_id, meal_id, tracking_date). No client-supplied patient ID is accepted.
Dates follow Africa/Cairo and must be between visit_date and today inclusive.
No end date or fixed duration is inferred; a visit's plan remains selectable for
subsequent days. Each visit has its own daily states, even when plans overlap.

The existing patient_nutrition_meal_completions rows are preserved without conversion.
Their completed_at is a confirmation timestamp, not proof of the actual meal date.
Both interfaces show them separately as previous undated confirmations.
New writes go exclusively to the daily table after the UI release.

Daily row fields: id, visit_id, meal_id, tracking_date, meal_name_snapshot,
completed, completed_at, recorded_by_admin_id, recorded_by_account_id, updated_at.
Meal name is captured by a database trigger from the visit's snapshot, not the template.
Repeat assignment preserves completed_at; clearing confirmation sets it to null.
Reconfirming sets a new server timestamp. Last writer's account/admin is recorded.

## Security

The Edge Function validates auth.getUser(), active/activated portal account,
and exact patient_account_access with approved, non-revoked, non-expired access.
It derives patient_id from visit_id and checks meal_id membership in the visit snapshot.
Family membership and staff privileges do not bypass portal access checks.

The daily table has RLS with the same staff read/write scope as section 53.
No direct patient write policy is added. A BEFORE trigger validates date/meal,
sets server timestamps, and overwrites actor fields. Service-role patient writes
also recheck the active account and effective approved patient access in the trigger.
Authenticated staff writes record my_admin_id() and clear the patient account actor.
An AFTER trigger records nutrition_daily_completion_set in patient_portal_audit_log
inside the same transaction; audit failure rolls back the completion.
No per-entity visibility or new family grants are introduced.

## API

POST `{op:"daily_overview",offset:0,tracking_date:"2026-09-12"}` returns
`{visits,next_offset,tracking_date,today}`. Page size 20, each visit contains daily
completions and legacy_completions. Queries are scoped to effective approved records.

POST `{op:"set_daily_completion",visit_id,meal_id,tracking_date,completed:true}`
returns `{ok:true,completion,tracking_date,audit_recorded:true}` after the transaction.
Boolean is assigned, never toggled. Future/invalid/pre-visit dates are rejected.
Legacy overview/set_completion operations stay compatible with old cached clients;
those old operations still use the separate legacy table and its existing audit behavior.

## Interfaces

Dashboard: separate collapsible cards; newest visit open, older visits closed.
Plan title from template_name_snapshot, doctor, date-only formatting; visit_time is
shown only when explicitly stored. Delete is inside an options menu.
Each card has a day picker, confirmed count, progress bar and per-meal badge.
Confirmation times use Cairo and are labeled as confirmation times.
Empty meals show an explanation instead of 0/0. Status polls every 15 seconds for
open cards while visible and stops after closing the patient view.
Edit form has its own day picker and prevents edits while initial status is loading.

Portal: newest visit per patient opens first, day picker, progress and per-meal controls.
Date cannot change during a pending save. Failed writes restore last acknowledged state.
Old-view responses cannot overwrite a replacement view. No medical data cache added.
Nutrition remains last/leftmost in the tabs.

## Validation and limits

- portal-nutrition.cjs: legacy compatibility, daily API, date validation, exact patient access.
- portal-nutrition-ui.cjs: escaped content, pending controls, rollback and stale views.
- nutrition-dashboard.cjs: asynchronous checkboxes, daily summary and polling cleanup.
- nutrition-daily-sql.cjs: PGlite/Postgres migration run twice, separate dates,
  repeated timestamps, meal/date guards, RLS denial, trusted staff actor and atomic audit rollback.
  Run with @electric-sql/pglite available via NODE_PATH.
- General smoke suite still fails in existing dashboard fixtures before completion.
- Browser rendering could not be checked locally because Chromium download returned 502.
  Live visual and authenticated integration checks remain pending staged deployment.

No live patient records were changed in development. SQL was tested on synthetic data.
