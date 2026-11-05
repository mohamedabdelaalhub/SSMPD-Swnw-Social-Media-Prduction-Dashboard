# SWNW Patient 360 — Windows ⇄ Supabase Phase 2 interface review

Status: prepared for review only. Nothing here authorizes production schema/Edge/Windows changes.

## Grounded baseline (2026-11-05)

Windows sandbox reports 25 isolated tests covering DPAPI-protected local messages, inbound/outbound/delivery events, idempotent replay, re-open, same-user backup/restore. Silent mode OFF; live task identity unresolved; no Meta end-to-end delivery or Supabase production writes verified.

Live Supabase project already has `patient360_contacts` (6 contacts, unique `channel, external_key`) and `patient360_messages` (47 messages, unique `source_key`), plus followups/cases/insights/audit. `patient_system_links` has no records. Existing `patient360_sync_legacy_whatsapp` only imports social_messages; it is not complete live WhatsApp capture.

A transaction-level, rolled-back synthetic test verified that the existing `source_key` constraint rejects duplicated insertions and `message_status` can change without linking a patient. Follow-up queries verified no synthetic rows persisted and original counts remained 6/47.

## Contract to reconcile with Windows implementer

The Windows implementation report points to `C:\inetpub\SWNW-Windows-Staging-20261006\App_Data\patient360-phase1\SUPABASE_CONTRACT.md`. That file has not been independently fetched from Windows. Obtain a redacted field-by-field payload schema and return/ack semantics before finalizing an Edge API.

Proposed policy:

1. Write-only service-to-service Edge route with its own dedicated secret credential. Never store `service_role` API keys in Windows clients or browsers. Edge authenticates the caller and writes via a constrained server-side RPC.
2. A single event per request, carrying stable source message identity, tenant/channel/WhatsApp conversation identity, message direction, body (when present), event type, delivery status and provider receipt timestamp. Reject oversized/bad/ambiguous events; do not log message bodies.
3. One Postgres transaction for contact resolution and immutable message creation, returning success only **after commit**. Replayed identical message = no duplicate. Reuse current `source_key` uniqueness, and reject collisions that change contact, direction or text.
4. Distinguish local outbox ID from Meta message ID and keep their mapping for receipts. 'Sent' is never proof of 'delivered'; monotonic delivery states require provider evidence. A receipt arriving before its original message stays retryable; do not create phantom deliveries.
5. Treat a lost HTTP acknowledgment as unknown and retry the exact same stable key from DPAPI spool. Never replay the WhatsApp message itself.
6. Preserve current contact external keys for the single verified Swnw tenant. Reconcile any tenant namespace policy before rollout to avoid splitting existing contacts. Do not infer a verified patient or medical history from a telephone number.
7. Keep patient/lead linking, clinical details, and outbound follow-ups out of phase 2. Do not touch Hapi reply engine, Booking Bridge, patient portal, Cloudflare, Claude Creative, or the existing Meta outbox.

## Deployment gates

- [ ] Prove the actual Windows task *run-as* account and DPAPI identity. Restore protected spool under same account. Confirm file ACL and rollback.
- [ ] Inspect actual `SUPABASE_CONTRACT.md` and agree on Meta/local ID and receipt event definitions without any PHI or secrets.
- [ ] Implement and test atomic SQL RPC with grants restricted to service role; inspect RLS/security advisors.
- [ ] Implement write-only Edge handler, with authorized 401/403 tests and dedicated secret; no read endpoints and no existing booking/WA send side effects.
- [ ] Synthetic idempotency, collision, out-of-order delivery, retry after timeout, rollback, tenant and patient-link tests.
- [ ] Verify the 12 already-approved, unconfirmed legacy Outbox messages without indiscriminate replay.
- [ ] Controlled test-number canary after owner approves exact production change. Verify Meta IDs, actual send receipt, database commit ACK, spool reconciliation and kill switch.
- [ ] A full restore/rollback path that leaves the existing Hapi/WhatsApp/Booking Bridge functioning.

## Local Windows references

`REVIEW_AR.md`, `SUPABASE_CONTRACT.md`, and `TEST_RESULTS.txt` are in `C:\inetpub\SWNW-Windows-Staging-20261006\App_Data\patient360-phase1\`. These paths are local to Egypt Windows and not accessible through GitHub/Supabase; **no assumption is made** about their exact contents beyond the supplied summary.

Project tracking: https://github.com/mohamedabdelaalhub/SSMPD-Swnw-Social-Media-Prduction-Dashboard/issues/332
