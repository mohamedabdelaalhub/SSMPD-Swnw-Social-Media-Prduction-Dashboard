# Contract website lifecycle
Doctor contracts: use الصورة والنشر in finance contracts. Entity files: use اللوجو والنشر التلقائي. Configure public facts, original site card match and photo/logo once. Website eligibility and one-time welcome announcements have independent switches; existing contracts are not bulk enabled.
The private schema evaluates source status and Cairo start/end dates, including multiple contracts. Every60seconds the managed Windows worker sends only public facts and eligibility to Studio. Expired/suspended contracts hide cards; reactivation restores eligibility while explicit manual hiding remains respected. Historical bookings and financial terms are not rewritten. Pending welcome jobs are cancelled when eligibility ends; already-published posts are retained.
Worker calls use timestamped Ed25519 signatures with a five-minute limit. Only the public verification key is deployed to edge functions. Signing seed remains in protected Windows integration.json; CMS-local webhook uses its existing bearer secret. Never place the config or any service key inside the repository. Key rotation requires updating the public verifier.
Supabase migrations contract_marketing_lifecycle and contract_sync_heartbeat are active. Edge functions contract-marketing and content-ai are deployed. Worker runs under LOCAL SERVICE with restart-at-startup. Runtime heartbeat records successful snapshot checks. Current runtime checkout is App_Data/contract-dashboard-work on the website server; preserve it while service uses it.
Doctor welcome uses the existing approved doctor template, explicit public hours/facts and selected Meta platforms; generation is deduplicated and schedules at least5minutes ahead with the existing2hour spacing. Entity announcements stay waiting_template until the owner supplies the entity design; entity website logos still synchronize.
Validation: lifecycle SQL scenarios; real-project transactional check; settings UI tests; actual-font renderer; authenticated Studio create/publish/soft-hide/restore; live Windows-to-Supabase heartbeat; no real welcome post or existing contract was enabled during tests. Full dashboard CI has pre-existing failures: role helper and guide errors reproduced on unchanged main. Added field explanations leave the192 pre-existing uncovered fields unchanged.
Rollback: stop SWNW Contract Marketing and revert frontend controls; retain private profile/job history and financial contracts. Do not remove the signing config or relax its ACLs.

## Rendering on the dashboard server (owner request 2026-11-15)
The worker has a mode, `SWNW_CONTRACT_MODE`:
- `all` (default): what the Windows website worker always did, i.e. sync the website cards and render welcome posts.
- `jobs`: render welcome posts only. Use this on the dashboard server (Linux, Node + `@napi-rs/canvas`, repo checkout for the templates and fonts).
- `sync`: website cards only. The Windows worker can switch to this once the server renders; it must keep running, because the cards live on the website server (`127.0.0.1:8787`).

Job leases are exclusive, so two workers never render the same job.

Each worker has its own secret in its own protected config (`SWNW_CONTRACT_CONFIG`, never in git). Get the server worker's public key with `node scripts/contract-marketing-worker.mjs --print-public-key` and put it in the edge-function env `CONTRACT_MARKETING_WORKER_PUBKEYS` (comma-separated). Both `contract-marketing` and `content-ai` read it. The Windows key stays built in.
