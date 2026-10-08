# Final post preview and independent website publication

The review dialog, publish cards, archive details and confirmation dialog display the saved design with the final caption and saved CTA. Legacy items without a caption fall back to body/title and explicitly identify that fallback. No contact information is fabricated. Private design images use signed URLs; Drive files use the existing permissions through an inline viewer.

Website publishing now accepts approved ready, scheduled and previously published items. It preserves social platforms and the content stage and requires no previously published URL. Select “المواد القديمة المنشورة” in the website section, or use “نشر على الموقع” in archive details. Website status remains independent from social status.

## Backend activation

1. In the content dashboard Supabase project, run `supabase/migrations/20261008_publication_preview_and_legacy_website.sql`. It includes the previous queue setup and can be run again safely. Do not run it in another dashboard project.
2. Redeploy `meta-publish-process` from this complete repository. It imports `assets/js/publication-text.js` to use the same caption/CTA contract as the preview and can download private content-designs images server-side.
3. If the website integration has not yet been activated, also deploy the existing `website-publish-process`, configure `WEBSITE_CONTENT_ENDPOINT` and `WEBSITE_WEBHOOK_SECRET` server-side, and enable its existing queue schedule. See the existing website integration guide. Never put secrets in browser configuration.
4. Confirm one approved item against the real website and one social test post after deployment. Local tests do not establish that these external services are configured.

## Focused verification performed

JavaScript syntax checks and Edge Function bundling passed. DOM tests covered final caption/CTA selection, HTML escaping, signed URL reuse, invalid URL rejection, Drive preview and website permission checks. PostgreSQL-compatible tests covered repeatable migration, first-time website publication of an archived item without an original URL, stage preservation, queue deduplication, CTA updates and withdrawal when approval is removed. External publishing and real device rendering were not exercised.
