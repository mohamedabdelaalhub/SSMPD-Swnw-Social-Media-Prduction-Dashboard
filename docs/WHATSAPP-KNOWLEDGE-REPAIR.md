# WhatsApp knowledge repair — 18 October 2026

## Evidence and scope

Repository inspected at `77a47cfc4b36410ac35b6ca8634de492fe0c80c1`.
The deployed `whatsapp-webhook` version 16 was read separately. It imports a copied
`ai.ts`, and contains public debug routes absent from the repository. A repository
merge is therefore not proof of a deployed repair. Do not replace the deployment
until the owner reviews the customer-facing behavior below.

Read-only database checks found an address, maps URL, phone, payment methods,
home-visit statement and agent notes in `clinic_profile`. FAQs and active offers
were empty. The test conversation included a refusal to confirm neurology and a
promise to send a location without a link. No messages were sent during this work.

The current website document contains four doctor records, including neurology
and dentistry. Its `specialty` and `service` arrays are empty. Doctor departments
are in `metadata.department`, and ranks in `metadata.rank`. The old parser ignored
both. An empty array cannot establish that a specialty does not exist.

## Changes

- Parse public doctor fields from the actual website format, with compatibility
  for legacy fields. Derive specialties from doctor departments. Do not expose
  freeform metadata, images or unpublished internal fields.
- Retain the current website URL. Do not introduce a second catalog or resurrect
  the old Markdown/Excel data as live availability.
- Remove arbitrary 3,000/6,000-character cuts. Oversized sources fail explicitly
  rather than silently omitting late doctors or management notes.
- Preserve the five-minute dashboard and thirty-minute website caches per warm
  instance. Share simultaneous refreshes, back off thirty seconds after errors,
  and retain the last successful data for at most one hour. This is not a durable
  distributed cache and does not promise an egress reduction percentage.
- Query selected clinic columns instead of entire rows. Failed database reads
  return 503 rather than a successful incomplete knowledge response.
- Separate WhatsApp prompt rules from existing social comment/message rules.
  Prefer dashboard contact facts, send the supplied map link directly when asked,
  and distinguish unknown information from an unavailable service. No claim of
  booking, alert or staff handoff without an implemented operation.
- Allow prices/offers only when explicitly supplied for the requested service in
  current knowledge. This needs owner review. No prices are being invented or
  imported from old documents.
- Keep six history rows. Filter by platform and brand, and exclude unsent replies
  from assistant history. No new history table or patient lookup.

No database writes, migrations, new secrets, model changes, real-number activation,
additional provider, scheduled task, automated booking or patient-data access.
No automatic learning from customer messages. Durable booking state, catalog
search tools and an actual handoff/fallback workflow remain future work.

## Review examples

These are intended behavior examples, not captured LLM outputs.

| Test message | Intended response |
|---|---|
| عندكو مخ وأعصاب؟ | أيوه، د. دينا حسني موجودة في عيادة المخ والأعصاب. تحب تطلب حجز معاها؟ |
| عندكو أسنان؟ | أيوه، د. أحمد الرشيدي أخصائي أسنان. تحب تطلب حجز معاه؟ |
| ممكن اللوكيشن؟ | عنواننا 45ع شارع الخزان، حدائق الأهرام، الجيزة، أمام خزان المياه. اللوكيشن https://maps.app.goo.gl/byGEaezKysTKhLoW9 |
| ابعت، بعد طلب اللوكيشن | ده لوكيشن المركز https://maps.app.goo.gl/byGEaezKysTKhLoW9 |
| بكام كشف دينا؟، بدون سعر معتمد | سعر الكشف مش موجود عندي حاليًا، ويحتاج تأكيدًا من الاستقبال. |
| عندكو تخصص مش مذكور؟ | مش قادر أتأكد من التخصص ده من البيانات المتاحة عندي حاليًا. |
| دينا حسني ثم الأحد ثم نكمل | يستكمل طلب الحجز من المعلومات المذكورة دون اختراع ساعة أو تأكيد حجز. |

## Validation and activation

`node tests/whatsapp-knowledge.cjs` exercises actual parser, caches, prompt
selection, clinic handler and webhook with mocked database/LLM/Meta. It tests
metadata, partial/invalid/oversized data, concurrent refresh, expiry/backoff,
authentication, source errors, uncut management notes, history isolation and
allowlist containment. It cannot establish real model response quality or delivery.

`node test/smoke.js` passed its assertions with the pre-existing
`requestAnimationFrame` simulation warning. No UI files changed.

After owner review: deploy the repository files and their imports together,
preserve current secrets/allowlist/autoreply/brand mapping, keep the real number
disconnected, and run the review messages from the owner's allowed WhatsApp
number. Inspect received replies and delivery status before describing end-to-end
testing as passed. The deployed debug routes are not part of the repository
entrypoint. Do not copy them back into the new deployment.
