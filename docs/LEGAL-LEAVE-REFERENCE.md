# Leave: legal reference (owner request 2026-11-15)

The owner asked: «مش عايزين نخالف القانون عن جهل بيه». Keep this file as the reference for any leave rule built into the dashboard. The text below is a faithful summary of the official PDF the owner supplied. When in doubt, read the official text and check with the legal advisor or the accountant.

## ⚠️ Which law applies to Swnw?

The file supplied is **Law No. 81 of 2016, the Civil Service Law** (Official Gazette, issue 43 bis (A), 1 November 2016).

Its issuing article 1 limits it to **jobs in ministries, government departments and bodies, local administration units and public authorities** (الوظائف في الوزارات ومصالحها والأجهزة الحكومية ووحدات الإدارة المحلية والهيئات العامة).

**Swnw is a private clinic, so this law does not govern its staff.** Private-sector employment falls under the **Labor Law No. 14 of 2025** (Official Gazette, issue 18 (cont.), 3 May 2025), supplied by the owner on 2026-11-15. **Its articles below are the binding source.** The Civil Service figures further down are a comparison only.

## ✅ Labor Law 14/2025: leave chapter (Part 5, articles 124–133) — binding

| Article | Topic | Rule |
|---|---|---|
| 124 | **Annual leave** | Paid. Official holidays and weekly rest days are **not** counted in it. **15 days** in the first year; **21 days** from the second year; **30 days** after 10 full years with the same employer, or after age 50; **45 days** for people with disabilities and dwarfism. Under one year of service: pro rata, provided the worker has served at least 6 months. +7 days for hazardous or remote work (by ministerial decree). |
| 125 | Scheduling annual leave | **The employer sets the dates** by work needs, and may not cut a leave short except for strong reasons. The worker may not waive the leave. Every year the worker must get at least 15 days, **6 of them consecutive**. The employer settles the balance, or pays its cash value, every 3 years at most. On leaving, the unused balance is paid in cash. No splitting, merging or postponing for children and people with disabilities. |
| 126 | Exams | Notice of at least 15 days to take annual leave for exams. Paid study leave for the actual exam days, not from the annual balance, with 10 days' notice and proof of sitting the exam. |
| 127 | Working elsewhere during leave | The employer may withhold or recover the leave pay, with no prejudice to discipline. |
| 128 | **Casual leave (عارضة)** | Up to **7 days a year**, **at most 2 days at a time**, and **deducted from the annual leave**. A worker whose child is born gets **1 paid emergency day** on the birth day, not deducted, at most 3 times in a career. |
| 129 | Official holidays | Paid. Work on them is allowed when needed, against **double pay** for the day, or a compensatory day at the worker's written request. |
| 130 | Hajj / Jerusalem | After 5 continuous years: one month paid, once in a career. |
| 131 | **Sick leave** | Granted by the competent medical authority. Pay compensation (rate and duration) follows the **Social Insurance Law**; the employer deducts what social insurance pays from the wage. Industrial establishments (Law 15/2017): every 3 years of service, 3 months full pay, then 6 months at 85%, then 3 months at 75% if recovery is likely. The worker may use the annual balance on top of sick leave, or ask to convert sick leave to annual leave if the balance allows. |
| 132 | Contact with an infectious patient | The medical authority may keep the worker off work, up to 3 months. |
| 133 | Medical unfitness | Established per the Social Insurance Law. |
| 173 | Dismissal for illness | Forbidden until the worker has used his sick leave and his annual balance. |

**Not found in the leave chapter:** a legal notice period for requesting leave, and a 24-hour sick-notice rule (that was Civil Service art. 51). Both are therefore **internal clinic rules**, allowed as long as they do not cut a legal entitlement.

## Civil Service Law 81/2016: leave chapter (Part 6, articles 46–56)

| Article | Topic | Rule |
|---|---|---|
| 46 | Working week | 35 to 42 working hours a week; no absence except on an authorised leave. Otherwise pay is lost for the period, plus disciplinary liability. |
| 47 | Official holidays | Full pay. Work on them is allowed when necessary, against equal extra pay or a compensatory day. |
| 48 | **Casual leave (عارضة)** | Up to **7 days a year**, **at most 2 days at a time**. |
| 49 | **Annual leave** | Full pay; official holidays are not counted in it, except the weekly days off. **15 days** in the first year, after 6 months of service. **21 days** after one full year. **30 days** after 10 years. **45 days** after age 50. **45 days** for employees with a disability. It may not be shortened, postponed or cut except for national reasons. |
| 50 | Using annual leave | The employee must apply to take it in full. The employer may carry over at most one third, for work reasons, for at most 3 years. If not requested, the right lapses. If requested and refused, it is paid in cash after 3 years. |
| 51 | **Sick leave** | One sick leave per each 3 years of service, granted by the competent medical board. **First 3 months: full pay. Next 3 months: 75%. Next 6 months: 50%** (75% for employees over 50). It can be extended without pay. It can be converted to annual leave if there is a balance. **The employee must notify the workplace within 24 hours** of stopping work for illness, unless force majeure prevents it. Chronic diseases: an exceptional leave with full pay. |
| 52 | Special leave, full pay | Hajj: 30 days, once in a career. Maternity: 4 months, at most 3 times. Contact with an infectious patient. Work injury. Exam days for students. |
| 53 | Leave without pay | A spouse travelling abroad; other reasons at the employer's discretion; child care: up to 2 years each time, 6 years over a career. |
| 54–56 | — | Part-time work; conscripts; no paid work for others during a leave. |

## What the dashboard follows (owner decisions 2026-11-15, migration `20261116100000_hr_leave_rules.sql`)

Each leave request has a type (`clinic_people.requests.leave_type`):

| Type | Rule | Balance |
|---|---|---|
| Annual (سنوية) | Notice before it starts: 1 day → 2 days; 2–3 days → 3; 4–7 days → 7; over 7 days → 14 (internal rule). | Annual balance |
| Casual (عارضة) | Reported the same day, no notice. **Hard legal caps:** 2 days at a time, 7 a year (art. 128). **Pacing (owner):** at most 2 days a calendar month and 3 a calendar quarter. | Annual balance (art. 128) |
| Sick (مرضية) | Reported before the shift, or the same day in an emergency. Medical certificate (a link) within 48 hours. Until then, the fingerprint run waits; after that, the day is an absence. | Not deducted |
| Child birth (ولادة طفل) | 1 day, at most 3 times (art. 128). | Not deducted |
| Excused (استثناء من غياب) | Management only: excuses a day already counted absent. | Not deducted |

**Exceptions (owner: «موافق مع توفير استثناء»):**
- A request outside the internal rules is accepted only with a written exception reason. It is marked with what it breaks.
- The reviewer, who is never the person who filed it, decides. The reviewer's note is recorded as the exception, under the reviewer's name (`exception_by`).
- **Any other HR reviewer** can approve: short notice, a retroactive annual or casual leave, and casual pacing.
- **Only the general manager or super admin** can approve: sick leave without a certificate in 48 h, sick leave reported after its day, and an excused absence. Owner decision: «حتى لو مابلغش والداشبورد حسبته غياب وطلع الظرف فعلًا قوي، يمكنني استثناء الشخص من الخصومات بشكل عكسي».
- Legal caps (2 casual days at a time, 7 a year, 3 birth days) are never bypassed.

**Reversing a deduction:**
- Once the leave is approved, a recalculation no longer counts those days as absent.
- If that month's salary was already sent to finance, a **pending** «رد خصم غياب» bonus is created for the current month, at the rule's absence-day rate. A different HR reviewer approves it.

**Work on an official holiday (art. 129): a compensatory day, at the employee's written request** (owner decision 2026-11-15; migration `20261116110000_hr_holiday_comp_day.sql`). The owner chose this instead of double pay.
- Request kind `holiday_comp` («يوم بديل عن شغل في إجازة رسمية»): one day of an **approved center closure** (20261115230000) on which the employee actually worked (a check-in punch, or an approved attendance row). It is filed today or later, once per day, and the note is the written request.
- A different HR reviewer approves it. Approval adds one approved `leave_credit` day to the annual balance, linked by `source_request_id` and audited as `holiday_comp_credit`.
- ⚠️ The law gives the compensatory day **at the worker's written request**. A worker who does not request it is still owed double pay for that day; that case is left to HR.
- Test: `tests/hr-holiday-comp-sql.cjs`.

**Not implemented yet:** automatic annual entitlement (15/21/30/45 days) and the 6-consecutive-days rule. HR still adds the yearly balance by hand («إضافة رصيد إجازات»).

Tests: `tests/hr-leave-rules-sql.cjs` (it also applies the rollback) and `tests/hr-leave-rules-dom.cjs`. Rollback: `supabase/rollbacks/20261116100000_hr_leave_rules.rollback.sql`.
