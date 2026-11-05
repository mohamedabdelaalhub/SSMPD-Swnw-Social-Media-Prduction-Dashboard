# Inbox refresh load reduction — draft only

Owner authorized a separate branch and tests only on 2026-11-05. Base: dashboard main 5ebb44b46acaefe5aad2ce87e95e29dee611d5f4. No merge, deployment, DB change, credential change or real-data browser operation performed. Other dashboard development remains independent.

## Behavior

- Background inbox refresh triggers share a trailing promise and coalesce to one request per 15 seconds per browser/account. Existing in-flight requests remain shared.
- Hidden tabs skip background inbox calls. Hiding cancels/settles queued work; showing catches up subject to the same cooldown. The trailing callback rechecks visibility/account/generation.
- Mount, bell opening and read-marking explicitly refresh immediately (sharing an existing flight). stop/account remount clear timers/listeners; late old-account responses cannot replace new-account state.
- The existing 45-second visible fallback and unrelated app RPC/Realtime subscriptions remain unchanged. This is not whole-app hidden-tab gating, a shared server cache or a database rewrite. Visible bursts may show a new notice up to 15 seconds later plus RPC latency.
- Only personal-home.js runtime logic and its index.html cache token change. Supabase client APIs, permissions, RLS and data semantics are unchanged.

## Actual tests

Node v24.15.0 was used in an isolated /tmp npm cache to satisfy existing jsdom 30's engine requirement; system Node and server packages were not upgraded. npm ci used the existing lockfile and ignored lifecycle scripts.

- 14 deterministic fake-clock/DOM/RPC tests pass: cooldown/coalescing, shared promises, hidden/catch-up, hidden queued work, stop, account remount, stale responses, single-flight, forced refresh, bell, read-marking, event objects, retry and visible fallback.
- Same synthetic 20-event burst over 30 seconds against unmodified source vs candidate: 21 -> 3 fake inbox calls, including mount and trailing work. Zero network/production requests. This is NOT a measured production saving or CPU/IO reduction.
- Chrome test at 1280/390/360 widths passes roles, navigation, notification/sound dedupe, task/inventory links, drafts/tab/scroll preservation, account switching and missing-activation fallback, all with mocked RPC/audio.
- Existing update-notice-home-integration, home-summary-cards and home-settings-dom tests pass. JSDOM integration is explicitly visual; synthetic immediate notice injections use the explicit refresh flag. Browser fixture now opens sound settings through the current settings dialog; the unmodified baseline fixture timed out on the old sound selector too.
- JavaScript syntax check passes; cache token bumped only for personal-home.js.
- Known pre-existing failure: test/smoke.js fails on the unmodified base AND candidate at line 167, querying the missing `#user-dropdown [data-goto="summary"]`. It fails before notification assertions. It was not weakened or rewritten to hide the failure. This legacy smoke failure remains a review item; no claim all repository tests pass.

Commands executed: node tests/personal-home-refresh-load.cjs; node --check assets/js/personal-home.js; node test/smoke.js (candidate/base); node tests/update-notice-home-integration.cjs; node tests/home-summary-cards.cjs; node tests/home-settings-dom.cjs; PLAYWRIGHT_CHANNEL=chrome node tests/personal-home-ui.cjs (candidate and original fixture baseline).

## Measurement and release gates

Read-only live aggregate baseline in the infra repo: personal_home_inbox matched mean ~854 ms and ~36.7% of observed filtered cumulative top-level execution time. These are query-pattern counters, not CPU, physical IO or billing. Source and caveats: https://github.com/mohamedabdelaalhub/swnw-infra/blob/main/proposals/supabase-offload/MEASURED-BASELINE-20261105.md . No optimization has reached production, so no live saving claimed.

Before any merge/deploy: independent review with the active dashboard workstream, resolve/triage legacy smoke coverage, approved test identity/data scope for authenticated notification freshness checks, and separate owner release approval. Then compare equivalent business windows with stats reset/entry-retention and real client-activity context. Do not reset production statistics or run EXPLAIN ANALYZE.

Rollback after a separately approved rollout: reviewed revert of this commit/cache token and verify notice delivery; no DB rollback needed. Staging updater follows main only, so this draft branch is not picked up by the Contabo daily timer or Update Now. No PR opened here, avoiding triggering the repo's pull_request Actions under the zero-additional-cost rule.
