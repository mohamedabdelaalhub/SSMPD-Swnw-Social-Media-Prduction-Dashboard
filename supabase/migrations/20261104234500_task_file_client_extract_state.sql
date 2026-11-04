
-- Allow unverified, redacted previews extracted locally from an employee-uploaded file.
-- Unlike owner-authorized Drive evidence, they must never count as trusted verification.
alter table public.task_attachment_evidence
 drop constraint if exists task_attachment_evidence_source_check;
alter table public.task_attachment_evidence
 add constraint task_attachment_evidence_source_check
 check(source in ('authorized_drive_fetch','client_extract'));
alter table public.task_attachment_evidence
 drop constraint if exists task_attachment_evidence_verification_state_check;
alter table public.task_attachment_evidence
 add constraint task_attachment_evidence_verification_state_check
 check(verification_state in ('verified_content','unverified_client_text','stale','retracted'));
alter table public.task_attachment_evidence
 add constraint task_attachment_evidence_source_state_check
 check((source='authorized_drive_fetch' and verification_state in ('verified_content','stale','retracted'))
 or (source='client_extract' and verification_state='unverified_client_text'));
