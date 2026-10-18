# WhatsApp acceptance audit — 18 October 2026

## Decision: not accepted as the booking agent

The deployed SSMPD `whatsapp-webhook` v17 is a text question-answering handler.
It is not the interactive booking engine described in the older agent guide.
The v16 deployment inspected before the knowledge repair also sent `type: text`
and contained no interactive booking controller. Redeploying v16 cannot restore
the older booking lists.

## Checks completed

- Re-read actual deployed code, compared against repository revision
  `d890fbe0e5e7eb351b56dda5ff4e9adb3857f708`, and read the owner's test exchanges.
- Real WhatsApp replies shown by the owner and saved in `social_messages` now
  identify dentistry and its published doctor. The free-text Saturday reply is
  only conversation, not evidence of a booking being created.
- Existing knowledge tests pass with fake DB, OpenAI and Meta. Actual published
  website parsing separately retains four doctors and their departments. No
  claim of exhaustive clinic catalog coverage.
- `node tests/whatsapp-webhook-contract.cjs`: 22 behavioral transport tests pass
  with fake external systems. This covers verification challenge, wrong token,
  unsupported method, missing/invalid signature, malformed JSON, missing service
  key, inbound persistence and sent status, duplicate event suppression, kill
  switch, allowlist, inbound list/button handling, audio/image responses, spam,
  emergency/complaint alert flags, Graph refusal, brand mapping, missing message
  id, provider failure and the absence of any booking write in this handler.
- Previously completed live HTTP checks: unauthenticated webhook GET returns
  403, unsigned POST returns 401, unauthenticated knowledge POST returns 401.
  These are boot/authentication tests, not a signed end-to-end test.

## Acceptance gaps

| Capability | Finding |
| --- | --- |
| Send specialty/doctor/day/time lists | Missing. The only send payload is text. |
| Interpret interactive selection IDs | Missing. The handler passes the display title to the LLM and discards the row/button ID. |
| Preserve booking selections and validate old buttons | Missing. Six conversation rows are not durable booking state. |
| Live doctor schedule and available slots | Missing from this handler. Clinic opening hours cannot substitute for either. |
| Validate selected doctor/day/time before booking | No booking backend call exists here. |
| Create, change or cancel a booking | Missing. This handler only accesses social_messages. booking-sync-ingest is a separate ingest endpoint and does not make this a booking writer. |
| Confirm a recorded request | No request persistence is performed by this handler. Text saying “طلب الحجز” is not proof of request creation. |
| Human handoff | Emergency/complaint flags are written to the dashboard. No proactive staff delivery/acknowledgment is implemented. |
| OpenAI quota failure | Marks inbound failed and sends no reply. Confirmed with a simulated provider error. |
| End-to-end model quality across all questions | Not established. Provider calls were mocked in automated tests. |

## Missing source needed for restoration

An archived September log identifies the old agent directory on the owner's Mac:

`/Users/m.ibrahim/Work Archives/SwnW Specialized Clinics Medical Center 2/ChatGPT/AI-Customer-Agent`

An older test log references `tests/test_agents_sdk_engine.py` and interactive
doctor/day/time transitions. These logs are evidence of the old project, not a
recoverable current code checkout. Neither accessible GitHub repository contains
that project. The available Supabase functions include only the text webhook,
clinic knowledge, patient lookup, booking ingest and outbound booking queue, not
the old conversation engine. No current deployment URL for it was found.

Do not recreate schedules from historical logs or website lists, and do not
reactivate an expired tunnel URL. Obtain the current old-agent source and its
non-secret deployment configuration. Exclude .env, keychain exports, credentials,
patient databases, logs with personal data, virtual environments and caches.

Then restore the actual interactive booking controller, feed repaired knowledge
into it, and replay doctor/date/time/restart/change/confirm/duplicate scenarios
with mocked booking writes before enabling the test-number route. The owner's
real number and existing credentials must remain unchanged.

No runtime changes, database writes or WhatsApp sends were made during this audit.
