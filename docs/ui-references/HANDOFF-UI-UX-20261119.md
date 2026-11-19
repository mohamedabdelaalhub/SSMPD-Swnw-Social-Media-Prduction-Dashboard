# Handoff — UI & UX 2 chat (2026-11-19)

Written so the chat can be closed (context is large) and continued by «UI & UX 3». Rules are unchanged from `HANDOFF-UI-UX-20261118.md`.

## Rules (copy them)
- Talk to the owner in Egyptian Arabic only. Code, commits, PRs and messages to other chats may be English. Model: Sonnet, never ask to change it.
- Mockup («تصور») first as a private artifact → wait for «طبقه» → one focused PR → before/after screenshots (DSF 2, 390 and 1280) → `?v=` stamps → help article + help `version` in the same PR.
- Merging is done by the main chat (session_01UqVZHZAEDhpP5u7GCt479N) only after the owner writes «انشر N» **and** CI is green on the current head. Send it: PR number, head sha, owner-approval event uuid, migration status.
- **Help-version numbers: the main chat's ledger is the only source.** Ask it before any bump. Last used by this chat: 45 (#591), 47 (#596), 48 (#593), 50 (#595).
- When `main` moves, PRs conflict only on help `version`, `dashboard-help.js` `DATA_FILES` and the `index.html` help stamp: merge `origin/main`, keep the higher version and fresh stamps. CI takes ~22 min per push; avoid pushing twice. The main chat may say "resolve N" before merging.
- Tests: `npm install --no-save jsdom` first. 9 known failures are documented in CI (not ours). Help tests: `dashboard-help-dom|coverage|coach`.

## Shipped since the last handoff (live)
- #589 searchable patient / department / doctor / extra-service pickers in the reception booking modal (`selectCombo` in `reception-workspace.js`).
- #591 booking modal as 3 numbered cards, switch look for walk-in / external service, sticky save bar (`cardize`).

## Open PRs (owner-approved unless noted; waiting on CI / the main chat)
| PR | What | Help ver | Notes |
|---|---|---|---|
| #593 | booking patient picker also searches/shows the phone | 48 | approved «انشر 593»; conflicts with main, waits for "resolve 593 595" after #594 |
| #595 | HR «الآن (مباشر)»: totals/departments/people open popups, calmer cards | 50 | approved; CI green on 88d2f14 but conflicts with main; also fixes `tests/employee-profile-dom.cjs` |
| #596 | reception modals as a bottom sheet on phones (CSS) | 47 | **not approved yet** |
| #597 | project skill «كفر لتر سونو الرسمي» (`.claude/skills/swnw-official-cover-letter`) | none | approved «انشر 597» |

Mockups (docs only, never merged): `claude/booking-search-mockup-20261118` (booking pickers + modal v2), `claude/hr-presence-popups-mockup`. Private artifacts: booking pickers https://claude.ai/artifact/E6A17xA3V35ZoUQhFa5LeB · booking modal v2 https://claude.ai/artifact/3BUuMhv6QqJENpYzuXkeZz · HR presence popups https://claude.ai/artifact/LHVkmXk6dwG9wKE9QnpzZT · Swnw brand kit https://claude.ai/artifact/QzLEGiLdBrQF23fZJKhL9q · Swnw UI spec https://claude.ai/artifact/44kuS3ZMD1c2CNnyZrrXgH.

## Side work done for other chats (no repo changes)
- Offer document (A4 PDF + Word) on the official letterhead with cover, built with the skill script; files were delivered to the owner (not in the repo on purpose: business document).
- «كورس الإدارة 1» (session_01UqVZHY7Low2hy1dRAzWfer) got the brand kit and the UI spec artifacts to restyle its private course/exam pages.

## Open questions to the owner
- Tax number: official letterhead says **758-688-423**; the owner's text said 423-688-758. Not resolved.
- «Same template as the invoices»: unknown; the offer used the official letterhead. Ask for an invoice sample if it matters.
- Fonts licence (Hiragino Kaku) for web embedding is unverified; the brand kit says private pages only.

## Next (nothing started)
1. Ship the queue above (resolve conflicts after #594, send green heads to the main chat, relay approvals with their event uuids).
2. Audit the floating help / bot buttons overlapping content on phones outside accounting; mockup first.
3. Wait for the owner's next screenshots.

## Tools / harnesses
- `docs/ui-references/tools/layout-check.cjs` and `text-fit-check.cjs` before sending images.
- Reception booking harness page: build a static page that loads `reception-workspace.js` with mocks like `tests/booking-service-combobox-dom.cjs`, then screenshot with Playwright (`executablePath: /opt/pw-browsers/chromium` if the repo's Playwright can't find its browser).
- HR presence screenshots: dump `document.documentElement.outerHTML` from `tests/hr-presence-dom.cjs`-style env (`tests/helpers/att-hub-env.cjs`) and load it with all `assets/css/*.css` in Chromium.
