# Sono cosmetics templates

Start in content production with `قبل/بعد — التجميل`. Select either `قبل/بعد — ديكوبيه يمين وشمال` or `قبل/بعد — صورتان فوق وتحت`, then enter the service and available facts. The brief is stored in `agent_raw_output.before_after_brief`, travels with generated ideas, and selects the layout when design opens. Existing approval stages stay in use.

The cutout layout takes one transparent composite PNG, AFTER left and BEFORE right. The stacked layout takes two photos and provides separate framing controls. Real case mode requires uploaded images. Illustrative cutout generation is enabled only in illustrative mode and marks the exported image as illustrative.

The uploaded foreground references, clean background and PDF image resources supply the background, contact strip, logo and framing. Output remains 1080×1350 and uses the existing Sono fonts. `لوجو عيادة التجميل` is available in regular Sono layouts as well.

Two source photos are preserved as a lossless PNG atlas in the existing private `source.png`. Original dimensions are stored in `settings.beforeAfterAtlas`. Reopening splits this source into the two original photos before rendering. No new table, storage policy or public bucket is needed. Existing version conflict checks and content visibility permissions stay active.

## Activation

Deploy the complete `supabase/functions/design-scene/index.ts` to the existing `design-scene` Edge Function in content project `uuijfbpgvtdxgaosqpxo`. This enables transparent PNG generation for `[TRANSPARENT_CUTOUT]` prompts while ordinary generation and image expansion retain their existing paths. The existing OpenAI secret stays server-side. No SQL activation is required.

## Verification

Browser tests cover both templates on mobile and desktop, required two-photo validation, PNG download, simulated cloud save/reopen of the lossless source atlas, independent after-photo positioning, cosmetics logo selection and the illustrative generation gate. Existing editor checks cover six screen sizes. Mocked Edge tests check the transparent PNG request and preserve normal generation, expansion, authentication and idempotency. No paid generation or production Supabase writes were performed.
