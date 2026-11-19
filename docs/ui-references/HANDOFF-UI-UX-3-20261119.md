# Handoff — UI & UX 3 (2026-11-19) — screen backlog tracker

Read first: `HANDOFF-UI-UX-20261119.md` (rules, queue), `README.md` (kits, QA gate). Owner rule (2026-11-19): every screen
listed here that gets fixed is marked **DONE** below; whatever is still open stays here for the next chat. Update this file in the
same PR as each screen. Role of this chat: dashboard UI/UX (not invoices/documents — those belong to the invoice chat, `swnw-print.js`).

## Approved look
Calm pages per `README.md` («Ember» principles), one hero card, pill filters with counts, soft chips, motion/sound kit, colours kit.
Printed reports use `docs/ui-references/PRINT-DOCUMENTS.md` + approved `mockups/report-statement.html` (owner approved 2026-11-19;
implementation waits for PR #600 to merge because `swnw-print.js` lives there; branch `claude/report-letterhead-mockup`).

## Already redesigned (do not redo)
Summary, Home, Team performance, HR live presence, Employee profile, Accounting shell + overview, Main menu, Reception booking modal (+ bottom sheet #596).

## Owner's UI/UX rules (read from BOTH earlier UI chats, 2026-11-19; his own words)
Chat 1 (11-17/18):
- Show motion, not just screenshots. Mockup («تصور») first, always; «طبقه» = implement; «انشر N» = merge after green CI.
- No ugly gaps between cards/rows («فراغات مش حلوة»); separators between employees; absent people must be visible; no empty or duplicate sections.
- Hover/touch motion and sounds on everything, so the UI is not «جامد». Approved: motion & sound table, his own colour list, charts file.
- Charts with explanation on every indicator; animated, interactive.
- Numbers: English digits; number text dark grey #333333 on the coloured chips (not white); calmer green.
- Totals/summary buttons must open a POPUP (one button = one action); departments/employees show few details, details in a popup («بتتوهني»).
- «فين اللي اتفقنا عليه» — never deviate from the agreed look; apply what was agreed fully.
- Every feature gets an explainer video/help article.
Chat 2 (11-18/19):
- Search boxes where lists are long (patient/department/doctor). «بصلي على السكشن كله وقولي اقتراحاتك» = review the whole section and propose, mockup first.
- Printed documents: Swnw letterhead, BigVesta, no wording changes, no brand name in titles.
- Owner sleeps at night: queue work, he approves in the morning.
Owner on 2026-11-19: the Tasks employee view looked bad to him («شكله مش حلو») even though it passed my layout check → judge by his taste and rules above, not only by layout checks.

## Backlog of crowded screens (ranked by control count, NOT yet verified with real screenshots — verify first)
| # | Screen | File(s) | Controls | Status |
|---|---|---|---|---|
| 1 | Tasks | `render-tasks.js` | 104 | OWNER REJECTS current look of the employee view «مهامي» (fixture: `tests/task-assignment-fixture.html`). Redesign needed; first confirm which view bothers him. Manager views («كل المهام», «المشاريع», «المناقشة») NOT verified: need real-volume screenshot from the owner |
| 2 | Patient archive | `render-patients.js` (343k, split into phases) | 361 | OPEN |
| 3 | Inventory | `render-inventory.js`, `inventory-workspace.js` | 105 / 54 | OPEN |
| 4 | Leads | `render-leads.js` | 77 | OPEN |
| 5 | Contracting & partnerships | `contracting-partnerships.js` | 70 | OPEN |
| 6 | Reception workspace (screen, not modal) | `reception-workspace.js` | 58 | OPEN |
| 7 | Design studio | `design-studio.js` | 53 | OPEN |
| 8 | Floating help/bot buttons covering content on phones (outside accounting) | `dashboard-help.js`, bot | — | OPEN |
| 9 | Printed internal reports on the letterhead (statements, financial statements, accounting, indicators, leads report, HR offboarding) | see PRINT-DOCUMENTS.md | — | MOCKUP APPROVED, waits for #600 |

Status values: OPEN · MOCKUP SENT · APPROVED («طبقه») · PR #N · DONE (merged).

## Lesson
Control count (grep of `<button|<select|<input`) is a weak proxy: Tasks scored 104 but its employee view is fine. Ask the owner for screenshots of the screens that bother him, or build fixtures with realistic volume, before mockups.

## Open PR queue (see main chat for merges)
#593 (help -53) and #595 (-50) are being resolved by the main chat — do not push to them. #596 not owner-approved. #597 main chat merges.

## Owner preferences learned
- Arabic Egyptian only to the owner. Short replies. Show images, not paths.
- «Always tell me what is finished and what remains; leave the rest in the handoff» (2026-11-19).
