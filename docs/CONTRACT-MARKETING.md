# Contract marketing

Open الصورة والنشر on a doctor contract or اللوجو والنشر التلقائي on an entity file. Website visibility and announcement opt-in are independent. No existing contracts are bulk enabled. Public facts and photo/logo are stored in a private bucket; financial terms and attachments are never copied.

## Deployment

- Apply supabase/activation/contract_marketing.sql to project uuijfbpgvtdxgaosqpxo. Tested with PGlite and dry-run on the actual project inside a transaction ending in ROLLBACK.
- Deploy contract-marketing and the changed content-ai function, using config.toml. Both retain explicit authentication. The worker reuses the existing WEBSITE_WEBHOOK_SECRET.
- Deploy cms/contract-sync.mjs plus /api/integrations/contracts in cms/server.mjs on the website, and the insurer removed-marker filter. Restart the existing Studio service after deployment.
- Run scripts/contract-marketing-worker.mjs continuously on the website host with Node 24+ and the repository's locked dependencies. SWNW_CONTRACT_CONFIG must point outside the web root to private JSON with enabled=true and secret matching the existing website integration. Never put this secret in config.js, logs or the repository. A dedicated managed task should restart this worker on exit.
- Merge/deploy frontend files. Configure public facts and picture on a designated contract. Only opt into automatic announcements when automatic public publication is intended. One announcement is created per profile, at least five minutes ahead, respecting a two-hour gap from existing Sono Meta jobs. This is an earliest-free operational slot, not a prediction of engagement.

## Lifecycle

Eligibility uses source contracts and Cairo date, with future starts, expiry and multiple contracts supported. Profile suspension/end controls website/marketing without rewriting historical financial terms. Pending jobs are cancelled when eligibility ends. Already published posts are retained; requests already in delivery to Meta cannot be recalled. A cancelled already-created welcome post is not duplicated after reactivation. For requests without a created content item, explicitly saving settings requeues them. An uncertain paid AI result is not silently regenerated; review and save settings to authorize another attempt.

## Entity template handoff

Entity jobs wait in waiting_template before paid generation. Add the supplied entity template to scripts/contract-template-renderer.mjs alongside the original doctor template. Available public facts: source name, logo, announcement description and optional website. Do not infer private discounts or terms. Save the waiting entity settings after adding the template to requeue it.

## Verification

Focused tests: test/contract-marketing-sql.cjs, test/contract-marketing-ui.cjs, test/contract-marketing-renderer.mjs; website: cms/test/contract-sync.test.mjs and isolated CMS suite. Also verified existing smoke, contract edit/delete/categories, doctor-finance and website queue tests. Existing smoke emits mocked-resource and requestAnimationFrame warnings. Preview uses synthetic data; no paid generation or real public welcome post was made.

Rollback: disable the dedicated worker and profile automation, retain queue records. Core contracts, financial approvals and historical accruals were not rewritten.
