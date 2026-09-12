# ElevenLabs voiceover

The worker checks `SSMPD_ELEVENLABS_API_KEY` in the environment first, then the
macOS generic-password item with that service name and the current username as
account. Keep credentials out of files and source control.

When a key exists, ElevenLabs takes priority over Azure and macOS. Uploaded
voiceovers retain priority. An ElevenLabs error stops the job without switching
providers or automatically retrying a chargeable request. Without an ElevenLabs
key, the existing Azure/macOS selection remains unchanged. Keychain access errors
other than an absent item stop selection rather than silently switching voice.

Default voice: `VXERCtS1keFWRMOi7czu` (SSMPD Egyptian Female 02).
Override with `SSMPD_ELEVENLABS_VOICE_ID` if required.
Model: `eleven_multilingual_v2`. Speed 1.0, stability 0.5, similarity 0.75,
style 0, speaker boost on. Output MP3 44.1 kHz / 128 kbps.
The complete script is sent unchanged in one request.

`--check` checks configuration locally, without spending API credits.
`--test-voice` makes one short TTS request, plays it on the Mac and deletes the
temporary audio. It never reads or claims Supabase jobs. The command wrapper
can be opened separately after installing the update.

API contract: https://elevenlabs.io/docs/api-reference/text-to-speech/convert

## Approved listening baseline

The user approved this exact test sentence after listening on their Mac:

> إحنا هنا عشان نسمعك ونفهم إيه اللي تاعبك، ونشرح لك كل خطوة بكلام مفهوم.

Keep the voice and model/settings above for the next full-video trial. In this
sentence use «تاعبك»; «مضايقك», «مدايقك» and «تعبك» were not accepted. This is an
editorial choice for this sentence, not a global replacement rule. Review new
scripts in conversational Egyptian Arabic and listen before approving them.
Approval covers this voice sample; a complete generated video still needs review.
