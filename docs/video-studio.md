# Video studio

## Existing functionality retained

- The original image storyboard renderer and schema-3 jobs remain supported.
- Existing uploaded_only, uploaded_plus_auto and auto modes remain available with unchanged worker behavior.
- ElevenLabs voice ID, model, settings and Keychain service are unchanged. Uploaded voiceover still explicitly overrides synthesized narration as before.
- Brand logo selection, five cover candidates, music mood/library, contact slide, outro, Google Drive archiving and approval routing remain intact.
- Production uploads and signed previews continue to use video-inputs storage and existing role checks.

## New functionality

The production modal groups script/duration, media/scenes, voice/identity and production/versions into four collapsible panels with responsive controls. It includes a script editor for the creator/management and links to earlier output versions.

`studio_storyboard` adds schema-4 immutable job snapshots. A scene can reference an uploaded image/video or request an AI image/video. The script order stays fixed. Users can change the visual selection and the starting timestamp of each uploaded clip. Users can fill/crop the frame or preserve the entire uploaded video frame. Imported source audio is discarded. Images use existing pan/zoom movements. Clips hold their last frame if their selected remaining duration is shorter than the narration segment, rather than replaying an unrelated sequence.

AI is explicitly requested per scene (or applied to all scenes). The worker adapter uses the OpenAI Images API (`gpt-image-1`, medium, 1024x1536 PNG) and Videos API (`sora-2`, 720x1280, 4/8/12 seconds), assembled into the existing 1080x1920 output. Model overrides are worker-only environment variables SSMPD_SCENE_IMAGE_MODEL and SSMPD_SCENE_VIDEO_MODEL. The API key is stored separately as SSMPD_SCENE_API_KEY in macOS Keychain. No provider request runs in the browser.

There is no transcription or automatic analysis of uploaded footage in this release. The saved script drives narration; the user selects suitable footage. No lip synchronization or real-person identity replication was added. Caption and scene timings retain the existing proportional timing model; this is not word-level forced alignment.

## Activation

1. On project uuijfbpgvtdxgaosqpxo run supabase/migrations/20261006_video_studio.sql. It requires the existing 20260920 AI-routing and 20260921 image-storyboard migrations. It is transactional and repeatable and does not remove source media or jobs.
2. Run the updated video-worker/Update.command on the worker Mac. It stages/compiles all modules and backs up the existing files before restarting the service. Old workers only claim schema 2/3 and cannot claim the new schema-4 jobs.
3. For AI scenes run Configure-Scene-AI.command on that same Mac and enter an OpenAI API key with image/video access and API billing. This does not change ElevenLabs credentials. These accounts and APIs were not accessed during development; no paid generation was run.

The new mode remains disabled until get_video_studio_capabilities confirms schema 4. Existing production modes remain usable before activation. Missing scene credentials fail before a generation request is sent.

## Recovery and reuse

The job generation_state stores per-scene request IDs/results. A video request is polled using its saved ID instead of creating another request after a restart. An image request with an ambiguous outcome is not repeated automatically. Completed outputs are saved in private storage and registered as video assets. The worker can resume those results after local cache loss. A background heartbeat remains active during long rendering/generation jobs.

The results panel previews generated assets using signed URLs. “Use saved generated scenes” switches only unchanged, matching scene definitions to their saved uploaded assets. Users can then request regeneration for just the scenes they change, instead of paying again for all unchanged scenes.

## Validation

- New SQL tests cover repeatability, ownership/role gates, mixed snapshots, stale script/missing prompt/invalid trim rejection, pending idempotence and worker-version isolation.
- New UI tests exercise four panels, preserved legacy handlers, script and scene dirty-state protection, script/scene matching, generated result reuse and the migration gate.
- New worker tests verify provider checkpoint/reuse/ambiguity logic with mocked responses. Real FFmpeg tests render mixed image/video inputs and all transitions, confirming duration, dimensions and absence of source audio.
- Existing image-storyboard UI/SQL/real-FFmpeg tests, brand ending/identity, media isolation and auto-input tests are rerun.
- The original complete Python suite already had six failures before these changes: macOS Keychain-dependent archive tests and expectations in cover/caption tests no longer matching current implementation. These are not reported as passing.
- A real provider job, existing Mac Keychain state and signed-in production UI cannot be verified from this environment. Chromium download was unavailable, so no browser screenshot/mobile visual approval is claimed.

API references:
https://developers.openai.com/api/reference/resources/images/methods/generate
https://developers.openai.com/api/reference/resources/videos/methods/create
https://developers.openai.com/api/docs/guides/video-generation
