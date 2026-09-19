# Sono fixed-overlay design pilot

This is a prepared pilot, not a verified production deployment.

## Deployment order

1. Run `supabase/migrations/20260920_sono_design_pilot.sql` after the existing content-AI/design-jobs migration.
2. Deploy `supabase/functions/design-scene/index.ts` as `design-scene`. Use the existing server-side `OPENAI_API_KEY`. As with content-ai, disable legacy gateway JWT verification only because the function authenticates the bearer session through `my_admin_id` and authorizes generation through the RPC.
3. Deploy frontend files together. The studio is available for Sono non-video content to its creator, assigned designer, and content managers. Published/scheduled/ready-to-publish records must return through the existing revision workflow first.
4. Test on three pilot content items. Choose a saved/uploaded scene first. Generate one Medium image per item only if needed.

The fixed PNG is the uploaded original, unchanged. Export is 1080×1350. Arabic and Latin use the same local font files as videos. The scene, text and overlay remain separate. Canvas composition is currently local in the employee browser, with no new worker dependency. It has not yet been moved to the Mac background worker.

## Implemented

- Upload a scene, browse generated Sono scenes, or request one image from OpenAI.
- Local text/crop edits and PNG export without another OpenAI request.
- Overflow rejection instead of silent text truncation.
- Original generated image in private Supabase Storage. Uploaded originals archived through the existing Drive bridge when saving.
- New output file and version metadata on every save. Existing approval stages are not advanced automatically.
- Three lifetime generation attempts per content item and a conservative $5 monthly reservation cap across the queue. Medium reserves $0.10, High $0.30; these are accounting guardrails, not exact invoiced costs. Failed and uncertain requests keep their reservation.
- Database lock and request UUID prevent repeated paid submission after double-click, reload or concurrent tabs. An unresolved in-flight request is not automatically reissued. Explicit new attempts after a confirmed failure count toward the cap.
- Model, quality, prompt, attempt, reservation and returned provider usage recorded.

## Pilot model and cost

Uses gpt-image-1.5 at 1536×1024, one output. Official model pricing checked during implementation lists Medium $0.05 and High $0.20 for this size, plus applicable input usage. Verify availability in the project's account at deployment. See https://developers.openai.com/api/docs/models/gpt-image-1.5 . No paid generation was run during implementation.

## Validation and remaining checks

Native canvas test verifies three Arabic headings, output dimensions, text-overflow rejection and exact footer pixels after scaling. It loads the actual WOFF2 fonts. JavaScript syntax checks pass.

The legacy smoke test fails on its old Supabase mock (`client.rpc is not a function`) both before and after the changes. Headless browser download timed out, so browser/mobile rendering is not claimed as tested. The Playwright test is included for a machine with Chromium installed.

Still required before production approval: execute the migration, deploy Edge function, verify account access to the image model, test signed-image CORS in the browser, run all three paid pilot examples, review visual quality and reconcile actual usage with billing. A server crash after OpenAI accepts a request may leave the job in generating_scene; review that job instead of resubmitting blindly. Version metadata retains text/crop settings, but this first editor does not yet offer reopening an old version's settings automatically. The image prompt starts from the content title and is editable; a separate strategic scene-description agent is not included in this pilot.
