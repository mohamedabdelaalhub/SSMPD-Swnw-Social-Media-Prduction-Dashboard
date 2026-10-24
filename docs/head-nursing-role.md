# رئيس التمريض

Role key: `head_nursing`. Supports both primary and extra roles. The default workspace for a primary head is patient records. Assigning the extra role to an existing nursing account preserves its nursing capabilities.

Permissions match existing archive-review authority: browse patients, list review files, view their attachments, approve/reject pending uploads with reviewer/time/notes and archive audit. The role does not grant archive upload/delete, patient portal identity verification, accounting, content approval or user management. Those remain separate grants. Existing explicit archive-review flags and super-admin rights still work. Removing the role removes its derived review authority unless another existing grant independently authorizes review.

Backend changes cover role constraints, `has_archive_review_access`, and the list/download/review Edge Functions. Client routing and archive review actions use the same head-role recognition. No staff member is automatically assigned, no active patient file is approved during deployment, and no review decision is inferred from the job title.

Validation uses actual Edge handler code with mocked records, PGlite role/permission tests and jsdom review UI. Deployment verification reads back database helpers and Edge source versions. A live rollback test returned a connector request-state error rather than a result, so it is not counted as a passed production role test. Read-back confirmed zero persisted head-role assignments. Browser fixture uses synthetic records only. It is not an authenticated employee production test.

Independent `اعتماد ملفات المرضى` toggle saves the existing has_archive_review_access grant for any employee without changing roles. Role-derived review is checked and disabled with a visible explanation. Removing an independent grant does not remove a separately assigned reviewer role. The admin card renderer identifies its action column dynamically rather than by index.
