# Google Drive video archive

Uses the existing `apps-script/Code.gs` deployment and `driveBridge.webAppUrl`.
No new Google account, API key, service account or booking integration is introduced.

Archive path under the existing design root:
`Videos / Brand / Year / Month / ContentId_JobId / final.mp4 + cover.jpg`.
Year and month use the job creation date in UTC. Each rerender has a new job folder.
Repeated uploads to the same job verify SHA-256 and reuse the files, under a script lock.
Archive permissions inherit the existing design archive. No sharing settings are changed.

## Activation order

1. Apply `supabase/migrations/20260908_video_assets_drive.sql` in SQL Editor. It includes
   the additive Video Assets changes from PR 10 and the new archive columns. It is transactional
   and can be rerun. It does not recreate the full database.
2. Replace code in the existing Drive Apps Script project using `apps-script/Code.gs`.
   Update its existing web app deployment to a new version, preserving its URL and access settings.
3. Stop the Mac worker before replacing `worker.py` and adding `drive_archive.py` in
   `~/SSMPDVideoWorker`. Copy the repository `config.js` into that folder as well, or set
   `SSMPD_DRIVE_BRIDGE_URL` to the existing bridge URL locally. Do not rerun the secret installer.
4. Run one uploaded-voice/video job. Verify `archive_status=archived`, Drive video and cover,
   and the dashboard links. This live smoke test is still required.

`video_jobs.content_id` links each archive back to its Content Item. `drive_video_url`,
`drive_video_id`, `drive_folder_url`, `cover_url` and `archived_at` record the archive.
Old ready jobs with only `output_video_url` remain readable.

## Recovery

Outputs remain in `~/SSMPDVideoWorker/jobs/JOB_ID`. If archiving fails, use
`python3 ~/SSMPDVideoWorker/worker.py --retry-archive JOB_ID` after resolving the cause.
It uploads the existing output without invoking TTS or rendering again.
Run retries with the regular worker stopped. The dashboard rerender button creates a new job,
so use the command above when only archiving needs recovery.

## Current boundaries

- The existing JSON/base64 bridge accepts up to 35 MiB per file. Larger files fail explicitly
  and stay on disk. Resumable uploads are a follow-up; do not silently recompress the original.
- Without cover options, a cover is an extracted frame. With cover options enabled, five 1080×1920 title/logo templates are generated from the clean visual track (or final video if the clean track is absent).
- Default runs do not upload outputs to Supabase Storage. `output_video_url` remains reserved
  for a direct publishing copy. `SSMPD_VIDEO_STAGE_OUTPUT=1` retains the previous staging upload
  for controlled publishing tests, but automatic expiry/cleanup is not implemented yet.
  Leave it unset until publisher lifecycle/cleanup is implemented. Existing old output objects
  are not deleted by this change.
- Brand Library, stock providers, generated visuals and full Scene Plan remain future work.
  The existing renderer and media resolver are unchanged.
- Python mock tests validate archive failure/retry behavior; they do not prove live Google or
  Supabase deployment. Node syntax checks do not validate Apps Script service permissions.

## Branded cover choices

Apply `supabase/migrations/20260908_video_cover_candidates.sql` after the assets/Drive migration.
Also install `cover_candidates.py` alongside `worker.py` and `drive_archive.py`.
Update the existing Apps Script deployment with the new cover_1 through cover_5 support.
Brand logos now come from the persistent `brand_logos` registry. Apply
`supabase/migrations/20260908_brand_logos.sql` after the prior migrations and install
`brand_identity.py` alongside the other worker modules. A super admin uploads the logo
into one of two fixed slots for Sono or Dr. Dina in the Admin panel. Content authors can
edit the cover title/placement and select either saved variant of their content brand. Logo files live
in a private immutable `brand-logos` bucket. Replacements use new object paths so
historical and running jobs retain their original snapshots.

Job creation obtains the logo server-side by the Content Item brand. It ignores
per-video logo IDs and requires a saved logo. A pending job can be refreshed using
its dashboard button to capture current settings/assets/logo. Running jobs are not
modified. Previously selected per-content logo assets are tagged `legacy_logo` and
excluded from new footage snapshots without deleting their files. The updated worker
refuses old/unbound or cross-brand snapshots and requires pending jobs to be refreshed.

The registry prevents accidental per-video brand swaps. The super admin still needs
to verify each uploaded image belongs to the card's brand; the system does not infer
brand identity from image pixels. No logo has been auto-imported based on filenames.

The worker samples five windows across the visual track and uses FFmpeg's thumbnail filter
within each window. This is representative-frame sampling, not face-aware or blur-ranking AI.
Candidates from a static source can look similar. Each option is archived in the same Drive
job folder. Small private JPEG preview copies live in video-inputs for signed dashboard
previews; Drive remains the image archive. Preview copies currently stay until a future
cleanup policy is implemented.

Selecting an option calls an authorized RPC which verifies the candidate belongs to this job,
then updates selected_cover_id and cover_url. It changes no video pixels and does not rerender.
Until selection, option 1 is the default cover. The original video and all options remain on Drive.
The preview uses signed URLs and does not make video-inputs public. Existing ready jobs are
not retroactively changed; use a new render with cover options to generate choices.

## Two variants per brand

Apply `supabase/migrations/20260908_brand_logo_variants.sql` after the permanent-brand
migration. Existing logos remain in the `primary` slot. The second slot is `alternate`.
The Admin panel has four fixed upload cards: two for Sono and two for Dr. Dina. In content
production, users see only their brand's two variants with previews; missing slots are
shown disabled. Save cover settings and refresh the pending job to capture a change.

Job creation reads only `logo_variant` from the content settings, validates the two
allowed values and fetches the logo using both `brand` and `variant` server-side. It
never accepts a logo ID or another brand from the client. The first slot remains the
default for existing content. If the selected slot is missing, job creation reports it
instead of silently selecting another slot. Replacing a slot does not mutate existing
job snapshots or stored logo objects. The previous three-argument upload RPC remains
compatible and updates the first slot only.

This variant change does not require a new Apps Script deployment or additional worker
code beyond the permanent-brand worker update (`brand_identity.py` plus its callers).
The user's Mac still needs that PR 12 worker update before rendering new jobs.
