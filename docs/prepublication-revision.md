# Edit before publication

The publish list and calendar detail dialog now offer تعديل قبل النشر to the content owner, managers and approvers. The existing editor exposes caption, hook and CTA fields. Save uses revise_content_before_publish with the version timestamp read when the editor opened. Saved posts return to final_approval. The previous social schedule is cleared and pending Meta jobs are cancelled in the same transaction. Platforms and current design URL are preserved. Editing an eligible current layered Sono design first saves and returns to approval, then opens the existing design editor.

Processing, partially published and already published Meta jobs block this operation. Processing website deliveries also block it. The database locks the same job rows used by worker claims. A direct change to approved content through another editor also returns the item to approval and cancels pending Meta jobs. Website approval withdrawal follows the existing website queue rule. No new posts are published during these tests.

## Activation

In the content dashboard Supabase project SQL Editor, run supabase/migrations/20261008_content_publishing_activation.sql. It combines the pending contact/hook/website and revision migrations and can be rerun. Redeploy meta-publish-process from the complete repository if the previous hook/contact change has not been deployed. No function source changes to the worker are needed specifically for cancellation. The existing website worker and its secrets/schedule remain necessary for site delivery.

## Verification

JavaScript syntax and actual editor/publish DOM checks passed. PostgreSQL tests passed for atomic schedule cancellation, reapproval, website withdrawal, generic editing, blocked active publishing with rollback, stale-version rejection, patch allowlisting, owner authorization and approver editing. External publication and the live Supabase project were not exercised.
