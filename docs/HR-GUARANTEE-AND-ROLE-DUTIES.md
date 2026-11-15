# HR: guaranteed minimum pay and role-followed duties (2026-11-15)

Owner decisions taken in the employee-import chat on 2026-11-15. No salaries or personal data appear in this file.

## 1. «حد أدنى مضمون» (guaranteed minimum)

Some specialists get a monthly salary **or** their commission, whichever is higher, never both.

- New column `clinic_people.pay_rules.guaranteed_minimum` (default `false`). It is set on the pay rule and reviewed with it, through the same four-eyes `rule` → `rule_review` flow.
- `hr_payroll_calculate` keeps everything it did before. Only when the flag is on, it also reads the commission earned in the month:
  - doctor-ledger fees (`clinic_finance.doctor_accruals`) on invoices created in that month (Cairo date), for the person's `doctor_key`;
  - plus approved employee `commission` adjustments.
- The doctor ledger keeps paying its own fees. Payroll adds `guarantee_offset = least(commission, base)` to the salary deduction. So salary paid + commission paid = max(base, commission).
  - Lateness, absence and overtime still apply.
  - The total deduction never exceeds salary + allowance, so the existing finance guard still holds.
- The calculation returns `guaranteed_minimum`, `doctor_commission` and `guarantee_offset`. The payroll screen shows them as two extra rows.
- Note: fees count in the month their invoice was issued. The ledger may release them later, when the invoice is collected.
- Tests: `tests/hr-pay-guaranteed-minimum-sql.cjs` (SQL) and `tests/hr-role-duties-dom.cjs` (screen).

## 2. Employees without an account are followed by a role

Cleaning staff, for example, have no dashboard account. Their duties must follow a **role**, such as general manager, not a named person. When that person leaves, the next one in the role inherits the duties.

- `clinic_people.people.manager_role`: set only by HR, with `hr_set_manager_role(person, role)`. It needs an active account holding that role, and it is audited in `clinic_people.audit`.
- `task_create_recurring_for_person(...)`:
  - creates a normal recurring task, assigned to the current role holder;
  - marks the series and its copies with `for_person_id`;
  - adds the employee's name and code to the description.
- `task_sync_role_owners()` runs every minute through the existing recurrence cron, and right after an HR change. When the role holder changes:
  - the series moves to the new holder;
  - open copies move to the new holder, who gets a notice;
  - done and cancelled copies keep their history.
- The holder is the oldest active account whose main role is that role, then extra roles.
- HR profile screen: for staff without an account, a «متابعة مهام الموظف (بدون حساب دخول)» block lets HR:
  - pick the role;
  - add daily, weekly or monthly duties, in task projects that HR manages.
- Tests: `tests/hr-role-manager-tasks-sql.cjs` (SQL) and `tests/hr-role-duties-dom.cjs` (screen).

## Applying on the live server

Migrations: `20261115100000_hr_pay_guaranteed_minimum.sql`, `20261115110000_hr_role_manager_tasks.sql`.

Both migrations redefine existing functions with `create or replace`, copied from the repository:
- `hr_payroll_command` and `hr_payroll_calculate`, from `20261024183400`;
- `task_generate_due_recurrences`, from `20261112150000`.

Before applying, compare the live `pg_get_functiondef` of these three with the repository. Stop if the live versions have drifted.

## 3. Replacing an approved pay rule (supersede)

An approved pay rule could not be changed or ended. Any corrected rule was then refused by the overlap guard. For example, two rules approved before «حد أدنى مضمون» existed could not have the option turned on.

- `pay_rules.supersedes` points to the approved rule of the same person that a new pending rule replaces. A new status, `superseded`, exists.
- Nothing changes until a different reviewer approves the new rule. On that approval, in the same transaction, the old rule is either:
  - marked `superseded`, when the new rule starts on or before the old one's start; or
  - shortened to the day before the new rule starts.
- The change is audited as `rule_superseded`, with before and after data. A rejected replacement leaves the old rule untouched.
- Without `supersedes`, overlapping rules are still refused.
- Screen: «قواعد حساب الأجر» has a «تحل محل قاعدة معتمدة» choice.
- Migration: `20261115120000_hr_pay_rule_supersede.sql`. It redefines `hr_payroll_command` from `20261115100000`.
- Test: `tests/hr-pay-rule-supersede-sql.cjs`.

## 4. The fingerprint is the basis of payroll attendance

Owner decision 2026-11-15. Until this change, punches and shift schedules fed only the live board and the reports. Payroll read `clinic_people.attendance`, which was filled by hand or from an Excel file.

`hr_attendance_from_punches(month)` (HR managers only) covers every completed day of the month, up to yesterday (Cairo). It turns the day's shift and punches into **pending** attendance rows, through the existing governed import (`hr_payroll_command 'import_attendance'`).

How each day is filled:
- **Scheduled start and end:** from the shift template, the same as the live board.
- **Arrival:** the first check-in punch.
- **Leaving:** the last check-out punch, up to 6 hours after the shift end.
- **No arrival punch:** the day is recorded as an absence.
- **Approved leave:** no row is created, so the day is never counted as absent.
- **Approved permission:** excuses that day's lateness or absence.
- **Arrival but no exit punch:** leaving is set to the shift end (no overtime), and the note says so.

Rules for the run:
- Days that already have a row are never touched, and running it again adds only the new days.
- People without a fingerprint code are listed for HR to map. They are never recorded as absent.
- A **different** HR reviewer approves the whole batch with «مراجعة ورديات الملف», or day by day. Payroll then computes lateness, absence and overtime with the person's approved pay rule.

On screen: «الحضور والورديات» → «تحويل بصمات الشهر للمراجعة».

Migration: `20261115130000_hr_attendance_from_punches.sql` (additive, one RPC). Test: `tests/hr-attendance-from-punches-sql.cjs`.

## 5. «تبديل وردية» (shift swap)

Owner approval 2026-11-15, in the main chat. Migration `20261115200000_hr_shift_swaps.sql`; rollback `supabase/rollbacks/20261115200000_hr_shift_swaps.rollback.sql`.

**Flow:**
1. The employee requests the swap for himself; HR can request on anyone's behalf.
2. The colleague accepts or declines. HR can answer for a colleague, but not the HR person who filed the request.
3. An HR manager approves or rejects, with a reason. The approver must be neither the person who filed the request nor the person who accepted it.
4. Notifications go to the people involved, through `task_notifications` with no task.
5. Before approval, a request can be withdrawn. After approval, HR can reverse it with a reason. Every step is audited (`shift_swap_*`).

**The two kinds:**
- **`same_day`:** the two people exchange their shift times on that day.
- **`cross_day`:** «أشتغل يومك وتشتغل يومي». The requester is off on his working day A and works the colleague's day B with her shift. The colleague is off on day B and works day A with his shift.

Both people must have a weekly schedule on those days. Any other active or pending swap on the same person-day is refused.

**What approval writes:** `clinic_people.shift_overrides` rows, one per person and day; a null template means off that day. These override the weekly `person_shifts` for that date only.

**Effect on attendance:**
- `clinic_people.attendance_eval` keeps its signature and reads the overrides. It feeds the live board, `hr_attendance_today`/`range` and `hr_attendance_from_punches`.
- A person who is off because of a swap is `leave`, named «إجازة بتبديل». They are never absent, no attendance row is created, and payroll makes no deduction.
- The person working the extra day is scheduled with that day's shift. Punches stay the source of actual times.

**Screen:**
- HR: a «تبديل الورديات» block under the weekly grid in the shifts tab.
- Employees: the same block in «حضوري ووردياتي».

**Before applying:** the body of `attendance_eval` = `20261113100000` + the override step. Compare the live body with `20261113100000` first.

**Tests:** `tests/hr-shift-swaps-sql.cjs` (it also applies the rollback) and `tests/hr-shift-swaps-dom.cjs`.

### 5b. Swap rules and «يوم بديل» (owner decisions 2026-11-15)

Migration `20261115210000_hr_shift_swap_rules_credit.sql`. Rollback: `supabase/rollbacks/20261115210000_hr_shift_swap_rules_credit.rollback.sql`; it refuses while any cover or credit swap exists.

**Rules:**
- **Same department only:** a swap is allowed only between people of the same department (استقبال مع استقبال، تمريض مع تمريض).
- **24 hours' notice:** a swap is requested at least 24 h before the first shift it touches. An HR manager can file a same-day emergency (`emergency`).
- **No consecutive-days block:** the owner didn't want one.

**«يوم بديل» (replacement day):**
- **`cover`:** the colleague, who is free that day, works the requester's day. On approval the colleague earns a credit (`clinic_people.shift_credits`), valid for 30 days from the covered date.
- **`credit_use`:** the credit holder takes one of their working days off within that validity. There is no colleague step: a different HR manager approves, and the oldest valid credit is used.
- **Lapse:** an unused credit lapses when it expires. It is not paid.
- **Reversals:** reversing a use gives the credit back. A cover can't be reversed while its credit is in use; reversing the cover voids the credit.

**Tests:** `tests/hr-shift-swap-rules-credit-sql.cjs`; `tests/hr-shift-swaps-dom.cjs` is extended.

## 6. «يوم كامل» counts as two shifts in payroll

Owner decision 2026-11-15: «دي بتتحسب شفتين مش شفت واحد». Migration: `20261116120000_hr_double_shift_payroll.sql`. Rollback: `supabase/rollbacks/20261116120000_hr_double_shift_payroll.rollback.sql`.

A scheduled attendance row longer than 12 hours (the «يوم كامل» template, 08:00–00:00) counts as **two shifts**, split at its midpoint:
- **Absent the whole day:** 2 absences (2 × `absence_day`).
- **Worked only one half:** 1 absence. That is, arrived at or after the midpoint, or left at or before it.
- **Worked the whole day:** 2 shifts, with no absence.
- **Came only for the second half:** lateness counts from the midpoint (16:00), not from 08:00.

`approved_shifts` counts a full day as 2. Ordinary shifts are unchanged.

**Punches:** one check-in and one check-out are enough. If staff punch four times, the system takes the first check-in and the last check-out, and the break in the middle is not deducted.

**One exception:** a day with no exit punch is completed to the shift end by `hr_attendance_from_punches`, with a note. If someone worked only the morning and did not punch out, the reviewer has to correct that row before approving it.

**How it is applied:** the migration patches the live body of `hr_payroll_calculate` in place, the same technique as the center-closures migration. It refuses to run if the expected fragments are missing, so a drifted body is never half-patched.

**Test:** `tests/hr-double-shift-payroll-sql.cjs`.
