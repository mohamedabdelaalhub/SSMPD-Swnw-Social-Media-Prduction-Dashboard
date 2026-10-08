# Website publishing and patient portal integration

## Activation (project owner)
1. Run `supabase/migrations/20261008_website_publications.sql` in the correct dashboard Supabase SQL Editor. This adds independent publication/attempt tables and an update trigger; it does not remove existing content or social publishing.
2. Set Edge Function secrets `WEBSITE_CONTENT_ENDPOINT` to `https://studio.swnwclinics.com/api/integrations/content` and `WEBSITE_WEBHOOK_SECRET` to the privately agreed website secret. Never put the secret in config.js or a browser request to the website.
3. Deploy `supabase functions deploy website-publish-process` using the checked-in config (platform JWT verification off; the function validates staff JWTs or the cron bearer itself).
4. Create Supabase Vault secrets named `website_publish_worker_url` (your project's function URL) and `website_publish_worker_secret` (same private webhook secret). Run `supabase/website-publish-cron.sql`. The minute job is required for unattended retries/edits. Restrict access to Vault and cron definitions to project administrators.
5. After activation, confirm a designated test material on the dashboard, verify it on the public site, update it, then withdraw it. No live website publishing was performed by the automated tests.

## Behavior
The Publish tab has an independent Website section: confirm immediate publication, send current version/retry, withdraw, and view the last 20 attempts. A preview precedes confirmation. The website platform is saved before enqueueing. Social publication and schedules retain their original flow. Website scheduling is intentionally unavailable; the Website endpoint publishes immediately.

`website_publications.website_publish_status` is independent of content stage and social status. Only approved stages can be sent; initial publication requires `ready_to_publish`. Updates to the approved title/body/caption/image/original URL/platforms enqueue the newest snapshot. Removing website or moving back into revision withdraws it. Editing an already published material can publish immediately through the worker: review changes before saving. Existing private images are downloaded server-side from `content-designs`; legacy external/Drive images must be re-uploaded there. JPG/PNG/WebP bytes are checked, maximum 5 MiB and entire request 8 MiB. No storage URLs or credentials are sent to the public site.

One queue row per content ID, stable snapshots, row locks, exclusive claims and revision/token fencing prevent simultaneous workers or an older result replacing a newer desired state. Upserts always reuse `content_items.id`. There can be repeated network delivery after timeout; the receiving endpoint's ID upsert makes this idempotent. Transient errors retry with backoff, up to five attempts per revision. 400/401 and invalid image data fail visibly; an explicit retry is available. New edits/withdrawals wait for the in-flight request, then take precedence. A ten-minute lease recovers an interrupted worker. Attempts retain sanitized HTTP/outcome codes, not response bodies or secrets.

A successful `status: published` is shown as published. A successful `pendingReview: true` without published status is shown as website review. A response with neither confirmation is a failure. Confirm the production endpoint contract if it differs. No endpoint to poll later pending approval was supplied.

## Portal
`patient-portal/?view=login`, `?view=activate`, `?view=reset` select existing screens. `reset=1` and the Auth PASSWORD_RECOVERY event preserve the original recovery flow. `returnUrl` accepts only absolute HTTPS URLs with origins `https://swnwclinics.com` or `https://staging.swnwclinics.com`, no credentials, alternate ports or protocol-relative URLs. After successful login/activation (or an existing session), redirect to the validated destination. No token or medical data is appended. Account verification, patient file authorization, and session storage remain unchanged.

`portal.swnwclinics.com` is not configured: decide where to host it and configure DNS, TLS and Supabase allowed redirect URLs first. Adding a CNAME to this GitHub Pages repository affects the whole dashboard, so do not do that as an incidental portal change.

## Focused tests
`node test/website-integration.mjs` uses Node built-ins, mocked delivery, and tests routes, allowlist, payload/image limits and response states.
`node test/website-queue.mjs` requires `@electric-sql/pglite` and tests SQL migration repeatability, authorization, enqueue deduplication, exclusive claims, edits during delivery, backoff and withdrawal.
`node test/portal-routes.mjs` requires `jsdom` and renders the real portal app with mocked Supabase login. No real user/session or medical data is used.

`node test/website-ui.mjs` requires `jsdom` and verifies Website controls, escaping, attempt history and worker calls with mocks.
