# HANDOFF — «UI & UX 3» → «UI & UX 4» (2026-11-22)

Owner: Mohamed (non-technical, Egyptian Arabic ONLY, show screenshots, no terminal steps). I (UI&UX 3) am Sonnet; never ask to change model. Merging/releasing = main chat 4 only (`session_01UqVZHWinhpWRSh3CbwuKFd`), after the owner types «انشر N» in ITS chat; I send PR number + head + event uuid of the owner message when he types «انشر N» in my chat (`list_events kinds:["user"] limit 25` then read the uuid). Help version numbers come ONLY from main chat 4's ledger.

## Rules that keep biting (read first)
1. Mockup first; owner says «طبقه» → build. Mockups: real fonts (`../../../assets/fonts` @font-face), palette (new/on-time `#00B0BD`, late/soon `#FF8800`, absent `#FF0000`, leave/old `#525B6F`, none `#F1F4F8`; brand `#0F369D`, accent `#F15A22`, ink `#16212E`), text on teal/orange chips WHITE when owner said so («جديد» white), English digits, no wrapping in buttons/chips/tiles, summary tiles outside popups. Run `docs/ui-references/tools/layout-check.cjs <file> [sel] 390 1280` before sending images.
2. Every user-visible change: help article step in `assets/js/dashboard-help-data.js` + `"version"` (from ledger) + `?v=` stamps (`dashboard-help.js` DATA_FILES + index.html) + `python3 scripts/build-dashboard-help.py` then `--check`. New placeholders/labels need `frule(...)`/`rule(...)` in `scripts/build-dashboard-help.py` (same label + same text across files).
3. CACHE STAMPS: every JS/CSS file I change needs a NEW `?v=` in index.html (or config.js for lazily-loaded modules like today-operations*.js, and `today-operations.css` stamp inside today-operations.js line ~8). When resolving merge conflicts NEVER take one side blindly: I once lost a stamp bump (reception-controls.js) and two help steps. Verify with grep after every conflict resolution.
4. Migrations: patch the LIVE function def (ask main chat for `pg_get_functiondef` dump on a `claude/live-capture-*` branch), by exact anchor that raises unless matched once; test in PGlite; keep file byte-identical after it is applied live.
5. Tests: jsdom `tests/*.cjs`; Playwright tests need `PW_CHROMIUM=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` (some, e.g. `reception-services-ui.cjs`, ignore it → only CI runs them). Board tests can hang unless the script calls `process.exit(0)`.
6. Don't force-push; don't push to branches others own; merge main (no rebase) when asked.

## State at handoff
- Merged & released: #683 #689 #691 #692 (via #695), #696–#698 (#699), #703–#706 (#708), plus earlier header v2 / nav / masa net / masa archive / long lists / auto-book fixes. #703–#706 closed as superseded.
- OPEN: **#712** «المتابعة والتواصل» own reception section + Arabic message kinds/statuses (branch `claude/followup-move-20261122`, head 1d79c74, help -159). Main chat 4 merges on green CI; owner already typed «انشر 712». If main moves, merge main into it and resolve help/stamp conflicts carefully.
- Next free help number per ledger at handoff: -162 / migration 20261122060000 (ask main chat; -160 and -161 reserved for the build below).

## NEXT BUILD (owner said «طبق اللي اتعمل»; UX audit chat `session_01UqVZHXcvGgk7oVnSnFsg6m`; assigned by main chat 4). Do it AFTER #712 merges.
Mockups (approved): branch `claude/ux-reception-mockups` → `docs/ui-references/mockups/today-board-simplify.html`, `booking-reception-simplify.html` (copies are in this branch). Two PRs: A «تشغيل اليوم» = help -160, B «الحجز والاستقبال» = help -161. UI only, no RPC change.
Owner decisions: keep the «الحالة» select next to the chips in both screens (#694); keep the hour rail (already in «الحجز والاستقبال», `tests/reception-timeline-ui.cjs`); don't redo #694/#689/#704/#705/#706; reuse the #689 confirm dialog (`confirmRun` in `today-operations.js`, `modal(...,opts)` in `reception-workspace.js`).

### SPEC A — «تشغيل اليوم» (`assets/js/today-operations.js` + css; later wrappers exist: -v2 -finalize -queue -unified -display -calls … check which one owns each element before editing)
1. Header: title + «حجز جديد» + «⋯». Date row = one line «النهارده · الأحد ٢٢ نوفمبر» with prev/next arrows only; refresh ⟳ and the «يوم التشغيل» label move into «⋯» (date picker stays reachable). Arabic date wording.
2. Keep search + «الأطباء» + «الحالة» selects and the 7 chips (names/counts unchanged).
3. Doctors strip collapses to ONE line («الأطباء: د. X متأخرة ١٥ د · د. Y شغال» + «تفاصيل ⌄»). Expanding shows the existing doctor cards INCLUDING «صرف حساب الطبيب» (`data-doctor-pay-workspace`, `reception-doctor-payout.js` must keep working).
4. «يحتاج تدخل» → one amber line for the longest waiter: «<اسم> مستني N دقيقة — د. X» with main button «نادي» (not «تحديد الأولوية»). A delayed doctor appears only in the doctors line.
5. Timeline: hour groups as a vertical rail (dot per hour, past hours dimmed, orange «الآن · HH:MM» marker). Each chip: time + name (+ channel tag) + short status (متأخر N د / N د / جوه / متبقي X). Tap opens the card.
6. Opened card: name ONCE; status badge; line «time · doctor · service · رقم الملف N» (not «ملف F3»); ONE main button by status (وصل / نادي / إنهاء الزيارة / التحصيل «حصّل X ج.م»); menu: تحديد الأولوية، طلب دعم، «الحساب والخط الزمني» (merge «التفاصيل والحساب» + «الخط الزمني»)، لم يحضر for expected. Remove the «مدفوع» tag from patients who have not finished. Done+paid keeps green «✓ تم التحصيل».
7. Role gating unchanged (`can('book')`, finance visibility).

### SPEC B — «الحجز والاستقبال» (`assets/js/reception-workspace.js` `timeline()` + `reception-workspace.css`)
1. Header: small date line + big day name; prev/next week arrows, «⋯», «حجز موعد» in the header row. REMOVE the floating «+» FAB. Move «✍ تسجيل موعد يدوي» and the sound toggle into «⋯» (label «صوت التنبيهات: شغّال/مقفول»).
2. Week strip: one compact row (Sat→Fri, dot for days with bookings, holiday cell striped «أجازة»; keep the holiday notice). Day names must not clip at 360px.
3. Replace the 4 summary tiles with small count chips: الكل / مؤكد / حضروا / لم يحضر (zero = muted, no orange alarm). Keep search, «الأطباء», «الحالة»; mobile: search full width, the two selects share the next row.
4. Timeline: keep rail/hours; collapse runs of empty hours into «من 12:00 م لـ 2:00 م · فاضي»; orange «الآن» marker; cancelled chips struck-through.
5. Opened card: neutral card with status-coloured side bar (not solid green); ONE main button «تسجيل حضور» (booked/confirmed); menu: تأكيد الحجز (booked only)، تغيير الميعاد، لم يحضر، إلغاء الحجز، ملف المريض. «إلغاء الحجز»/«لم يحضر» go through the confirm dialog (#689). Show «رقم الملف N» not DEMO-001 style.
6. Boundary: «الحجز والاستقبال» = bookings of any day; «تشغيل اليوم» = live queue after arrival. Keep «وصل» in «تشغيل اليوم».

### ACCEPTANCE
Help articles for both screens + version + stamps; update `tests/reception-today-board-dom.cjs`, `tests/reception-timeline-ui.cjs` (+ mobile tests); layout-check at 1440/390 and also 360: no overlap/clipping/overflow; role/finance gating exactly as today.

## Other open threads
- Old/new Masa split (#697 shipped) needs the DB `needed_service` (applied). «نقل للأرشيف» only dismisses the booking row (patient file stays).
- Mistaken hold→resume (≤120 s) live; toast + timeline mark shipped in #708.
- Handoff index: this file; earlier: `docs/ui-references/HANDOFF-UI-UX-3-20261119.md`.

## Extra details from the UX audit chat (arrived after the spec)
FILES / SELECTORS
- «تشغيل اليوم»: `today-operations.js` — `paint()` (header/top/date nav/tools), `toolsHtml()`, `metricsHtml()` (chips, keep), `doctorStrip()` (+ `data-doctor-pay-workspace/-day` on `section.journey-doctors`; `reception-doctor-payout.js` scan() decorates it — keep the attribute on the EXPANDED cards), `actionCenter()` («يحتاج تدخل»), `paintBoard()` (`.journey-hour/.journey-hour-label`), `card()/cardActions()`, `payPill()`. CSS `assets/css/today-operations.css`. Tests: `reception-today-board-dom.cjs`, `today-board-collect-pill-dom.cjs`, `today-board-staff-dom.cjs`.
- «الحجز والاستقبال»: `reception-workspace.js` `timeline()` (~line 66; `rx-tl-head`, `rx-tl-nav`, `rx-tl-week/.rx-tl-wd`, `rx-tl-sum/.rx-tl-stat` (4 tiles → small chips, keep `data-tl-stat` filtering), `rx-tl-tools` (keep `data-tl-doctor-filter` / `data-tl-status-filter`), `rx-tl-hr`, `rx-tl-fab` (remove)). Test `tests/reception-timeline-ui.cjs` (`RECEPTION_QA=<dir>` dumps screenshots; needs `@electric-sql/pglite` via NODE_PATH).
BEHAVIOUR
- Main button per status in «تشغيل اليوم» (logic unchanged from `cardActions`): expected/on_the_way→وصل; waiting→نادي; called→بدأ الكشف; in_service→إنهاء الزيارة; on_hold→عودة للطبيب; done with due && can('collect')→«التحصيل» (orange; amount only inside the opened card). The alert line's «نادي» = the same `call` action for the longest waiter (wait_minutes > max_wait_minutes).
- «الحجز والاستقبال»: booked/confirmed→تسجيل حضور; arrived/no_show/cancelled→no main button.
- «رقم الملف N»: print `رقم الملف ` + the real file_no AS IS (replace the «ملف F3»/bare-code wording only). No data change.
- Empty-hour collapse: after filters, take hours from the first to the last visible appointment; each run of consecutive empty hours → ONE muted row «من H1 لـ H2 · فاضي» (single hour → «فاضي»). Cancelled-only hours count as empty only if the filters hide them.
- Doctor strip: collapsed by default (memory only); one-line summary with red «متأخرة N د» when delayed; «تفاصيل ⌄/⌃» toggles the full doctor cards (⋯ menu + «صرف حساب الطبيب»). Keep the ⋯ clipping fix from 77435b7.
- «يحتاج تدخل»: keep `help_requests` (resolve_help) alerts; only the wait-too-long + doctor-delayed duplicates collapse.
- Date row: keep the hidden date input/`data-journey-day`; reachable from «⋯» → «تغيير اليوم» or tapping the date. Arabic date: `toLocaleDateString('ar-EG-u-nu-latn',{weekday:'long',day:'numeric',month:'long',timeZone:'Africa/Cairo'})`.
- Visual reference = the mockup HTML; where data differ (file_no values) follow the real data.
