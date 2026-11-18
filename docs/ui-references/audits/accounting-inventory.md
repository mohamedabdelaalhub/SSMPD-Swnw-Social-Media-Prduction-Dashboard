# «الحسابات» — visual inventory (production state, origin/main 9605b24)

Rendered from the clean checkout `/tmp/claude-0/main-wt` (detached at origin/main 9605b24) with ALL CSS/JS that `index.html` loads, the in-memory Supabase client from `test/smoke.js` (user = super_admin «محمد عبدالعال»), and mocked finance/inventory RPCs (`harness/fixture.js`). No live server, no writes (all write commands reject with «معاينة فقط»).

- Screenshots: `/tmp/claude-0/qa/acc-audit/shots/` (362 files = 181 views × 1440 and 390 px, full page, deviceScaleFactor 1).
- Full file list with click paths: `screens-index.md`. Per-screen automatic counts: `metrics.md`. Raw data: `index.json`.
- File-name numbering: `0xx` pricing, `1xx`–`2xx` treasury, `4xx` inventory. `~dlg-` = modal dialog opened from that screen, `~page-` = in-place change (filter chip or link that rewrites the screen), `-SHIM` = see note on «الخزائن والورديات» below.
- **Depth** = clicks from opening the «الحسابات» tab. The tab opens on «التسعير والخدمات والباكجز» (depth 0; the harness records it as 1 because it clicks the sub-tab explicitly). Treasury: sub-tab (1) → group button (2; the first group «الخزائن والتحصيل» is open by default, so its sections are depth 2) → section card «فتح القسم» (3) → dialog/in-place page (4). Dialogs that open further dialogs (e.g. statement row → «فتح المستند») exist but were not crawled → real max depth is 5.
- Columns in the tables below: **b** = visible buttons (content area only, header excluded); **expl** = explanatory text blocks / rendered lines (paragraphs ≥25 chars outside tables); **dates** = date/month inputs on screen; **nav** = navigation levels stacked above the content.

## Fixed chrome on every accounting screen (counts toward nav levels)
1. App header (brand «مركز عيادات سونو التخصصية / الحسابات», user, 7 icon buttons, «خروج»).
2. Sub-tab bar `.tabs.acc-catalog-nav` — `render-accounting.js render()` — التسعير والخدمات والباكجز / الخزينة والدورة المالية / المخازن والجرد.
3. Floating help (?) and bot («سيا — المساعد الإداري») buttons, fixed bottom-left (not in accounting code; global).

## Tree

### A. التسعير والخدمات والباكجز — `assets/js/render-accounting.js` (landing of the tab)
nav levels: header → sub-tabs → section cards → section page (back «رجوع للأقسام»)

| Screen | Renderer | Purpose | Main actions | Content | Depth | b | expl | file |
|---|---|---|---|---|---|---|---|---|
| Sections landing | `renderSub()` (no section) | Pick catalog section | 3 cards «فتح القسم» | `.fc-group-intro` banner, 3 `.fc-section-card`, card «إعدادات خدمات الحجز تحتاج استكمال» (`renderCatalogIssues`) | 0 | 7 | 5/5 | 001 |
| المستلزمات والإضافات الطبية | `renderPricingScreen()` supplies | Unit cost of supplies | 🖨 طباعة, ⬇ Excel, رفع مستلزمات وأدوية Excel, + إضافة مستلزم, per row تعديل/حذف | `.acc-card` + table 7 cols; catalog-issues card repeated | 1 | 17 | 1/1 | 002 |
| الخدمات والتسعير | `renderPricingScreen()` services | Cost + margin → final price | طباعة, Excel, + إضافة خدمة, filter chips «كل الخدمات (n)» / «خدمات بدون أقسام (n)», تعديل/حذف | table 7 cols with colored pills | 1 | 16 | 1/1 | 006 |
| الباكجز | `renderPackagesScreen()` | Package price from services | طباعة, Excel, + إضافة باكج, تعديل/حذف | 3 KPI cards + table | 1 | 12 | 1/1 | 010 |
| Dialogs | `openSupplyModal / openServiceModal / openPackageModal` | add/edit | حفظ/إلغاء, «شرح النموذج», (service) «إعادة تحميل العقود» | long forms, fieldsets «ربط المخزون», «بيانات الطبيب من العقد», «الحجز والخدمات» | 2 | 3–8 | | 003-005, 007-009, 011-013 |

«فتح الإعداد الأصلي» (catalog-issues card) opens the same edit dialog (005/009/013).

### B. الخزينة والدورة المالية — `assets/js/finance-cash.js` (`render`, `draw`, `openSection`, `act`, `modal`) + panel layers chained through `window.SSMPDFinanceControls.panel(tab,…)`: finance-controls, finance-doctors, finance-channels, finance-doctor-payout, finance-doctor-accounts, finance-doctor-dues, finance-staff-insurance, finance-staff-tax, finance-staff-settlement (+ hr-offboarding), finance-contract-signature, finance-suppliers, finance-bank, finance-business, finance-reports, finance-advances, finance-treasury, ledger-editor, accountant-workspace, finance-statement-import, finance-account-statements, finance-shift-movements, reception-shared.

Workspace frame shown on every treasury screen (`render()`):
hero banner «الخزينة والدورة المالية» + «تحديث» → period form (من / إلى / عرض الفترة) → status line «الفترة … — آخر إقفال …» → 6 group buttons `.fc-group-nav` → (overview: group banner + section cards) or (section: «رجوع إلى <group>» + heading + actions + panel + footnote «القوائم تعرض ٢٠٠ سجل…» + السابق/صفحة/التالي).
**nav levels on a section screen: header, sub-tabs, hero, group nav, back+heading = 5 stacked bars before content.**

| Group (depth) | Section card (depth) | Renderer(s) | Purpose | Main actions | Tables/cards | b | expl | dates | files |
|---|---|---|---|---|---|---|---|---|---|
| الخزائن والتحصيل (1, default) — overview | — | `draw()` | 4 cards | — | 4 `.fc-section-card` | 15 | 7/7 | 2 | 101 |
| | الخزائن والورديات (2) | finance-cash `draw` (tab shifts) + accountant-workspace + finance-shift-movements | open/close shifts, hand-over to main treasury | فتح وردية, كشف الخزينة, سند قبض, سند صرف, سجل سندات الحسابات, إنهاء الوردية وتسليم النقد, طلب تسليم للرئيسية, مراجعة الاستلام, جرد وإغلاق, الحركات, مراجعة الوردية | 3 tables (my shift, handovers, all shifts) + «اللي حصّلته في ورديتك» tiles + «كل الحركات بالتفصيل» (own date filter, 6 chips, Excel/PDF) | 26 (34 with shim) | 4/4 (8/9) | 2 (4) | 102 (broken), 117-131 (shim) |
| | الخدمات والفواتير (2) | finance-cash + finance-controls + reception-shared | record executed services | فاتورة خدمة ومستلزمات, فاتورة زيارة تأمين, فاتورة خدمة لجهة, بيان الفاتورة, تسجيل تحصيل | invoices table 8 cols + «الحجوزات والخدمات المرتبطة» panel (second period filter) | 29 | 5/5 | 4 | 103-107 |
| | التحصيل (2) | finance-cash + finance-statement-import + reception-shared | collections + receipts | تسجيل تحصيل, طباعة سند داخلي, بيانات الإيصال | payments 8 cols, «إثبات الفيزا والتحويلات», reception panel | 28 | 4/4 | 4 | 108-110 |
| | مقدمات الحجز والتأكيد (2) | finance-advances + finance-statement-import | deposits, reception shift, confirmations | تسجيل مقدم, فتح وردية استقبال, جرد وتسليم, تجهيز تأكيد أو تذكير, بيانات الإيصال | 5 tables (reception shifts, advances, uses, bookings, messages, proof) | 19 | 7/12 | 2 | 111-116 |
| الصرف والمستحقات (2) — overview | | | 8 cards | | | 19 | 11/12 | 2 | 132 |
| | طلبات الصرف والاسترداد (3) | finance-treasury | one form for all disbursements | طلب صرف أو استرداد, مراجعة | 9-col table | 17 | 4/4 | 2 | 133-135 |
| | الأطباء والأتعاب (3) | finance-doctors + finance-channels + finance-doctor-payout + finance-contract-signature + reception-shared | contracts, rates, balances, channels | تعديل النص, حفظ (×2 enforcement dates), إعداد عقد, إضافة عقد, طلب صرف مستحقات, chips الكل/قيد الاعتماد/معتمد, search, per doctor الصورة والنشر/حساب الدكتور/إرسال للتوقيع, إضافة قناة أو منصة, إنهاء, إصدار جديد | 9 blocks: contract texts, enforcement dates, «أطباء… ملهمش عقد», contracts accordion, balances, invoice accruals, settlements, channels, channel dues, channel invoices, reception panel | 41 | 11/27 | 6 | 136-145 |
| | حساب الأطباء (3) | finance-doctor-accounts (+ finance-doctor-dues, finance-doctors statement) | who is payable now | تحديث, طلب صرف مستحقات, chips, search, per row فتح الحساب / صرف بالفواتير, doctor name button | 3 KPI cards + 9-col table + duplicate «أطباء… ملهمش عقد» table | 29 | 5/6 | 2 | 146-153 |
| | الموردون والمرتجعات (3) | finance-suppliers | supplier invoices, returns, POs | طلب سداد مورد, مرتجع أو تحصيل من مورد, استلام أمر شراء, مراجعة | 2 tables | 18 | 5/7 | 2 | 154-158 |
| | المرتبات والسلف (3) | finance-business | contracts, salary, advances | عقد أو استحقاق أو سلفة, طلب صرف راتب, مراجعة | 2 tables | 17 | 4/4 | 2 | 159-162 |
| | سداد التأمينات (3) | finance-staff-insurance | monthly social-insurance due/paid | month picker, تسجيل سداد للجهة | 8 stat cards + 2 tables | 16 | 4/4 | 3 | 163-164 |
| | سداد ضريبة المرتبات (3) | finance-staff-tax | monthly payroll tax | month picker, تسجيل سداد للمصلحة | stat cards + table | 16 | 4/4 | 3 | 165-166 |
| | مخالصات الموظفين (3) | finance-staff-settlement → hr-offboarding | end-of-service settlement | بدء إنهاء خدمة, نصوص المخالصة والشهادة, فتح | cases table | 17 | 4/5 | 2 | 167-170 |
| التسويات والمراجعة (2) — overview | | | 3 cards | | | 14 | 6/6 | 2 | 171 |
| | البنك والبطاقات (3) | finance-bank + finance-statement-import | statements, card settlements, reconciliation | رفع PDF أو Excel أو CSV, إدخال كشف حساب, طلب تسوية بطاقات, تقرير التطابق والاختلافات, مراجعة, details «ربط ماكينة…» | 4 tables | 19 | 4/4 | 2 | 172-176 |
| | التأمين (3) | finance-controls + finance-bank + reception-shared | insurance claims, aging, follow-up | فواتير ومطالبات الجهات, تسجيل مطالبة, معالجة مطالبة أو تحصيلها, مراجعة, تسجيل متابعة | 4 tables | 20 | 6/6 | 4 | 177-182 |
| | فروق الخزينة (3) | finance-controls | cash difference cases | استكمال المسار | 8-col table | 16 | 4/4 | 2 | 183-184 |
| المحاسبة والأصول (2) — overview | | | 5 cards | | | 16 | 8/8 | 2 | 185 |
| | القيود وميزان المراجعة (3) | ledger-editor + finance-account-statements | trial balance + posted entries | الأستاذ العام والمساعد, كشف الخزينة, سند قبض, سند صرف, سجل سندات الحسابات, إضافة قيد, المسودات والمراجعة, الشجرة المحاسبية, فتح العملية الأصلية, إلغاء بقيد عكسي, تصحيح بعكس وبديل | trial balance 6 cols + one card per entry with its own table | 26 | 4/4 | 2 | 186-196 |
| | الأرصدة والتصحيحات (3) | ledger-editor + finance-reports | journal drafts / corrections | إضافة قيد — مسودة, تعديل, إرسال للمراجعة, مراجعة | 2 tables | 21 | 5/7 | 2 | 197-201 |
| | الشجرة المحاسبية (3) | accountant-workspace `chart()` | chart of accounts tree | إضافة حساب, استيراد شجرة من Excel, search, 5 root cards each «+» expanding nested nodes | tree cards | 105 (incl. tree nodes) | 10/10 | 2 | 202-203 |
| | الأصول والإهلاك (3) | finance-business | fixed assets / legacy import | تسجيل طلب, مراجعة الاستيراد | 3 tables | 16 | 4/4 | 2 | 204-206 |
| | الضرائب (3) | finance-business | tax liabilities | تسجيل طلب, مراجعة | table | 16 | 4/4 | 2 | 207-209 |
| التقارير والرقابة (2) — overview | | | 2 cards | | | 13 | 5/5 | 2 | 210 |
| | القوائم المالية (3) | finance-reports | P&L, balance sheet, cash flow | طباعة القوائم | 3 tables + 2 summary lines | 15 | 7/7 | 2 | 211 |
| | سجل المراجعة (3) | finance-cash (tab audit) | audit trail | — | 5-col table | 14 | 3/3 | 2 | 212 |
| الإعدادات (2) — overview | | | 1 card | | | 12 | 4/4 | 2 | 213 |
| | إعدادات الخزن والإقفال (3) | finance-cash + accountant-workspace | registers, limits, period close | إضافة خزينة, إقفال فترة, إعدادات الخزينة | registers table | 19 | 5/5 | 2 | 214-217 |

Treasury dialogs (all `finance-cash.js modal()` or the layer's own modal, depth = section+1): listed with files in `screens-index.md`; notable large ones: كشف الخزينة / الأستاذ العام والمساعد (`finance-account-statements.js`, own branch/period filter + 4 KPI cards + 10-col table, 31 buttons; 119, 187, 188), حساب الدكتور (statement, 6 KPI cards; 144, 150-153), سند صرف (121/190), إضافة قيد (192/198).

### C. المخازن والجرد — `assets/js/render-inventory.js` (`render`, `nav`, `subnav`, `GROUPS`) + inventory-workspace.js (locations, transfers, counts, imports), inventory-supplies.js (staff requests), inventory-tracking.js, inventory-patient-supplies.js, inventory-catalog-import.js
Frame on every screen: group nav (الرئيسية/المخزون/العمليات/الجرد/التقارير) → تصدير Excel, طباعة / PDF → «المكان» card (location select + «إدارة الفروع والمخازن») → «تنبيهات تحتاج متابعة» → content. nav levels on a view: header, sub-tabs, group nav, back «رجوع للأقسام» + heading = 4.

| Group | View (depth) | Purpose | Main actions | Content | b | dates | files |
|---|---|---|---|---|---|---|---|
| الرئيسية (1) | نظرة عامة | stock summary | تمت المراجعة (alerts), إدارة الفروع والمخازن | 7 KPI cards + summary table | 20 | 0 | 401-402 |
| المخزون (2) | overview | 2 cards | | | 13 | 0 | 403 |
| | الأصناف والأسعار (3) | item master + prices | رفع أصناف Excel, تسجيل هالك, + إضافة صنف, تعديل, search/category/status filters | 1 table | 29 | 0 | 404-408 |
| | الأرصدة حسب المكان (3) | per-location balances | — | 1 table | 14 | 0 | 409-410 |
| العمليات (2) | overview | 5 cards | | | 16 | 0 | 411 |
| | التوريد والطلبات (3) | purchase/issue requests | + طلب جديد, تسجيل الاستلام, موافقة, رفض | 2 tables | 22 | 2 | 412-417 |
| | التحويلات (3) | transfers between stores | طلب تحويل, التفاصيل والإذن, موافقة مسؤول المخزن, موافقة المدير, رفض | 1 table | 20 | 0 | 418-424 |
| | صرف للاستخدام داخل المركز (3) | internal consumption | صرف مستلزم إضافي لمريض, فتح التحويلات, تسجيل الصرف للاستهلاك | forms | 17 | 0 | 425-429 |
| | بيع مستلزمات لمريض (3) | patient sale | «فتح فواتير الخدمات والمستلزمات» (jumps to treasury invoices) | text only | 15 | 0 | 430-432 |
| | طلبات الموظفين (3) | staff supply requests | — | **not rendered with data** (no mock for `inventory_supply_snapshot`); shows error state | 15 | 0 | 433-434 |
| الجرد (2) | overview | 2 cards | | | 13 | 0 | 435 |
| | جلسات ومواعيد الجرد (3) | stock counts + schedule | طلب جرد خلال فترة, إعداد الجرد الشهري, إدخال الجرد/متابعة | 2 tables | 17 | 0 | 436-440 |
| | رفع Excel وإدخال فردي (3) | opening balances import | إدخال صنف, upload | form + table | 17 | 0 | 441-443 |
| التقارير (2) | overview | 3 cards | | | 14 | 0 | 444 |
| | تقارير الاستهلاك (3) | consumption + reorder suggestion | إنشاء طلب توريد بالكميات المقترحة | 3 tables | 16 | 2 | 445-447 |
| | سجل الحركات (3) | movement log | filters | 1 table | 15 | 2 | 448-449 |
| | سجل أكواد التتبع (3) | tracking codes | — | not mocked (`inventory_tracking_codes`) → empty | 16 | 0 | 450-451 |

«إدارة الفروع والمخازن» (inventory-workspace) is on every inventory view and opens the same in-place locations page (402, 405, 410, …).

## Totals
- Distinct views captured: **181 per width** (51 screens, 102 dialogs, 28 in-place pages) → 362 PNGs.
- Max navigation depth reached: **4 clicks** (treasury: sub-tab → group → section → dialog); 5 for dialogs opened from dialogs (not crawled).
- Navigation levels stacked above content: pricing 3, treasury 5 (+ in-section chips/accordions and in-dialog filters), inventory 4.

## Out of scope / could not render with mocks
- «الخدمات ولوائح الأسعار» (price_lists: contract-price-workspace.js, price-list-governance.js, workforce-prices.js) is a separate top-level tab, not under «الحسابات» — not captured.
- «طلبات الموظفين» (inventory-supplies.js) and «سجل أكواد التتبع» have no fixture → error / empty state only.
- «حساب الدكتور» statement shows 0.00 everywhere: the statement RPC shape in the fixture does not match what the dialog reads (values are mock artefacts, layout is real).
- The receipt/invoice print windows (`window.open`) were stubbed, not captured.
- Modal dialogs taller than the viewport scroll internally; full-page screenshots show only the first viewport of such dialogs.
- «الخزائن والورديات» crashes in production for a reviewer (see problems.md P1); the `-SHIM` shots (117-131) define `window.db = SSMPDDb` only to show the intended layout.
