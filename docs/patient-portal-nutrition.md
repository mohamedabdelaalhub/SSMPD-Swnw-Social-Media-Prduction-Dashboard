# Patient portal nutrition integration — 2026-09-12

Same SSMPD project `uuijfbpgvtdxgaosqpxo`, section 53 tables, and `patients.id`.

## Deployment

Create `patient-portal-nutrition` in Supabase Dashboard and deploy the complete
`supabase/functions/patient-portal-nutrition/index.ts`. Set legacy Verify JWT OFF.
The function validates the bearer session with `auth.getUser()` itself. It uses
existing SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY environment variables.
Section 53 must already be applied to the live database. No new tables or RLS policies are required.
GitHub publication does not deploy this Edge Function.

## Contract

POST `{op:"overview",offset:0}` returns `{visits, next_offset}` in pages of 20,
with patient name/code, visit date, doctor, snapshot meals and completion status.
No template table reads. Only effective approved patient access is included.

POST `{op:"set_completion",visit_id,meal_id,completed:true}` assigns a boolean.
`completed:false` clears completed_at. No client patient ID, actor or timestamp is trusted.
The server fetches the visit, derives patient_id, checks exact approved access
(non-revoked, non-expired), and requires exactly one matching meal ID in the snapshot.
Active account and activation_completed_at are required for both operations.
No family membership or staff role grants an exception.

Upsert uses `visit_id,meal_id`; actor is recorded_by_account_id and admin actor is
cleared. Repeating a desired state keeps that boolean, while updating timestamp/actor.
Response `{ok:true,completion,audit_recorded}` returns the saved state.
Audit action is nutrition_meal_completion_set. Like patient-portal-experience,
audit insertion is a separate write, not atomic with completion. An audit failure
is logged and returned as audit_recorded:false; the saved completion remains saved.

## Scope and behavior

The Nutrition tab reads on every open/refresh, supports pagination and explicit retry,
disables a checkbox while saving, and restores its last acknowledged state on failure.
No patient medical data is cached in this module. No direct patient table writes.
No daily tracking date exists in section 53: status is per visit+meal, not per day.
Visit attachments continue through the existing medical-files flow; this tab covers meals.
Per-entity patient_portal_visibility is not introduced here; authorization follows the
requested experience function pattern and section 53 contract.
Dashboard reads the same completion table and polls every 15 seconds while the patient view is open and visible. Visit rows show each meal status and a completed count. The edit form refreshes existing checkboxes after asynchronous reads. Staff writes clear recorded_by_account_id. No Realtime publication or RLS changes are required.

Regression test: `node test/nutrition-dashboard.cjs` covers delayed status loading, refreshed checkboxes, summary, escaping and polling cleanup.

## Verification

`node test/portal-nutrition.cjs` covers session/account/access, target patient isolation,
meal membership, strict boolean, trusted actor, audit and scoped reads.
`node test/portal-nutrition-ui.cjs` covers rendering/escaping, pending controls,
explicit state, failed saves and detached view responses.
The general smoke suite still fails in existing dashboard fixtures before completion;
it does not load these new portal files. Live authenticated testing remains pending
manual Edge deployment. No live patient records were modified during development.
