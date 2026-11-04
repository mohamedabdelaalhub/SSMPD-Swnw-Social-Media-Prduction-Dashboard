# Digital team coordination and task file scanning

The account menu now groups Business Intelligence, Digital Team, Patient 360 and Sia Center under Administration & Operations, outside the content-production tabs.

At the bottom of Digital Team, the owner can send questions, instructions or tasks to one or all seven agents. Each recipient receives a separate dispatch and chronological event trail. AI consultations and single-hop cross-agent questions use actual internal advisory model calls. Acknowledgement means coordination inbox receipt, not acknowledgement by an external runtime. Claude Creative and Hapi remain marked awaiting_runtime until real adapters are tested.

Task file scanning has an independent queue triggered by inserts into task_work_results and task_attachments, and a Supabase Vault-backed cron worker every 10 minutes. It supports bounded extraction/analysis of spreadsheets, Word, presentations, CSV, TXT, PDF and images, with explicit unsupported, restricted and access-denied states. Clinical and patient-comment images are held for human review. Task status and the existing Sia approval automation remain unchanged.

Existing task files were shared read-only with the scanner service account during the rollout. For future uploads, the repository's apps-script/Code.gs adds a best-effort, file-specific reader permission to each new task file, without public sharing or blocking upload success.

IMPORTANT DEPLOYMENT DEPENDENCY: The live Google Apps Script Web App must be redeployed with the updated Code.gs. GitHub changes do not deploy into Google Apps Script automatically. Until that redeployment, newly uploaded files can show needs_access even though the task upload succeeds.

No operational execution is inferred from advisory analysis. Customer messaging, finance approvals, bookings, publishing and external negotiations remain outside this coordinator's write privileges. Existing Claude/Hapi/Sia roles and automations are preserved.
