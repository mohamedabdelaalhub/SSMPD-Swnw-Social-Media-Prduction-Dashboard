# AI design routing

Initial approval now offers the AI design agent alongside active designers. AI image routing currently supports Sono image posts. Video routing supports the existing video formats and worker.

Run `supabase/migrations/20260920_ai_design_routing.sql` in the project's SQL editor. It depends on the deployed video/music/logo and Sono design-pilot migrations. No Edge Function redeployment is needed. The existing human-assignment path remains available if the new RPC has not been deployed yet.

The routing RPC locks the content row. Video routing creates or reuses a video job in the same transaction. Invalid video inputs roll back the routing. Image routing opens the existing studio, where staff choose or generate a scene and save the composed output. It does not silently start paid image generation.

AI-routed content remains in `in_design`. Reviewers can reopen the studio/video controls from Content Management and submit a saved output to `final_approval`. The submission RPC checks for a saved design version or a ready video. Final publishing approval remains a separate action.

The video status panel polls jobs and worker heartbeats every 15 seconds while open. These requests only read state. Refreshing the display does not create a new job. A missing heartbeat cannot distinguish a stopped Mac, sleeping Mac, old worker, missing heartbeat migration or network failure. Run `video-worker/Diagnose.command` on the worker Mac to inspect launch service state, project match, recent heartbeats and job statuses without printing credentials or claiming work.

The existing `auto` video mode selects footage from the Mac media library. It does not call a generative video model. The UI now says so explicitly.

Validation

- `tests/ai-routing-sql.cjs` runs the migration twice in PGlite against a minimal schema fixture, then checks role restrictions, human and AI routes, atomic rollback, duplicate clicks, logo variant/music snapshots, scene reservations and manual final approval.
- `tests/ai-routing-ui.cjs` uses jsdom for selection, duplicate-click protection, editor handoff and failure recovery.
- Changed JS parses and the diagnostic shell script passes `bash -n`.
- Legacy `test/smoke.js` still fails on obsolete fixtures and selectors. No authenticated browser or live Supabase migration execution was available here.
- The user's Mac worker must be inspected before claiming that pending video processing has been fixed.

## Follow-up: reported FFmpeg failure and logo reserve

The user supplied a `Brand ending render failed` error showing mismatched SAR `1:1` versus `14080:14079` during concat. This establishes that the worker did claim and process the job. The ending compositor now normalizes all three video streams to 1080×1920, square pixels, 30 fps and zero-based timestamps, and normalizes audio to 48 kHz stereo before concat. Existing cached contact slides are normalized too. `video-worker/test_brand_ending.py` reproduces the old SAR failure with real FFmpeg, then verifies successful output after the change. The worker on the user's Mac still needs the updated Python file and a restart.

The static compositor now starts scene drawing at y=160, clipped below the logo reserve. Font placements and the fixed PNG remain unchanged. Scene prompts also request a quiet top band without people or important details. Existing images can be recomposed without a new generation request. The native canvas test checks exact top-reserve pixels for all four title placements and extreme crop controls.

The scene now extends to y=960 behind a fade from y=700 to y=905. The fixed overlay becomes opaque around y=908. Bottom-title contrast uses a soft gradient when moved into the image, avoiding a hard white rectangle. Generation prompts request additional lower framing.
