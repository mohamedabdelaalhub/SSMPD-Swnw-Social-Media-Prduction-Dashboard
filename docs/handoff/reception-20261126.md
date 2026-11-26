# Handoff — Reception chat (2026-11-26)

Outgoing session: `session_01UqVZHa1WNN8bEGUYBvTA8M`. Written at about 00:58Z on the hub's order for a chat rotation.

## Contents
1. [Scope](#1-scope)
2. [Rules followed](#2-rules-followed)
3. [Open PRs](#3-open-prs)
4. [Allocations held](#4-allocations-held)
5. [Owner decisions, last 3 days](#5-owner-decisions-last-3-days)
6. [Pending owner questions](#6-pending-owner-questions)
7. [Live facts and ids](#7-live-facts-and-ids)
8. [Traps and lessons](#8-traps-and-lessons)
9. [Next steps, in order](#9-next-steps-in-order)

---

## 1. Scope
This chat owns everything in reception (`clinic_reception` schema):
- booking, walk-in, reschedule, arrival, execute, collect;
- the today board, auto-book, providers and scopes, payer kinds;
- supplies at the service (PR1/PR2 merged; PR3 not started);
- home visits.

It also writes the ops SQL and the rolled-back live scripts that the hub runs.

Outside this scope:
- finance internals (finance chat);
- price lists and contracts (price-contracts chat);
- inventory (inventory chat);
- claims printing, i.e. Part B of entity names (price-contracts chat).

## 2. Rules followed
- **Talking to the owner:**
  - Egyptian Arabic only, with English digits only. Code, commits, PRs and messages between chats stay in English.
  - Never give the owner Terminal commands.
- **Approval and deploys:**
  - The owner is the only approver.
  - Nothing is merged, applied or released without the owner typing «انشر N» in the main chat (hub, Main 5, `session_01UqVZHZzCVF6etDBvPkF2nc`).
  - The hub merges, releases, applies migrations and ops, allocates migration and help numbers, and runs the live rolled-back dry-runs. Live reads from this chat are blocked, so the hub runs every live query.
  - Supabase MCP only for ops_mailbox statements.
- **Models:** a fresh chat keeps the same model and rules (docs/handoff/15-chat-models.md, quota rule, per the hub).
- **What goes in git:** no secrets and no patient data; sample data only. Edit config.js one line at a time.
- **Every change:**
  - Bump `?v=` on every changed JS/CSS.
  - Help rule 6: update `assets/js/dashboard-help-data.js`, bump the data version and the token in `dashboard-help.js` and `index.html`, then run `python3 scripts/build-dashboard-help.py` and `--check`.
- **Rule 9:** every new or changed button is clicked in a DOM or Playwright test as the real role in LIVE mode. Its RPC is proven by the hub's live dry-run. The PR body carries a button/role/RPC table. A button the server would refuse for a role must not appear for that role.
- **Live scripts:**
  - One transaction: the guard do-block BEFORE `begin;`, then `begin; savepoint <x>_guard;`, ending in ROLLBACK.
  - Act as Mazen (auth sub `f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb`) via `set_config('request.jwt.claims', …)` and `request.jwt.claim.sub`.
  - Output is a table (step, expected, actual, ok).
- **Git:**
  - Merging main: always a proper 2-parent `git merge origin/main`. Never `git stash` during a merge (it once dropped #852).
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: <session url>`.
  - PR bodies end with «🤖 Generated with [Claude Code](https://claude.com/claude-code)» + the session link.

## 3. Open PRs
| PR | Branch | Head | Migration (md5) | Ops (md5) | Live script (md5) | Dry-run | «انشر» | Base |
|---|---|---|---|---|---|---|---|---|
| #875 Restricted doctor (opt-in) | `claude/restricted-doctor-scope` | `6da7d233` | 20261126050000 `e74371c365787bff2a87b3702c40ce0e` | `supabase/ops/20261126050000_dalia_ortho_scopes.sql` `a4adf41a8f7aee1e8a520f9aa86c0ea1` | `tests/restricted-doctor-scope-live-rollback.sql` `11e1c8bfee33b768ebe498cf5946dd2a` | PASSED 00:24Z; **mig + ops APPLIED live 00:25Z** | given 00:16Z | main |
| #877 Home consult split | `claude/home-consult-split` | `af0d07f9` | 20261126060000 `baa4dd69621179770c2e0b59fd3dabce` (edited in place, not applied) | `supabase/ops/20261126_home_consult_split.sql` `c9f45fb7d9934090645117b2798f42ac` | `tests/home-consult-split-live-rollback.sql` `514e2c9577dd61d8a6543eb9e829d7f9` | v2 passed 00:34Z on head 736dbb49; **the af0d07f9 rework (owner answers 00:37Z) is not dry-run yet** | given 00:37Z | main |
| #880 Entity service names, Part A | `claude/entity-service-names` | `1d077e2f` | 20261126090000 `7a3364c057746000c4c821ea750cb5f3` | — | `tests/entity-service-names-live-rollback.sql` `9c13d63e1dc542004adb3dca62756874` | not run (passed on PGlite with live-shaped stubs) | **not given** | main |

**Rollbacks:**
- #875: `cd4dd3c0613198f12aa6e29bd555d126`
- #877: `6d1ab6cc7cfb5832c4a30962d827c73d`
- #880: `0472347b153e6cd2857b6cd946f5a4e3`

**Help data:** #875 = 278, #877 = 279, #880 = 290. All three edit the version line and tokens in `dashboard-help-data.js`, `dashboard-help.js` and `index.html`. #877 and #880 both touch `assets/js/reception-workspace.js`. Whichever PR merges later needs a proper merge of main: keep the highest version line and both articles, then rebuild the help files.

**#875 state:** CI `tests` was still in progress at 00:55Z on 6da7d233 (`feature-syntax` green). Dalia result on live:
- dental: 7 scoped services out of 63;
- derm: 64 out of 129;
- 2 restriction rows.

The hub merges on green.

**Superseded:** branch `claude/home-doctor-visit-fee-ops` (91bef842, `supabase/ops/20261126_home_doctor_visit_fee.sql`). The hub was told not to run it. There is no PR for it.

**#877 design:**
- `clinic_reception.home_visit_split` (service_code, nurse_fee 100, travel_minutes 60).
- Nurse fee: a separate 5111→2120 entry on the nurse's provider at execute, posted when the appointment is `nurse_with_doctor`. This follows the referral-fee pattern; fixed contracts are refused on the reception path.
- Doctor fee: a per-doctor exact-code 50% contract, created PENDING by ops APPLY 3 with maker `3e1f9a1f-7789-4cf0-a756-93caa6d9cc73` («Admin Test» super admin, confirmed OK by the hub). The FM approves on screen.
- Guards:
  - a split service doesn't complete without an exact-code contract;
  - `nurse_alone` is refused on book / walk_in / reschedule / execute, and the button is hidden.
- Booking minutes = 15 + per-booking `appointments.travel_minutes` (30/60/90/120, default 60).
- The 200 nursing fee is retired; the 150 row keeps NUR-F61284.
- Apply order: migration → ops APPLY 1+2 → APPLY 3 → FM approval.

## 4. Allocations held
| Item | Migration | Help |
|---|---|---|
| Restricted doctor (#875) | 20261126050000 | 278 |
| Home consult split (#877) | 20261126060000 | 279 (token label "287" used in the suffix) |
| Entity service names Part A (#880) | 20261126090000 | 290 |
| Supplies PR3 (not started) | 20261125220000 | 270 |

## 5. Owner decisions, last 3 days
Most of these were relayed by the hub.

- **2026-11-25, supplies:**
  - Mockups approved «طبق المستلزمات».
  - Billable rule per item: dental items and the basic vitals kit (قطن، شريحة سكر، شكاكة، كحول، جلافز pair = 2) are not billable; everything else is billable. The inventory chat applied the classification: 97 billable / 102 included.
- **2026-11-25, Dr Dalia (EMP-000036):** «بتشتغل في الاسنان تقويم فقط وفي الجلدية ليزر فقط».
  - Ortho codes confirmed: 0000138, 0000133, 0000134, 0000132, 0000131, 0000080.
  - Basics stay open in both departments.
  - «انشر 875» typed 00:16Z on 2026-11-26.
- **2026-11-26 00:08Z, home visits:**
  - The nursing visit fee is 150 (the 200 is retired).
  - «كشف منزلي» is 1500 TOTAL for all doctors, consult plus transport. Services, supplies and medicines are added on top.
  - Doctor 750. With a nurse: nurse 100, centre 650. Without a nurse: centre 750.
  - SVC-0001396 becomes «كشف منزلي (شامل الانتقال)» in «خدمات الكشف», is_home, basic.
- **2026-11-26 00:37Z, #877 answers:**
  1. Discount: the doctor gets 50% of the NET (10% off gives 675 / 100 / 575); the nurse's 100 is fixed.
  2. A nurse never goes alone on «كشف منزلي».
  3. Duration: a 15-minute visit plus travel there and back.
  4. «عدلها»: live has no active 200 row, so there is nothing to rebook; v5 is_home must be true.
  5. «انشر 877» typed.
- **2026-11-26 ~00:27Z:** «طبقه» on the mockup `docs/ui-references/mockups/entity-service-names.html` (branch `claude/entity-names-mockup`, price-contracts chat). Part A is ours.
- **2026-11-26 00:5xZ:** chat rotation order «شوف الشتات اللي طولت واعمل منها فيرجن احدث…».

## 6. Pending owner questions
- **#877:** should the doctor's availability window have to cover the trip too? Today it does, so a home visit right before the end of his hours is refused.
- **#877 follow-up:** the reports-centre margin (wave 7) doesn't subtract the nurse's 100.
- **#880:**
  1. Highlight matched words like the mockup? (not built)
  2. Should «+ إضافة خدمة» extras in a contract booking follow the entity's price and names? They are cash today.
  3. Services without a pricing link stay «مش متاحة للجهة» for contracts, since the save already refuses them. OK?
- **Supplies PR2, still open:**
  - a draft doesn't consume stock;
  - doctors and the GM can use the performer screen;
  - extra included quantity is billed with «المريض وافق».
- **#875:** should the ops record an admin as `set_by`? It is null now.

## 7. Live facts and ids
- Hub / Main 5: `session_01UqVZHZzCVF6etDBvPkF2nc`.
- Price-contracts chat (Part B of entity names): `session_01UqVZHY4wwjuj1eYtuWUuQ5`.
- Live workspace: `select id from clinic_reception.workspaces where mode = 'live'` (exactly one).
- Mazen (reception, live tests): auth sub `f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb`.
- Maker for pending contracts: admin `3e1f9a1f-7789-4cf0-a756-93caa6d9cc73` («Admin Test»; the owner wants it kept).
- Nursing fee pricing row `ac04d74e…`: «خدمة تمريض منزلي - رسوم الزيارة (يضاف لها سعر الخدمة المطلوبة)», 150, code NUR-F61284. Live reception versions: v1 200 inactive, v5 150 active (is_home false until the #877 ops run).
- Home consult pricing row: canonical_code SVC-0001396, 1500.
- Dr Dalia: EMP-000036, derm home department plus dental.
- Self-hosted Supabase at api.swnwclinics.com. Live reads from cloud chats are refused (files.swnwclinics.com), so the hub runs them.

## 8. Traps and lessons
- **Ops writing:**
  - A guard inside `begin` aborts the transaction; put the "already applied" guard BEFORE `begin;`.
  - plpgsql variables named like columns (cost, mode, code) are ambiguous; use the `v_` prefix.
  - `and` doesn't short-circuit a `::regprocedure` cast; nest the ifs.
  - A preview query that calls a function the migration creates fails at parse time even behind a false WHERE. Keep PREVIEW migration-free and put such checks in CHECK.
  - Live names often carry a parenthetical suffix; match pricing rows by name prefix (`like '…%'`) or by id/code, never by exact name.
- **Live dry-run fixtures:**
  - Pick a free slot (gap trigger).
  - Fall back to a service where `doctor_contract_for_service` returns exactly 1 row.
  - Filter stores through `consume_location_ok`.
- **#875 lesson:** inferred restriction would have caught 6 home nurses. Explicit opt-in tables are safer than inference.
- **`doctor_contract_for_service`:**
  - must return exactly 1 row, otherwise execute is refused;
  - an exact code beats 'قسم:X';
  - the reception path refuses fixed contracts (percent only).
- **Tests:**
  - Run Playwright with `PW_CHROMIUM=/opt/pw-browsers/chromium node -r /tmp/claude-0/scratchpad/pw-pre.cjs tests/x.cjs`. Without the preload, `cache-assets.cjs` fails on a missing headless_shell. Never run `playwright install`.
  - Cross-realm deepEqual fails in DOM tests; compare via JSON.
  - CI `leads-archive-tiles` once failed near Cairo midnight on an old head (time-sensitive).
- **Merges:** a 1-parent merge commit (stash during a merge) silently drops main's changes. Verify `git log -1 --format=%P` shows 2 parents.

## 9. Next steps, in order
1. **#877:** the hub dry-runs `514e2c95` on head af0d07f9. If it passes, the hub applies the migration, then ops APPLY 1+2 and APPLY 3, merges on CI green and releases (owner approval given). Then the FM approves the 42 pending contracts on screen. If it fails, fix in `claude/home-consult-split` (worktree /tmp/claude-0/scratchpad/hcwt) and send new md5s.
2. **#875:** the hub merges on CI green (already applied). After it lands, re-merge main into #877 and #880. Expect help-version and `reception-workspace.js` conflicts: keep the highest version line and all articles, run the help build plus `--check`, and re-run the suites.
3. **#880:** the hub dry-runs `9c13d63e` as Mazen; relay the 3 owner questions; wait for «انشر 880». Tell the Part B chat the snapshot keys: `entity_service_name` / `entity_service_code`; JSON null = «نفس اسم سونو», a missing key = an old quote; written at quote time (arrival / order_payer).
4. Follow-ups: the reports-centre margin should subtract the nurse fee (small PR, needs a number).
5. **Supplies PR3** (mig 20261125220000, help 270): «استهلاك أمس» 48h correction with manager approval, reason categories, daily reconciliation. Not started; ask the owner before building.
6. The safety-net check-in trigger `trig_011S7s4HKkKU8WbHipyNgBZR` (01:20Z) belongs to the old chat; the new chat may delete it and re-arm its own.

---

## Addendum (00:57Z)
- **#877:** dry-run `514e2c95` passed 00:54Z. **APPLIED 00:55Z:**
  - mig 20261126060000 (`baa4dd69`);
  - ops (`c9f45fb7`) APPLY 1+2: NUR-F61284 v5 at 150 is the only active version, is_home true; SVC-0001396 is «كشف منزلي (شامل الانتقال)» 1500, nurse 100, road 60;
  - APPLY 3: 42 pending 50% contracts.

  The hub merges on CI green.
- **#877 post-merge steps:**
  1. The FM approves the 42 pending contracts on screen.
  2. The hub runs the ops CHECK section (C0 nurse→provider list; each doctor should resolve to «50% exact»). Nurses without a provider get their 100 later via `home_nurse_issues`.
  3. Until step 1, «تنفيذ» on «كشف منزلي» is refused. That is intended.
- **#875:** CI check suite completed green at 00:55Z on 6da7d233. The hub merges.
- **After #875 and #877 merge:** re-merge main into #880 (help versions 278 / 279 / 290 and `reception-workspace.js`).

## Addendum 2 (01:05Z)
- **#880:** the hub's first dry-run of `9c13d63e` at 00:57Z (03:00 Cairo) aborted in the fixture: nobody was on shift.
  - **Fixed in head `82d7d0ec`.** If no provider is working now, the live script adds a temporary availability block for an active provider with a priced non-home service. It also stubs the unrelated cash-shift guard if Mazen has no open shift. Both are rolled back.
  - New live script md5 `6853a07c782d1b4cc1fb47a2be12d46b`; the migration is unchanged (`7a3364c0…`).
  - Verified on the PGlite harness with and without availability: all rows ok.
  - Waiting: the hub's re-dry-run, then the owner's «انشر 880».

## Addendum 3 (about 01:15Z)
- main moved to `e20f7504`: #871 (treasury) also took help data version 20261126-278. All three PRs conflicted on the help version and token lines only. Each was fixed with a proper 2-parent merge of main, then the help build plus `--check`, then the suites (all PASS).
  - **#875:** head `ec62cee1`, token `help-278-restricted-doctor-treasury-20261126-3`.
  - **#877:** head `01d93da4`, token `help-279-home-consult-split-20261126-3`.
  - **#880:** head `aa17d541`, token `help-290-entity-names-20261126-2`.
- **Migration / ops / live-script md5s are unchanged.**
- When one of the three merges, the other two will conflict again on the same 3 lines (`index.html`, `dashboard-help.js`, and the version line of `dashboard-help-data.js`).
  - Fix: merge main, keep the higher version line and this PR's token, run `python3 scripts/build-dashboard-help.py` then `--check`, commit, push.
- **Restart lesson:** the worker restart wiped `/tmp/claude-0/scratchpad`, including worktrees, node_modules and `pw-pre.cjs`.
  - Use the session scratchpad directory.
  - Recreate the worktrees with `git worktree add <dir> origin/<branch>` and run `npm ci` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
  - Recreate `pw-pre.cjs`: a small require hook that sets `executablePath` to `/opt/pw-browsers/chromium` on `chromium.launch`.
