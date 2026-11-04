# Video worker on Linux (preparation; NOT deployed, NOT approved for production)

The worker was written for macOS. This change makes it start and run on Linux without altering macOS behaviour.

## What changed
- `keychain_get()` returns an empty string off macOS (or when `security` is missing) instead of crashing with FileNotFoundError.
- Every secret can come from an environment variable OR a file named by `<NAME>_FILE` (new `secret_source.py`; the value is never logged): `SSMPD_SUPABASE_URL`, `SSMPD_SUPABASE_SERVICE_ROLE_KEY`, `SSMPD_AZURE_SPEECH_KEY`, `SSMPD_AZURE_SPEECH_REGION`, `SSMPD_ELEVENLABS_API_KEY`, `SSMPD_SCENE_API_KEY`. The macOS Keychain stays the last fallback on macOS. (ElevenLabs and the scene key already had env variables; this adds the file form and fixes the Keychain crash.)
- The audio preview command only plays sound with `/usr/bin/afplay` on macOS; elsewhere it prints a notice and still succeeds.
- Error messages name the env/file options instead of only the Keychain.

## Linux requirements
Python 3.10+ (standard library only), `ffmpeg` and `ffprobe` on PATH (or `SSMPD_FFMPEG`/`SSMPD_FFPROBE`) with `libx264`, `aac` and the `subtitles` filter (libass); fonts: the subtitles filter names no font, so install an Arabic-capable family (for example `fonts-noto-core`) and CHECK the rendered captions visually. Set `SSMPD_VIDEO_WORK_ROOT` and `SSMPD_MEDIA_ROOT` to service-owned directories and keep the secret files readable only by the service user.

## Known gaps (not addressed here)
- The macOS `say` voice is unavailable on Linux (`arabic_voices()` returns nothing and `macos_synthesize` raises a clear error): Linux jobs need ElevenLabs or Azure TTS configured.
- Rendered output is uploaded to production Google Drive through the Apps Script bridge (`SSMPD_DRIVE_BRIDGE_URL`): never point a test worker at production.
- Job safety: `claim_next_video_job` (server side) uses `FOR UPDATE SKIP LOCKED` and sets `status='preparing'`, `worker_id`, `attempt_count+1`, so two workers cannot claim the same job. There is NO lease expiry or automatic reclaim: a worker that dies mid-job leaves the job in a non-pending state until someone resets it. Run only one worker per environment until a lease/retry design is reviewed and tested.
- `video-outputs` is created as a PUBLIC storage bucket in `supabase/setup.sql` (existing behaviour, flagged for the security review).

## Tests
`python3 -m unittest test_linux_portability` (offline, fake values only). The rest of the suite is unchanged.
