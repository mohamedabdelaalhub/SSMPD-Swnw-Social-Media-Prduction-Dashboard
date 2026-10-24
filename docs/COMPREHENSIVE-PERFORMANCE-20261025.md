# Comprehensive Employee Performance — 2026-10-25

## Purpose
This system is for employee evaluation, coaching, follow-up and improvement only. It is **not** connected to payroll deductions or automatic financial penalties.

## Overall bands
- `< 60%` — سيئ / needs improvement
- `60–74%` — مقبول
- `75–84%` — جيد
- `>= 85%` — ممتاز
- If the sample is insufficient, the UI shows `نتيجة مبدئية` instead of assigning a definitive band.

## Composite dimensions
The comprehensive score re-normalizes weights across dimensions that have enough data.

- Attendance & discipline — 15%
- Task timeliness — 20%
- Work quality & accuracy — 25%
- Role-specific results — 30%
- Patient experience — 10%

## Core rules

### Attendance
Uses approved HR attendance records. Approved leave is excluded. Lateness, absence, early departure and missing checkout are tracked separately.

### Tasks
Task timeliness uses the employee's **first submission for review** versus the first submission deadline. Waiting for a manager after submission is not counted as employee delay. Manager review time is measured on the reviewer through `task_review_response_hours`.

Task quality includes first-pass acceptance versus returns for revision. Task priority affects weighting.

### Data quality
Registration-quality evidence is stored in `public.performance_evidence`.

Current automatic checks include missing/invalid patient basics and potential duplicate phone numbers. Potential duplicates are review-only and do not affect the score until confirmed. Name changes are not automatically treated as spelling mistakes because names require human verification.

Evidence lifecycle:
- `open`
- `fixed_by_employee`
- `fixed_by_other`
- `confirmed`
- `dismissed`

Early self-correction has a very small effect; unresolved or externally corrected confirmed problems carry more weight.

### Multiple roles
Permissions in `admin_extra_roles` are not assumed to be actual job workload. Each active employee defaults to the primary role at 100%. Management can set an explicit split (for example 60/40) only when the employee genuinely performs multiple job roles.

### Patient experience / Voice of Patient
Portal ratings remain linked to the concrete `patient_visit_id`.

Only dimensions that can be attributed reliably are used for an employee. General price/recommendation feedback remains center-level. Text comments are converted to review signals in `public.patient_feedback_signals`; a negative comment does not automatically lower an employee score. Management confirms or dismisses the signal first.

### Confidence
The overall result includes a confidence level and sample count. Weak samples stay provisional rather than producing a misleading definitive grade.

## Employee experience
`أدائي` shows:
- one primary comprehensive percentage and band
- trend versus the previous comparable period
- confidence and sample size
- dimension breakdown
- poor-performance warning when applicable
- concrete improvement steps
- registration-quality issues to correct
- relevant patient-experience notes

Role KPI cards remain supporting detail only and are not shown as a second overall score.

## Manager experience
`أداء الفريق` shows:
- comprehensive scores on staff cards
- counts by performance band
- employees who need an improvement plan
- detailed dimensions and coaching steps
- explicit actual-role allocation controls
- Voice of Patient review queue with Confirm / Dismiss

## Personal notifications
Open registration-quality issues are exposed through the existing personal inbox as **one aggregated notification**, not one notification per error. Opening it navigates the employee to `أدائي` for details.

## Database migrations applied live
Supabase migration history contains the authoritative SQL statements for:
- `performance_evidence_and_feedback`
- `comprehensive_staff_performance`
- `performance_role_allocation_defaults`
- `performance_clinical_quality_scope`
- `performance_management_tools`
- `performance_issue_context`
- `performance_supporting_indexes`
- `performance_personal_notifications`
- `aggregate_performance_personal_notification`

## Main frontend files
- `assets/js/employee-performance.js`
- `assets/css/employee-performance.css`
- `assets/js/render-mykpi.js`
- `config.js` (cache/version loader only)
