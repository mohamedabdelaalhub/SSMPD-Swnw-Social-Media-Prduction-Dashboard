# «الحسابات» — UX problems (production state, origin/main 9605b24)

Evidence = screenshot in `/tmp/claude-0/qa/acc-audit/shots/` (suffix -1440 / -390). Counts come from `metrics.md` (automatic) unless stated. Mock data caveats are in inventory.md; items that could be mock artefacts are marked (mock?) and kept out of the ranking.
Ranked list at the end. Each item: what / where / evidence / one-line suggestion.

## 1. Broken behaviour (verified)

**P1 — «الخزائن والورديات» crashes for any reviewer or cashier with an open shift; the screen then becomes a trap.**
`finance-cash.js` line 29 `mountMovements()` uses `db.client`, but `db` is only declared inside `act()` (line 76) → `ReferenceError: db is not defined` from `draw()` before the buttons are bound. Result (checked in the harness): every button on the section does nothing (فتح وردية, كشف الخزينة, سند قبض/صرف, جرد وإغلاق, مراجعة الوردية, الحركات…), «رجوع إلى الخزائن والتحصيل» and the 6 group buttons do nothing, re-clicking the «الخزينة والدورة المالية» sub-tab re-renders the same broken section (module state keeps tab=shifts), and `SSMPDNavState` saved the location before the crash, so F5 in the same browser tab reopens it. The «اللي حصّلته في ورديتك» tiles also never appear (`fillMyShift` swallows the same error). Files: 102-cash-cash-shifts-{1440,390}.png (actual) vs 117-cash-cash-shifts-SHIM (intended). Suggestion: use `window.SSMPDDb` in `mountMovements/fillMyShift` (and add a guard so a panel error cannot unbind navigation).

**P2 — «الأرصدة والتصحيحات» → «مراجعة» throws** `TypeError: Cannot read properties of undefined (reading 'lines')` in `ledger-editor.js act()` (201-cash-accounting-manual~dlg-مراجعة). (mock?) — draft batch in the fixture has no `payload.lines`; worth checking with a real pending correction. Suggestion: guard missing lines.

**P3 — Raw technical errors shown to the user.** When a sub-panel fails, the English JS message is printed as-is: «Cannot read properties of undefined (reading 'filter')» toast on طلبات الموظفين (433-inventory-operations-supplies-1440) and «…(reading 'length')» inside the reception panel under الخدمات والفواتير/التحصيل in an earlier run (`_run4…/` and `_partial-run1/016`). Error text is not translated and not actionable. Suggestion: one Arabic error component with «إعادة المحاولة».

## 2. Navigation depth and duplicated navigation

**P4 — 5 stacked navigation bars before any treasury content.** header → sub-tabs → hero «الخزينة والدورة المالية» + تحديث → period form + status line → 6 group buttons → «رجوع إلى …» + section title. On 1440 the first table row starts at ~y=700; on 390 the section title starts at ~y=900 and the first data row at ~y=1,150 (102-cash-cash-shifts-390, 186-cash-accounting-ledger-390). Pricing has 3 levels, inventory 4 — three different navigation models in one module. Suggestion: one left/top section menu per module, period filter collapsed into the section header.

**P5 — Treasury needs 3 clicks to reach any working screen and a card landing in between.** sub-tab → group → «فتح القسم» card → (dialog = 4). 23 sections are spread over 6 groups with 1–8 cards each; «الإعدادات» has a single card (213) and «التقارير والرقابة» two (210) — the landing page is an extra click with no information. Files 101, 132, 171, 185, 210, 213.

**P6 — Same lists/actions reachable from several places.**
- «أطباء مسجلين في الموارد البشرية وملهمش عقد» table appears in both الأطباء والأتعاب (136) and حساب الأطباء (146).
- كشف الخزينة / سند قبض / سند صرف / سجل سندات الحسابات buttons appear in both الخزائن والورديات (117) and القيود وميزان المراجعة (186).
- «الشجرة المحاسبية» is a section card (202) and a button inside القيود (194 is the same page reached in-place).
- «فتح فواتير الخدمات والمستلزمات» in المخازن → بيع مستلزمات لمريض jumps into the treasury invoices section (432) — a cross-module jump with no way back to inventory.
- Prices live in «التسعير والخدمات والباكجز» here and also in the separate top-level tab «الخدمات ولوائح الأسعار».
- «تحويل/طلب صرف مستحقات» exists on الأطباء والأتعاب, حساب الأطباء, and طلبات الصرف (all open the same form).

**P7 — Content injected above the navigation.** On الأطباء والأتعاب the «نصوص العقد الإلكتروني» + «بداية التطبيق (يحددها المالك)» block (finance-contract-signature.js line 91 `host.insertBefore(box, host.firstChild)`) is rendered between the period filter and the group buttons, i.e. outside the section, pushing the group nav down (136-cash-dues-doctors-1440 top; 390 version pushes nav below y=1,150).

## 3. Duplicated controls

**P8 — Up to 6 date inputs / 3 independent period filters on one screen.** Global «من/إلى/عرض الفترة» + reception panel «الحجوزات والخدمات المرتبطة» (another من/إلى/عرض الفترة, reception-shared.js) on الخدمات والفواتير/التحصيل/التأمين (103, 108, 177: 4 date inputs); + «كل الحركات بالتفصيل» own من/إلى on الخزائن (117: 4); + 2 contract enforcement dates on الأطباء (136: 6); + statement dialogs have their own من/إلى (119, 187: global period not reused); + doctor statement uses «آخر 90 يوم» (150). The status line already repeats the period. Suggestion: one period control per module, inherited by panels/dialogs.

**P9 — Two «تحديث» buttons** on حساب الأطباء (hero + section, 146) — and «عرض الفترة» appears twice on 103/108/136/177 (dupLabels: عرض الفترة on 14 views, تحديث on 10).

**P10 — Duplicate headings.** Section title is repeated as the card title right below it: «الخدمات والتسعير/الخدمات والتسعير» (006), «الباكجز/الباكجز» (010), «المستلزمات والإضافات الطبية/مستلزمات وإضافات طبية» (002), «الأصناف والأسعار» ×2 (404), «الأرصدة حسب المكان» ×2 (409), «بيع مستلزمات لمريض» ×2 (430).

**P11 — Repeated blocks on every view of a sub-module.** «إعدادات خدمات الحجز تحتاج استكمال» card on all 4 pricing screens (001-010); «تنبيهات تحتاج متابعة» + «المكان» card + Excel/PDF on all 18 inventory screens (401-451); footnote «القوائم تعرض ٢٠٠ سجل لكل صفحة…» + السابق/صفحة/التالي on all 23 treasury sections, including ones with 1–5 rows and the chart tree (202) where it is meaningless.

## 4. Text load

**P12 — Long explanatory paragraphs.** الأطباء والأتعاب: 11 text blocks / 27 rendered lines / 1,779 characters before and between tables (136); مقدمات الحجز 12 lines (111, one 3-line paragraph mentions «مسار الوكيل»/«إقرار القناة»); الصرف والمستحقات overview 12 lines (132); الشجرة المحاسبية 10 lines (202); doctor statement dialog 3-line rule paragraph (150). Every treasury section starts with a policy sentence («كل طلب يحتاج مراجعة شخص آخر…», «التصحيح يبقي المطالبة دون قيد خسارة…»). Full list: «expl» column in metrics.md. Suggestion: move rules into the existing «شرح النموذج»/help, keep one-line hints.

**P13 — Internal/technical terms and raw enum values in visible text.**
- Shift status raw English «open / submitted / reviewed» in مقدمات الحجز → «وردية الاستقبال» table (111) — labels exist (`labels` in finance-cash.js) but finance-advances.js prints `s.status`.
- Booking status printed raw (`e(c.status)` in finance-advances.js «الحجوزات والتأكيد»; 111 shows «confirmed»).
- Ledger entry source printed raw: «payment — 2026-11-17», «manual_correction — 2026-11-15» (186).
- Channel rules: «collected» under «الدفع» (136, channels table).
- Posted-entry lines show only account codes (0102010101, 4110) without names (186).

## 5. Inconsistent visual language

**P14 — 4 different button systems and 59 distinct button style combinations** (class|height|font|background) across the module (agg in harness/agg.json). Examples: pricing row actions «تعديل / حذف» are grey native-looking boxes (`btn-link`, 27px, bg #efefef, 006/002) while treasury row actions are blue outlined pills (`btn ghost sm`, 38px); «فاتورة زيارة تأمين» is a black-text white button next to blue-text siblings (103); primary «+ إضافة …» is filled blue in pricing/inventory but every treasury primary action («فتح وردية», «تسجيل تحصيل», «طلب صرف أو استرداد») is the same small ghost style as secondary actions — no primary action on any treasury screen. Group buttons are 48px on one row, 54px on others.

**P15 — Dialog styles differ.** Pricing dialogs: plain title, no ×, «حفظ» filled blue + «إلغاء» outline (004, 008). Treasury dialogs: blue banner header with ×, but «حفظ» is white outline and «إلغاء» blue-text (109, 112) — primary/secondary inverted vs pricing. Supply dialog «ربط المخزون» uses a native grey fieldset border (004). All dialogs carry a «شرح النموذج» button above the title.

**P16 — Three page-header patterns.** Pricing: small «رجوع للأقسام» + title, no banner (002). Treasury: big blue hero on every screen + blue group banner on overviews (101). Inventory: no title at all on the landing, group nav directly under sub-tabs (401). Back buttons say «رجوع للأقسام» (pricing, inventory) vs «رجوع إلى <group>» (treasury) and use different styles (btn vs btn ghost sm).

**P17 — Cards inconsistent.** KPI cards exist on الباكجز (3) but not on المستلزمات/الخدمات; treasury uses three different tile styles: `fc-st-card` (insurance/tax 163), doctor KPI cards with colored numbers (146), shift tiles with a dark «الإجمالي» tile (117), statement KPI cards (119); inventory KPI cards with «ج.م» (401).

## 6. Numbers and dates

**P18 — Number formats differ between screens.** Treasury: «1,500.00» (2 decimals, no currency); pricing: «252.4», «302.88», «995» (0–2 decimals, pills, no thousands consistency, 006); inventory: «225 ج.م», «5,428 ج.م» (no decimals, currency suffix, 401); movements: «+350.00 ج.م» (117). Negative numbers: «20.00-» / «6,050.00-» (trailing minus, 102, 186, 211) vs «-50.00 ج.م» (leading, 117).

**P19 — Three date formats on one screen + bidi.** Date inputs show «11/18/2026» (US mm/dd, browser locale); tables show «2026/11/18، 9:00:00 ص»; the status line text «2026-11-01» is rendered as «01-11-2026» in the RTL paragraph (status line on every treasury screen, 101-217; also P&L heading «18-11-2026 — 01-11-2026», 211). At 390 the stamp wraps mid-number: «202/11/18 ،6 / 9:00:00 ص» (102-390).

**P20 — Columns that repeat the same value in every row** (≥3 rows, from metrics): «الحالة والإجراء = مسجلة بيان الفاتورة» (103), «الإجراء = طباعة سند داخلي» (108), «الحساب = 0102010101 — الخزينة الرئيسية» and «الفرع / مركز التكلفة» in the treasury statement (119/188), «الخزينة = الخزينة الرئيسية» (statement), «طريقة السداد = —» on طلبات الصرف (133, (mock?) field name), «بدون قسم» under every service (006). Inventory balances/consumption columns all «0» are mock-driven. Suggestion: move constant values to the header.

## 7. Mobile (390 px)

**P21 — Tables cut off with the important columns hidden.** 36 of 51 screens have a horizontally scrolling table region at 390; amount/price/action columns are off-screen and only a partial header is visible: المستلزمات shows الاسم/نوع الوحدة/عدد الوحدات, price columns hidden (002-390); trial balance shows 3 of 6 columns, header «رصيد أول الفترة مدين / (د» cut (186-390); shifts table actions hidden (102-390). Only inventory shows a hint «اسحب الجدول أفقيًا…» (404-390). Codes wrap mid-number «0102010 / 101» (186-390); words break mid-word «للمراجع / ة» (102-390).

**P22 — Very long pages.** 390 heights: الأطباء والأتعاب 4,418 px (136-390), الخزائن 3,595 (117-390), التحصيل 2,731, الفواتير 2,707.

**P23 — Navigation eats the first screen on mobile.** Sub-tabs (3 stacked rows) + hero + 2 date inputs + «عرض الفترة» + 2-line status + 3 rows of group buttons ≈ 900 px before the section title (102-390, 186-390); inventory: sub-tabs + 3 rows of group buttons + Excel/PDF + location card + alerts ≈ 1,100 px before the table (404-390).

## 8. Floating buttons

**P24 — Help (?) and bot («سيا — المساعد الإداري») floating buttons overlap content** on 39/51 screens at 1440 and 44/51 at 390 (overlap with a button/cell at page top or bottom, metrics «float»). At 390 they sit on the group buttons «المحاسبة والأصول»/«الإعدادات» (101-390, 186-390) and on amount cells (103-390 «350.00», 108-390 «1,500.00»); at 1440 on the left-most action column (e.g. «مراجعة» 133). They stay above the modal backdrop (z-index) in every dialog (004, 109, 119). A toast «العملية لم تكتمل — عرض الحل» stacks in the same corner (_partial-run1/021).

## 9. Empty / loading / error states

**P25 — Generic empty state.** Treasury uses one sentence «لا توجد حركات في هذا العرض.» for every empty table (111 ×2, 136 «فواتير بقناة حجز»), no explanation or next action; inventory has a better pattern («لا توجد أصناف بعد / سيظهر هنا ما يضيفه مسؤول المخزن»). Doctor statement shows six «0.00» cards and two «مفيش فواتير…» lines (150).

**P26 — Loading state is text only.** «جاري تحميل الدورة المالية…» in the status line; statement/voucher dialogs open with «جاري…» text (120, 121, 187, 192); no skeleton; the reload button is not disabled during load. Error state (P3) is raw.

## 10. Brand / RTL

**P27 — Brand.** No English «Sono»/«SWNW» variants found in accounting text (scan on all 362 views). The Arabic name «سونو» appears in the header and in the field label «قسم الخدمة في سونو» (service dialog 007/008) and in printed documents («سونو — سند تحصيل داخلي», «سونو — بيان فاتورة داخلي», finance-cash.js / finance-controls.js print templates) — consistent with the Arabic brand; only flag if the owner wants «Swnw» on printed vouchers.

**P28 — Bidi glitches** besides P19: «VEZEETA — إصدار 1» (136 channels), «الكود EMP-000070 (كود الموظف…)» (138), «— 7,400.00 جنيه. اعتماد…» starting with a dash (125); statement description «مدين / قبض» repeated per row (119).

---

## Top 10 by impact on a non-technical clinic accountant
1. **P1** — shifts section crashes and traps the user (no back, no buttons, survives F5).
2. **P4/P23** — 5 stacked navigation bars; on mobile the first data row is ~1,100 px down.
3. **P5/P6** — 3 clicks + card landings to reach any treasury task; same tables/actions in 2–3 places.
4. **P8/P9** — up to 3 independent period filters (6 date inputs) and duplicate «تحديث»/«عرض الفترة» on one screen.
5. **P12** — paragraphs of policy text (up to 27 lines on الأطباء) before the tables.
6. **P21** — on 390 the amount/action columns are hidden in sideways-scrolling tables with no hint.
7. **P13/P3** — raw English values and JS error messages (open/submitted/reviewed, payment, manual_correction, collected, «Cannot read properties…»).
8. **P18/P19** — inconsistent money formats (2 decimals vs none vs ج.م, trailing minus) and 3 date formats with reversed ISO dates.
9. **P14/P15** — no visual primary action in the treasury; 59 button style combinations; dialogs with inverted حفظ/إلغاء.
10. **P24** — floating help/bot buttons cover group buttons, amounts and dialog content.
