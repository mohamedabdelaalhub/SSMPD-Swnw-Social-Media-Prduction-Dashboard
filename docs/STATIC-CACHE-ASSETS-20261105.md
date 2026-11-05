# Static asset cache draft — opt-in packaging, not deployed

Owner approved branch/local tests only on 2026-11-05. Based on notification staging draft 78fabfd3a1c9d0d58c0a2238cae6a8d4f3649311. Existing Contabo runtime stays unchanged. This script is not connected to npm test/build, GitHub Pages, the production pipeline or the server updater.

## Implementation

Run `node scripts/build-cache-assets.cjs RUNTIME_SOURCE NEW_OUTPUT [PREVIOUS_OUTPUT]` against a separately prepared static runtime artifact, NOT a source checkout containing node_modules. Source/output must be separate; output must not exist. Symlinks are refused. Failed packaging may leave partial output: discard that NEW_OUTPUT; never deploy it. Generate the ordinary release manifest only after packaging succeeds and is reviewed.

For the local JS/CSS references in index.html, emit byte-identical copies with full SHA256 in the filename, in the SAME directory. Rewrite just those URLs in the output index; retain original filenames for dynamic loaders. Original script order/content stays unchanged. document.currentScript-relative templates keep their directory. config.js, HTML, external dependencies and dynamically loaded original URLs remain outside immutable caching. No bundling, minification, lazy loading, service worker, user-data cache or Supabase API change.

CACHE-ASSETS.json maps original/versioned/hash. Optional PREVIOUS_OUTPUT retains verified hashed assets from one prior release so an older open page can complete loading during replacement; filename/hash mismatches, corruption, symlinks and unsafe paths are refused. Older-than-previous pages may get a 404 for evicted immutable files; long-lived tab/dynamic loader compatibility and full release retention must be reviewed before deployment. Originals and dynamic loaders still use existing cache policy.

## Required hosting change — prepared guidance ONLY

Only paths matching `/assets/...<64 lowercase hex>.js` or `.css` may get `Cache-Control: public,max-age=31536000,immutable`. Ordinary JS/CSS, index.html and config.js must retain revalidation. Place the narrowly matched regex BEFORE the existing generic JS/CSS regex; preserve existing security headers. Example nginx location (not installed/tested in real nginx):

```nginx
location ~ "^/assets/.+\.[a-f0-9]{64}\.(js|css)$" {
  add_header Cache-Control "public,max-age=31536000,immutable" always;
  add_header X-Robots-Tag "noindex, nofollow" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  try_files $uri =404;
}
```

Do not serve different bytes under an old hashed filename. Keep index revalidation and the prior hashed assets, verify both releases, and regenerate/hash-check the complete deployment manifest. Existing updater build/compat logic will require separate reviewed integration (larger manifest expected); this draft alone does NOT enable production caching. No permission to install/change nginx was inferred from local-test approval.

## Actual validation

`node tests/cache-assets.cjs` PASS with existing Playwright/Chrome. Synthetic local fixture:30 JS+1 CSS,60ms artificial server delay per request, fresh context per baseline/candidate. Script order, currentScript-relative directory, rendered CSS, config exclusion/source preservation, existing-output/separate-directory refusal, old-release retention and corrupt/symlink rejection checked.

One latest-run result is in the infra handoff/evidence. Initial run baseline cold511ms/warm466ms versus candidate cold458ms/warm133ms; warm static requests31 ->0. This is a synthetic one-pair comparison, NOT a production speedup or first-load improvement. Timing varies; zero repeat static requests is the tested behavior. Config/index still request network.

Selected real dashboard runtime index/assets from78fabfd packaged locally:180 versioned references. Existing repaired smoke test passed against generated index and hashed scripts, with fake config/client and no authenticated calls. This checks mocked application bootstrap/navigation/notification/content assertions. Full repository suite, real nginx syntax/runtime, complete deployment artifact, real login, live Supabase and real Contabo warm-cache timing are NOT verified. The selected local runtime intentionally did not contain real config.js; fake configuration was injected by smoke. A deployable artifact must include unchanged reviewed real config and all files.

Rollback after separately approved rollout: restore retained prior release/index/assets. No database rollback. Before any deployment: review packaging failure paths/retention, integrate exact infrastructure branch, test nginx headers/missing paths, re-run full served-file verifier and authenticated workflows under approved identity scope. First-load performance remains a separate problem (many scripts/dynamic dependencies); no first-load optimization claimed here.
