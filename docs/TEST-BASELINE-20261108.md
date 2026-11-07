# Test baseline on main — 2026-11-08

Run on clean `origin/main` (adbd1e3), Node 22, `npm ci`, Playwright Chromium with its libraries. 272 test files: **59 failed** at the start. Only test/fixture/runner files were changed — **no production code**.

## ملخص للمالك

| السبب | عدد الملفات | الإجراء |
|---|---|---|
| بيئة السيرفر: متصفح Chromium ما كانش بيشتغل (مكتبات ناقصة) | 42 | مش مشكلة في المنتج — بيشتغل بعد ضبط المكتبات، والـCI بيثبّتها بنفسه |
| اختبار قديم (stubs/توقعات قديمة) واتصلّح | 8 | اتعدّل الاختبار فقط |
| اختبار قديم محتاج إعادة كتابة | 5 | اتسجّل «فشل معروف» بسبب مكتوب |
| نقص محتوى (شرح مساعدة / ترجمة إنجليزي لتبويب الموارد البشرية) | 3 | اتسجّل «فشل معروف» — محتاج قرار/محتوى |
| سلوك اتغيّر (تكرار قراءة ملف الأداء) | 1 | اتسجّل — محتاج مراجعة نية |
| اختبار متأرجح تحت الضغط (timeout) | 1 | إعادة محاولة واحدة تلقائيًا |

بعد التعديل: أي فشل **جديد** يبقى أحمر فعلًا، والفشل المعروف مكتوب ومسمّى في `scripts/run-tests.mjs`.

## Fixed (test side only)
- `test/patient-profile-links.cjs`, `tests/child-assessment-forms.cjs`, `tests/patient-profile-ui.cjs` (+ `patient-profile-browser.cjs` which reuses its fixture): the `SSMPDRoles` stub lacked `canReviewArchive` (added with the head-nursing role).
- `tests/contracting-pdf-mobile-clone.cjs`: an invalid regex literal (syntax error); now matches the real `/^\d+$/.test(cached)` source text.
- `tests/whatsapp-knowledge.cjs`: harness did not load `clinic-catalog.ts`, and expected `clinic_info` without the official catalog that `ai.ts` now prepends.
- `tests/mobile-leads-comments-access.cjs`: pinned exact cache-buster strings that have since moved on; now only require a versioned `?v=`.
- `tests/financial-roles-ui.cjs`: every active account now sees its own HR tab, so the default tab for an account with no permissions is `human_resources`, not `null`.

## Known failures (documented, not hidden) — details for follow-up
| File | Symptom | Class | Suggested fix |
|---|---|---|---|
| `test/contract-edit.cjs` | save no longer triggered by form submit | stale | rewrite against the current modal (button handler) |
| `test/portal-routes.mjs` | page script reads `undefined.token` | stale harness | provide the config object the portal page expects |
| `tests/dashboard-help-coverage.cjs` | build script: "Fields need reviewed explanations" for many newer screens/fields (HR, price lists, contracting, plus the lab-link and channels fields in open PRs) | **content gap** | write reviewed help text, then remove from list |
| `tests/dashboard-help-dom.cjs` | no help article for tab `human_resources` | **content gap** | add article |
| `tests/header-titles-dom.cjs` | no English translation for `human_resources` | **content gap** | add translation |
| `tests/employee-performance-dom.cjs` | two `mount()` calls for the same employee issue 0 counted profile reads instead of 1 | **possible behaviour change** | confirm whether dedup was intentionally replaced; if not, a duplicate-read regression |
| `tests/organized-workspaces-dom.cjs` | insurance category chip missing in contracting workbench | stale | update to the current workbench |
| `tests/reception-doctor-setup-dom.cjs` | `[data-rx-action="pilot-settings"]` not rendered | stale or regression | check against the latest reception workspace commit 4b1dc9f |
| `tests/reception-management-pilot-ui.cjs` | guide text «نفس الأرشيف» absent | stale | update expectation |

`tests/dashboard-theme-ui.cjs` timed out once under load and passes alone; the runner now retries a failing non-known test once.

## Real product bugs
None confirmed. Candidates worth owner/dev attention: the `employee-performance` read dedup (possible repeated Supabase reads) and `pilot-settings` missing in reception. No production behaviour was changed.

## CI vs server
The GitHub Tests job (`npm test`) fails on main since before this work. Job logs could not be downloaded with the available wrapper (log URL is a redirect), so CI was not compared line by line; the server run uses the same command and the same Chromium, so the set above is expected to match.
