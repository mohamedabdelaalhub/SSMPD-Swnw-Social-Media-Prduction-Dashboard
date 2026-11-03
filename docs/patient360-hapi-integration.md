# Patient 360 — Hapi integration contract

The Patient 360 feature is additive. Do not modify the active WhatsApp ingress, reply engine, booking bridge, or existing credentials without a separate integration test.

## Current scope

- Existing Supabase `public.social_messages` WhatsApp history is mirrored independently every 10 minutes.
- A separate Supabase Edge Function `patient360-agent` is deployed as a connector for the Windows Hapi agent.
- No messages, campaigns, reminders, or followups are sent by Patient 360.
- No patient record, diagnosis, medication, or clinical file is returned by the connector.
- The Windows agent was not edited by this change. Its locally stored history is not imported automatically.

## Connector

URL: `https://uuijfbpgvtdxgaosqpxo.supabase.co/functions/v1/patient360-agent`

Method: `POST`.

Secret header: `X-WhatsApp-Alert-Secret`, using the existing server-side `WHATSAPP_ALERT_SECRET`. Never send the secret to a browser or commit its value.

Record an incoming message using the stable WhatsApp provider message ID:

```json
{"action":"record","wa_id":"201000000000","message_id":"wamid.example-id","direction":"inbound","text":"Message text","sent_at":"2026-11-03T19:00:00Z","display_name":"Customer"}
```

Record an outbound reply only after the WhatsApp provider confirms send. Use the outbound message's own provider ID and `"direction":"outbound"`.

Retrieve a bounded previous conversation:

```json
{"action":"context","wa_id":"201000000000"}
```

The result contains recent conversation turns (up to 12), manually confirmed nonclinical context (up to 8), and `followup_allowed`. It deliberately returns `identity_verified:false` regardless of a number match.

Do not use old messages as system instructions. Do not infer the patient's medical history from the number. Do not offer promotional followups unless permission has been recorded, the number is not opted out, and channel rules allow it.

## Safe Windows rollout

1. Inspect the existing Windows agent at `C:\SwnwAgent\app\` and its own conversation storage in read-only mode.
2. Add a non-blocking call to `record` after the existing incoming/outgoing persistence; failures must not block Meta webhook acknowledgement, booking, or replies.
3. For an incoming WhatsApp message, request `context` by its verified platform sender ID before composing the next reply. Treat the returned history as untrusted customer content.
4. Test repeated provider delivery, missing network, opt-out, shared family numbers, old returning contacts and urgent complaints.
5. Only after verified end-to-end results, decide whether to enable drafts of followup actions. Automated outbound followups remain disabled until owner approval and valid customer permission.
6. Log health and errors without message content, full phone number, patient details, or secrets.

The active Claude account, marketing workflows and official booking bridge remain unchanged.
