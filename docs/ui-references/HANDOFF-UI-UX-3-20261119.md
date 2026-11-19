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

## Backlog of crowded screens (ranked by control count, NOT yet verified with real screenshots — verify first)
| # | Screen | File(s) | Controls | Status |
|---|---|---|---|---|
| 1 | Tasks | `render-tasks.js` | 104 | OPEN — next: screenshot, mockup, wait «طبقه» |
| 2 | Patient archive | `render-patients.js` (343k, split into phases) | 361 | OPEN |
| 3 | Inventory | `render-inventory.js`, `inventory-workspace.js` | 105 / 54 | OPEN |
| 4 | Leads | `render-leads.js` | 77 | OPEN |
| 5 | Contracting & partnerships | `contracting-partnerships.js` | 70 | OPEN |
| 6 | Reception workspace (screen, not modal) | `reception-workspace.js` | 58 | OPEN |
| 7 | Design studio | `design-studio.js` | 53 | OPEN |
| 8 | Floating help/bot buttons covering content on phones (outside accounting) | `dashboard-help.js`, bot | — | OPEN |
| 9 | Printed internal reports on the letterhead (statements, financial statements, accounting, indicators, leads report, HR offboarding) | see PRINT-DOCUMENTS.md | — | MOCKUP APPROVED, waits for #600 |

Status values: OPEN · MOCKUP SENT · APPROVED («طبقه») · PR #N · DONE (merged).

## Open PR queue (see main chat for merges)
#593 (help -53) and #595 (-50) are being resolved by the main chat — do not push to them. #596 not owner-approved. #597 main chat merges.

## Owner preferences learned
- Arabic Egyptian only to the owner. Short replies. Show images, not paths.
- «Always tell me what is finished and what remains; leave the rest in the handoff» (2026-11-19).
