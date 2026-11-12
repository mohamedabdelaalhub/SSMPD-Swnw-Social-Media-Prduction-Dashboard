# Character reels (cartoon cast) — weekly, for the daily Claude tasks

Trusted instructions (this file lives in the repository, not in the kit). Owner decision, Mohamed 2026-11-12:
**once a week per page (`sono`, `dr_dina`) the day's reel is a character reel** instead of the usual stock/kinetic-text reel.
Everything else in `docs/claude-content-style.md` still applies (voice rules, on-screen look, fixed reel ending, medical safety, sources).

## 1. What is where
| What | Where |
|---|---|
| Separated vector parts of 11 licensed character kits (heads with expressions and mouth shapes, hands, arms, legs, 5-view bodies, props) | **kit**: `?op=kit_get&name=characters/<kit>/index.json`, `.../index.jpg` (contact sheet with part ids), `.../svg/pNNN.svg` |
| Kit descriptions, status, known problems | `docs/character-library/manifest.json` |
| Proposed cast and the voice of each character | `docs/character-library/characters.json`, `docs/character-library/voices.json` |
| Tools to turn a new EPS kit into parts | `scripts/character-video/extract_kit.py`, `render_parts.js`, `make_index.py` |
| Working example of a full character reel (stickman cast, caption timing from the voice, SFX, lip-sync, kit contact card + outro) | `scripts/character-video/example-cold-drink/` |

Kit ids: `kit_1057129943`, `kit_1068373289`, `kit_1091716457`, `kit_1127429795`, `kit_1127429801` (doctors), `kit_639683044` (one doctor in 22 ready poses), `kit_687385225` (male doctor creation kit), `kit_1394067155` (doctor model sheet + side walk cycle), `kit_1059723329`, `kit_1623976375`, `kit_1247394394` (families: kids, young woman, grandmother, grandfather, veiled woman).
`index.json` lists each part with its box in kit units (`w`,`h`) so relative sizes stay right; `px_per_unit` is the PNG render scale. Part PNGs are not stored: render an SVG with Chromium (transparent background) when needed.

**Known problems (do not ignore):** in `kit_1394067155` the faces render black and in `kit_1247394394` the mouths render as black boxes (transparency in the source). Use the poses, hands and walk-cycle frames of the first and the bodies/limbs of the second, or re-cut from a raster render (`gs -sDEVICE=pngalpha -dEPSCrop -r150`). Bodies are complete figures (head + body + arms); swapping heads for lip-sync needs the head removed from the body (not solved for every kit).

## 2. When to make one
Per brand, once every 7 days. Check with the SQL mailbox before making the day's reel:
`select count(*) from content_items where brand='<brand>' and content_format='video' and title ilike '%ريل كوميدي%' and created_at > now() - interval '7 days';`
If 0, today's reel for that brand is a character reel (titles end with `(ريل كوميدي)`; this is the marker for the check above). Dr. Dina reels stay Facebook + Instagram only. If the character reel cannot be finished (render, voice or quota problem), make the normal reel instead and say so in the final message — never leave the day without its reel.

## 3. Rules
- Cartoon characters only. Never a real patient, never a generated or edited picture of Dr. Dina or any doctor. No real faces, no patient data.
- Comedy is about habits, never about illness. Red-flag topics (meningitis, stroke, fainting, head injury, newborn jaundice) are never played for laughs. The last seconds are serious: one clear tip + «استشر الدكتور».
- Medical claims stay conservative and sourced exactly as for any other item (see the sources rules in the task prompt; never invent a source). If a claim cannot be sourced, leave `sources` empty and say it needs review.
- Name is `Swnw`; identity (colors, BigVesta/Hiragino fonts, orange key words, white caption box hugging 2–5 word chunks, logo top-left without a box, Western digits) as in `docs/claude-content-style.md`.
- Fixed ending, last: content → kit contact card (`sono/contact_video.jpg`, ≈3 s) → kit outro (`sono/outro.mp4`). Never build your own contact card.
- License: the kits are Shutterstock vector packs. Their parts are kept in the private kit only, never commit them to this repository. Using characters in educational content is fine; do not present a character as a trademark/logo of the center.

## 4. Voices (ElevenLabs)
Voices and settings: `docs/character-library/voices.json` (the voices were added to the center's ElevenLabs account; the default narrator remains the gateway voice `op=tts`).
1. Narrator / generic lines: gateway `?op=tts` as always (approved voice).
2. Each other character: call ElevenLabs directly, `POST https://api.elevenlabs.io/v1/text-to-speech/<voice_id>?output_format=mp3_44100_128` with the settings in `voices.json`. The key is stored in the environment's Network secrets (header `xi-api-key`, injected by the proxy: **do not add the header yourself**). If it answers 401/403/blocked, fall back to the gateway voice for all lines, report it in the final message, and carry on.
3. One request per character script (all that character's lines together, separated by blank lines). Never sentence-by-sentence for one voice.
4. Before generating, read the remaining quota (`GET /v1/user/subscription`; if it is refused, go ahead). A character reel needs about 350–450 characters. If less than that is left, make the normal reel.
5. Cut each take at its natural pauses (`ffmpeg -af silencedetect=noise=-38dB:d=0.18`) and place the pieces on the scenes; derive captions timing from the voice (proportional by characters inside each speech segment, with the measured pauses) and mouth movement from the voice envelope (rms every 1/24 s). See `example-cold-drink/plan.py`, `audio.py`, `anim.py`.
6. Tashkeel only on words the voice misreads (السِّنّة، المِينا، اللِّثّة، اسْتَشِر). Egyptian dialect; short sentences.

## 5. Steps
1. Pick the topic as for any reel (performance + no repeats in the last 45 days), then the cast: one or two characters, one voice each.
2. Write the script: hook in the first 3 s, a comic problem, a short serious fact, one tip, CTA. 25–40 s of content (the contact card + outro add ≈7 s; keep the total ≤ 45 s).
3. Generate the voice(s), build `sched.json` (captions, cards, speaking windows, lip-sync envelope) like `plan.py`.
4. Render frames 1080×1920 at 24 fps with Chromium (`render_frames.js`, which loads the BigVesta/Hiragino fonts from `assets/fonts` and sizes the white caption boxes to the text) — four processes in parallel take about 4 minutes for 35 s.
5. Look at the frames (impact moment, captions, cards, ending) with the Read tool before upload; fix clipped Arabic.
6. Mix SFX + voices + kit music low (`audio.py`), encode, then concat content + contact card + outro at 30 fps and `loudnorm=I=-16:TP=-1.5`.
7. Upload with `?op=upload_video` and continue the normal item flow (`design_file_url`, stages, `meta_publish_jobs`, TikTok row for `sono` reels). Same approval rules as every other reel.

## 6. Environment needs
Chromium (preinstalled), Node `playwright`, `ffmpeg`/`ffprobe`, Python 3 with `numpy` (`pip install numpy` if missing), and the repository checkout for fonts (`SSMPD_REPO` = its path). `KIT` = a folder with the files fetched via `op=kit_get` (`sono_logo_web.png`, `sono_music_upbeat.mp3`, `sono_contact_video.jpg`, `sono_outro.mp4`).
