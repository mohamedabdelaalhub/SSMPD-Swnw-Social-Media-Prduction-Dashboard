# Task assignment identity

Tasks now display the current assigner on employee cards and list rows. Details also display the assignment timestamp and the original creator, as separate identities. The database trigger stamps new assignments and reassignments; ordinary progress/title changes preserve the stamp, and client-supplied stamps are ignored.

Historical tasks deliberately retain an unknown assigner. Existing `created_by` remains visible as “أنشأها”; it is not evidence of who last reassigned the task. Recurring task creation uses the series creator already recorded by the existing generator. A reassignment without an authenticated admin remains unnamed.

The new authenticated-only `task_list_with_assignment()` wraps the existing `task_list_visible()` authorization filter and preserves its fields and ordering. Its security-definer execution is intentional to resolve creator/assigner names without granting broad access to the admins table. Anonymous execution is revoked; callers with no admin session get an empty array. Security advisors flag authenticated definer execution as expected; there is no new anonymous grant, mutable search path, or table exposure.

Migration `20261024150548_task_assignment_identity.sql` was applied through the Supabase connector and named using its server-generated migration version. This avoids the CLI telemetry connection previously rejected by automatic approval review.

Validation: `node tests/task-assignment-sql.cjs`, `node tests/task-assignment-dom.cjs`, and existing `node tests/task-work-dom.cjs` pass. SQL tests exercise the actual migrations in PGlite, including creation, reassignment, metadata spoof prevention, legacy identity, and employee/module/anonymous filtering. Live read-back verifies columns, trigger, RPC grants and an empty response without an admin session. No actual employee task was created or reassigned for testing. The public fixture uses synthetic data only.

The broad `test/smoke.js` retains its existing social-tab-count failure and requestAnimationFrame warning. It is not reported as passing. A signed-in production employee session has not been exercised.
