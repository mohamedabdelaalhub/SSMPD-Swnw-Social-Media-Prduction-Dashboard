# WhatsApp template requests: contract for the swnw WhatsApp agent

The dashboard (owner only) queues template requests; the agent, which holds the WhatsApp token, submits them to Meta.
No new secret, no inbound port. Same endpoint and shared secret as the outbox: edge function `whatsapp-sync`
(`X-WhatsApp-Alert-Secret`). Migration: `20261124230000_whatsapp_template_requests.sql`.

## Calls (all POST JSON to whatsapp-sync)
1. `{"action":"template_lease","limit":5}` → `{"ok":true,"requests":[{"id","name","language","category","text"}]}`
   Poll like the outbox lease (every ~30 s is enough). A lease older than 2 minutes returns to the queue (3 tries).
2. For each request: `POST https://graph.facebook.com/v26.0/{WABA_ID}/message_templates` with
   `{"name": name, "language": language, "category": category, "components":[{"type":"BODY","text": text}]}`
   (no variables, no header/footer/buttons in v1; `category` is UTILITY or MARKETING).
3. `{"action":"template_ack","id":"<request id>","status":"PENDING","meta_id":"<id from Meta>"}`
   or `{"action":"template_ack","id":"...","status":"FAILED","error":"<Meta's error message, Arabic or English, ≤300 chars>"}`.
   (`APPROVED` / `REJECTED` are also accepted if Meta answers synchronously.) Ack once; a second ack is refused.
4. Status refresh (same cadence as the approved-template refresh): read `GET /{WABA_ID}/message_templates?fields=name,language,status,rejected_reason&limit=200`
   and send `{"action":"template_sync","statuses":[{"name","language","status","reason"}]}`.
   Meta statuses APPROVED / PENDING / IN_APPEAL / REJECTED / PAUSED / DISABLED are mapped; unknown names are ignored, so it is safe to send all templates.
   APPROVED rows are inserted into the picker table at once; REJECTED/PAUSED/DISABLED are removed from it and the reason is shown in the dashboard.
5. The existing `{"action":"templates","templates":[...]}` refresh keeps feeding the conversation picker: send APPROVED templates only.

## Safety
- The dashboard checks owner role, text length ≤ 1024, no `{{ }}`, no 8+ digit numbers, duplicate body, 10 requests/hour.
- Each submission is audited in `ops_private.whatsapp_template_audit` (who, what, when, Meta result).
- Nothing is submitted to Meta until the owner uses «+ قالب جديد» or approves the drafts.
