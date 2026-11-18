# Handoff — UI & UX chat (2026-11-18)

Written so this chat can be closed and continued in a fresh one.

## Rules for the new chat (copy them)
- **Language:** talk to the owner in Egyptian Arabic only. Code, commits, PRs and messages to other chats may be English.
- **Model:** Sonnet (claude-sonnet-5-5), set by the main chat. Never change model, and never ask the owner to, without the main chat's agreement. Finance-logic, DB or migration steps go to the main chat (session_01UqVZHZAEDhpP5u7GCt479N).
- **Workflow:**
  1. Mockup («تصور») first, published as an artifact.
  2. Wait for «طبقه» before implementing.
  3. One focused PR per change.
  4. Before/after screenshots at DSF 2, mobile 390 and desktop 1280.
  5. Bump the `?v=` stamps.
  6. Help article in the same PR (CLAUDE.md rule 6). Bump `version` in `assets/js/dashboard-help-data.js` and the `DATA_FILES` stamps in `assets/js/dashboard-help.js`.
- **Merging:**
  - Only after the owner writes «انشر N» **and** CI is green on the current head.
  - Then send the main chat: the merge sha, the approval event uuid (find it in the session transcript or with `get_event`), and the migration status.
- **Help-version numbers** are shared with:
  - the help-guide chat (session_01UqVZHYmx1oHQfzNX9effCQ);
  - the fallback-booking chat (session_01UqVZHWUt41yGo8hTeHfcv9).

  Main is at **20261118-38**; the help chat holds 39 and up. Tell them which number you take.
- **No wrapping or overflow:** no text may wrap inside buttons, chips or KPI lines, and nothing may scroll sideways. Check with `docs/ui-references/tools/text-fit-check.cjs` and `layout-check.cjs`.
- **Stacked PRs:** merging `origin/main` into a branch usually conflicts only on the help `version`, `dashboard-help.js` `DATA_FILES` and the `index.html` help stamp. Take the higher version and fresh stamps. If two branches add articles at the same spot, re-insert yours on top of main's file.

## Shipped today (all live)
- Accounting:
  - #561 shell (side rail)
  - #565 overview
  - #566 table cards
  - #571 Arabic labels and formats
  - #572 buttons
  - #573 floating buttons
  - #574 one period per screen
  - #575 pricing and inventory cards
- #576 «أداء الفريق» redesign.
- #578 HR presence: «مابصموش آخر 16 ساعة» (owner complaint relayed by the main chat).
- #580 «الملخص العام» v2:
  - code: `assets/js/summary-v2.js`, `assets/css/summary-v2.css`
  - the BI module is folded inside the page
  - the old sections load lazily in «كل التفاصيل والأرشيف»
  - test: `tests/summary-v2-ui.cjs`
- #585 admin user editor: `polish()` in `assets/js/admin-workspace.js` plus CSS in `admin-workspace.css`; test `tests/admin-workspace-dom.cjs`.

## Open / next
- **Nothing is in flight.** No open PRs from this chat.
- **Mockup branches** (docs only, never merged):
  - `claude/summary-mockup-20261118`
  - `claude/admin-user-mockup-20261118`
  - `claude/team-perf-mockup-20261118`
- **Artifacts:**
  - summary: https://claude.ai/artifact/GMxvNtn853MkqicT2tWmVK
  - admin user: https://claude.ai/artifact/6ysaijwRB5DFtdpbTbxkcs
  - team performance: https://claude.ai/artifact/YFpoWwBCDtDq5JXp31Gvrh
- **Optional offer, the owner said «لا تمام» for now:** the admin «مفعّل» switch stops an account without asking, exactly like the old «إيقاف» button. A confirmation could be added if the owner asks.
- **Next screens:** wait for the owner's screenshots. Audit candidates from the 2026-11-18 sweep: none flagged in the content tabs (production, review, design, publish, comments, performance, archive, metaads, mediabuyer). The floating help/bot buttons can overlap content on phones outside accounting; check this per screen.
- **QA harness:** `/tmp/claude-0/qa/fcnav/boot2.cjs` boots the full app with the smoke-test mocks. It is session-local, so recreate it from `test/smoke.js` if it is missing.

## NEW owner request (2026-11-18, late) — start here
Screen: HR → «الحضور اللحظي» → «الآن (مباشر)» (`assets/js/hr-presence.js`, `assets/css/hr-presence.css`).
Owner screenshot: `docs/ui-references/screens/hr-presence-popups/owner-request-before.jpg`. Owner's words, paraphrased:

1. **Total tiles:** every tile that shows a total («موجودون الآن», «غايبون», «متأخرون», «في إجازة», «لم يبدأوا بعد», «انصرفوا») must **open a popup** listing those people. Today a tap filters the list in place («فلتر نشط: المنصرفون» + «إلغاء الفلتر»), which confuses him: "I get lost when one button does two things".
2. **Department cards must be calmer:**
   - show fewer details per employee (today each row has the name, the job, a time pill and «عمل 7 س 49 د»);
   - tapping a department **or** an employee opens a popup with the full details;
   - the goal is that he never hunts for where a button opened something.

Next steps:
1. Make a mockup first (`docs/ui-references/mockups/hr-presence-popups.html`) and publish it as an artifact.
2. Wait for «طبقه».
3. Implement it while keeping the existing data and handlers. Note `tests/hr-presence-dom.cjs` asserts the current filter behaviour, so update it.
4. Update the help article `hr-presence-live` in the same PR.
