# HR job catalog («دليل الوظائف») — owner approved the mockup 2026-11-21

- Table `clinic_people.jobs` (code, titles, department, tasks, qualifications, experience, KPIs `{name,target,kind:auto|manual}`, incentive text,
  salary band). `clinic_people.people.job_id` links each employee to ONE job, separate from the dashboard role (`admins.role`). Doctors are out of scope.
- All access goes through `SECURITY DEFINER` RPCs (table has RLS and no direct grants): `hr_jobs`, `hr_job_save` (owner level only), `hr_job_assign`
  (HR managers), `hr_job_band`, `hr_my_job` (own job, no pay), `hr_job_annex` (annex data).
- Salary band / approved figure are returned **only** to `super_admin`, `accountant`, `financial_manager` (`clinic_people.salary_visible()`); other HR users
  never receive the columns. The audit rows carry the job title only, never figures. The seed migration holds **no** salary figures (owner rule): bands are
  entered live from the catalog screen.
- Band check = warning only. Salary source: the approved employment contract (`business_requests`, `payload.base`) valid today, found via `people.finance_subject`.
- KPI targets are set by super_admin + the administrative manager; «manual» KPIs are rated by the direct manager and approved by super_admin — only the
  definition is stored now, the rating workflow comes later.
- UI: `assets/js/hr-job-catalog.js` (HR tab «دليل الوظائف», block «الوظيفة في الدليل» in the employee file, «وظيفتي»), `assets/css/hr-job-catalog.css`.
  The contract annex prints through `SSMPDPrint` on the official letterhead, logo only (see `docs/ui-references/PRINT-DOCUMENTS.md`).
- Tests: `tests/hr-job-catalog-sql.cjs`, `tests/hr-job-catalog-dom.cjs`. Mockup: `docs/ui-references/mockups/job-catalog.html` (branch `job-catalog-mockup`).
