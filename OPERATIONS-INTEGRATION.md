# Indicator reports, issues and accountable actions

Implementation date: 2026-10-17. This file describes the code contract, not proof of live activation.

## Ownership and identity

The indicator project is `raocrmssjqsozibniujc` (`sono-dashboard`). This dashboard uses `uuijfbpgvtdxgaosqpxo`. They retain separate Auth and database policies. Reports are sent only after indicator management approves them. Their financial snapshots are readable only by this dashboard's active super admin/general manager. An employee receives their existing authorized tasks and the assigned issue context, not access to report tables.

## Activation order

1. In this project, apply `supabase/migrations/202610170001_indicator_actions.sql` after the existing tasks and personal-home migrations. It creates additive tables, RPCs and task timing metadata. It preserves existing task creation, assignment and review permission functions. Validate RPC grants and RLS.
2. In the indicator project, apply `supabase/migration-operations-outbox.sql` after its reports archive migration.
3. Set the same random server-only `OPERATIONS_BRIDGE_SECRET` (at least 32 characters) on the two projects. Never put it in config.js, a browser, this document or a commit.
4. Deploy this project's `operations-ingest` with both `index.ts` and `contract.mjs`; platform JWT checking off as declared in config.toml. HMAC authentication, body size bounds and timestamp freshness are checked inside it. Deploy `operations-advisor` with platform JWT checking off; it verifies the logged-in management role through their Auth session. It uses the existing `OPENAI_API_KEY` and `CONTENT_AI_MODEL` secrets.
5. Deploy the source project's `operations-relay` with `index.ts` and `contract.mjs`; its user calls verify source management Auth, and cron uses a separate server-only `OPERATIONS_CRON_SECRET`.
6. In the source project, set Vault secrets `operations_relay_url` (that project's `/functions/v1/operations-relay`) and `operations_cron_secret` matching the relay secret. Apply `supabase/operations-cron.sql` with pg_cron, pg_net and Vault available. It retries pending reports every two minutes, even after the browser closes.
7. Release both frontends. No existing config.js rewrite is required. The source checks schema readiness before creating an archive record. Existing dashboard modules continue to work before this feature is activated.
8. In a designated test scope, approve one aggregate report. Verify source `delivered_at`, target fingerprint and issue/observation rows, then replay and verify no extra report/appearance. Use the normal UI to create a task and phases and verify assignment in the employee's home. Verify staff cannot query operational_reports. Test a later period and a revised same-period report.

Supabase administrative access was connected on 2026-10-17 (Dubai). See Live activation status below. GitHub merges alone do not deploy functions or apply SQL.

## Report and recurrence semantics

The source archives the approved aggregate analysis and enqueues an immutable snapshot with a SHA-256 fingerprint computed over content, period, branch and explicit scope. Title/file names do not define problem identity. Only numeric KPIs, coverage flags and projected risk/recommendation/plan fields cross the bridge; raw rows, filenames and patient tables do not. The source parser's anonymized analysis path remains the privacy boundary for free text inside findings.

Each target issue is keyed by source + branch + scope + stable rule/risk ID. It retains observations for period windows and links to every received report version. Replaying a fingerprint is idempotent. Correcting the same window updates its evidence without increasing appearances. An overlapping window is stored as an update, not counted as another independent recurrence. A disjoint period increases the count. Out-of-order/backfilled reports never replace newer evidence or reopen a newer resolution. Keep scope consistent for the same report family and reporting cadence.

A reported absence never auto-closes an issue. An outcome must be reviewed against a later report from the same branch and scope, after the action's measurement date and completion. A newer observation cannot be closed by an older follow-up. A subsequent independent period after resolution reopens the same registry row. A corrected follow-up approved after the resolution can also reopen it when the finding is still present, while replaying/revising its observation does not inflate the appearance count. The UI does not claim statistical causality or an exact consecutive-period streak from arbitrary report windows.

## Tasks, timing and review

Management selects an existing project, assignee, output/acceptance criteria, deadline, measurement date and 1–12 ordered phases. Each phase has a date and output, and may have a different assignee. `operations_create_action` reuses `task_create` inside one transaction, so assignment, membership, notifications, homepage appearance, status updates and review remain in the existing workflow. Double-clicking the same active title for an issue is rejected; a completed action awaiting outcome measurement is also protected. The same title may be approved for another intervention after its prior outcome is reviewed.

The linked parent task cannot be accepted until all child phases are accepted. Employees use the existing update/block/submit controls and attachments; managers accept or return work. Triggered events retain status changes, the original task due date and deadline changes. The first submission freezes its in-force deadline for measuring initial lateness; managerial waiting is displayed separately from employee submission. Resubmission is visible without rewriting the original submission. No automatic employment/sanction decision is added. Existing pre-activation records are not fabricated/backfilled with inferred submission times.

Operationally linked tasks cannot be physically deleted because the action history retains them. Existing project archival can be used instead. Old unrelated tasks retain their deletion behavior.

The personal-home wrapper calls the existing snapshot first and adjusts only task lateness counters, excluding tasks waiting for review. It does not replace later additions to that snapshot. The tasks UI also separates review from employee overdue work. Existing staff-KPI scoring functions are not redefined: their live SQL definitions must be reviewed before integrating these new timing signals into a weighted employee score.

## Advisor and learning

The optional advisor reads the selected issue's evidence, approved actions, and reviewed measured outcomes. It distinguishes failure to execute, pending measurement, and execution without improvement, then saves a bounded draft. Daily quota: 20 advisor requests per manager. It neither assigns tasks nor changes status. Management reviews/edits drafts and assigns the real people and dates.

Learning here is an auditable decision/outcome memory used as context, not automatic model-weight training. Missing or unknown coverage cannot be treated as zero expense or zero conversion. Human outcome judgments are contextual observations, not proof of causal lift.

Approved content actions appear in `operations_content_brief` only for users who can access the associated task and for the matching brand/specialty. The existing content generator appends that briefing alongside its performance memory. Medical sources, template validation and existing approval rules remain unchanged.

### External agent contract

`operations_agent_brief(p_assignee)` is service-role-only. Supply the verified configured agent admin ID; do not guess a staff identity. It returns only active approved content tasks currently assigned to that ID, with task/action IDs, brand, specialty, briefing, required output and deadline. It does not include financial report snapshots. Reassignment immediately removes work from the old agent's queue.

An external Claude worker must explicitly consume this RPC and use its existing authorized employee/task workflow to record phase work and submit for human review. Do not treat this migration as an automatic update to an already-running worker's prompt or schedule. No worker was invoked during implementation, and no real content, email, messages or social posts were generated/sent as a test.

## Validation

- `node tests/indicator-actions-sql.cjs` — real task migration + repeat activation, report replay/revision/overlap, recurrence/resolution/reopening/backfill, RLS, staged assignments, timing and deadline audit, scoped content context, quota.
- `node tests/indicator-advisor-handler.cjs` — management Auth, daily quota, structured advice and draft-only persistence.
- `node tests/indicator-ingest-handler.cjs` — signed delivery and rejection before database access.
- `node tests/indicator-contract.mjs` — HMAC, replay freshness/tampering and payload shape/privacy boundary.
- `node tests/indicator-reports-ui.cjs` — report/issue UI, HTML escaping, plan -> staged approval, outcomes, task navigation and role visibility with mocked API.
- Source `tests/operations-outbox.cjs` and `tests/operations-export-ui.cjs` verify privacy projection, approval, durable enqueue, leases/fencing, retry and management restrictions.
- Existing source report/parser/export tests, content brief tests, personal home SQL tests and dashboard smoke tests are run separately. UI mocks/local SQL do not replace end-to-end tests against the connected production projects.

The existing Playwright `tasks-pro.cjs` expectations were updated to separate waiting review from employee lateness, but that browser suite was not executed in this environment. Responsive CSS and jsdom interaction checks still need a real-device/live UI pass after activation.

## Live activation status — 2026-10-17 (Dubai)

Both database changes are applied. `operations-ingest` and `operations-relay` are deployed and ACTIVE with internal authentication. Their Supabase client dependency is pinned to 2.118.0. Server-only `operations_server_secrets()` reads encrypted Vault entries as a fallback when Edge environment secrets are unset. EXECUTE is revoked from PUBLIC, anon and authenticated. Secrets are not committed. Apply `supabase/operations-vault.sql` in each project before deploying these function versions.

The source has pg_cron/pg_net enabled and `operations-outbox-delivery` active every two minutes. The job invokes the relay only when eligible pending rows exist, so an empty queue does not cause Edge calls. `supabase/operations-extensions.sql` and `operations-activation-hardening.sql` in the source preserve these activation changes. The enqueue SHA-256 call explicitly uses the installed `extensions.digest` schema. Its anon execution grant is revoked explicitly because hosted default privileges can grant it independently of PUBLIC.

A clearly labeled aggregate-only activation report (scope `اختبار التفعيل`, no clinical data or real operating metrics) was delivered with HTTP 200, one source attempt and one destination row. Re-enqueue retained one outbox row. Live task/phase creation, employee visibility, financial RLS isolation, submission/acceptance timing and the home wrapper passed in a rolled-back transaction. No employee assignment from that test remains. The target's `tests/indicator-live-rollback.sql` records the test.

`operations-advisor` deployment was blocked by automatic approval review because it sends report KPIs and execution/outcome context to api.openai.com. It was NOT deployed, retried through another route or invoked. Owner approval of that transfer is pending. The target's `operations_ai_enabled()` flag is false and hides the advisor action. The existing content generator also omits the new operational briefing while this flag is false. Existing content generation behavior otherwise remains unchanged. Deploy the reviewed advisor only after approval, verify it, then enable this flag through a recorded schema change.

The external Claude gateway and scheduled routine were inspected but not modified or invoked. The verified agent account exists. The service-only operations queue is available, but consumption by an external model remains pending its actual routine integration and the data-transfer approval. A stored document alone does not update a running worker.

Supabase advisors were reviewed. Manager-authorized SECURITY DEFINER RPCs are intentional and test their access guards. The two internal audit/quota tables intentionally have RLS with no client policies and no client grants. Existing unrelated advisor findings were not silently changed. Relevant references: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable and https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .
