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
