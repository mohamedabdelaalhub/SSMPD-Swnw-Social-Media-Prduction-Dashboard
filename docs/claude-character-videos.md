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

## 2. When to make one — weekly by default, adjusted by the audience's response
**Marker.** Every character reel carries `content_angle = 'character_reel'` (set it when you create/patch the item) and its title ends with `(ريل كوميدي)`. Never mark anything else that way.

**Default rate:** one character reel per page every 7 days. Check with the mailbox before making the day's reel:
`select count(*) from content_items where brand='<brand>' and content_angle='character_reel' and stage in ('scheduled','published','final_approval','ready_to_publish') and coalesce(scheduled_publish_at, created_at) > now() - interval '<N> days';` where N = the page's current interval (7 unless the rule below changed it). If 0, today's reel for that page is a character reel.

**Idea pool.** Ideas already sitting in `idea_selection` with `content_angle='character_reel'` (created by Claude Creative or staff) are the preferred topics: take the oldest one for that page, PATCH that same item (do not create a duplicate), and continue its stages. If none fits, write a new topic as for any reel. Never touch ideas that are not marked as character reels.

**Measure and adjust (every run; stateless — nothing is stored between runs, the interval is recomputed from the data each time).** Compare the page's character reels with its normal reels (content_format='video', not character_reel) using real reach-normalised engagement, with ONE mailbox request:
```sql
select (c.content_angle = 'character_reel') as is_char, count(*) as reels,
  percentile_cont(0.5) within group (order by (coalesce(i.fb_reactions,0)+coalesce(i.fb_comments,0)+coalesce(i.fb_shares,0)+coalesce(i.ig_interactions,0))::numeric / nullif(coalesce(i.fb_reach,0)+coalesce(i.ig_reach,0),0)) as median_eng,
  percentile_cont(0.5) within group (order by coalesce(i.fb_shares,0)) as median_shares,
  percentile_cont(0.5) within group (order by coalesce(i.fb_reach,0)+coalesce(i.ig_reach,0)) as median_reach
from public.post_insights i join public.content_items c on c.id = i.content_id
where c.brand = '<brand>' and c.content_format = 'video' and i.published_at > now() - interval '60 days' and i.published_at < now() - interval '3 days'
group by 1;
```
- Use it only when the character row has at least 4 reels; otherwise keep the default interval (7 days) and say "لسه بنجمع بيانات".
- ratio = median_eng(char) / median_eng(normal). ratio ≥ 1.3 and (median_shares or median_reach also higher) → interval 4 days (max 2 per week per page, never two on the same day). ratio ≤ 0.7 → interval 14 days. Otherwise 7 days. If it stays ≤ 0.7 with 4 more reels, stop making them and ask Mohamed.
- Judge topic and hour separately from style (a bad topic is not a bad style); medical-safety rules never change with performance.
- Summary: write «ريل الشخصيات: X× مقابل الريل العادي → فاصل N يوم» per page; tell Mohamed only when the interval differs from the previous run's.
If the character reel cannot be finished (render, voice or quota problem), make the normal reel instead and say so in the final message — never leave the day without its reel.

## 3. Rules
- Cartoon characters only. Never a real patient, never a generated or edited picture of Dr. Dina or any doctor. No real faces, no patient data.
- Comedy is about habits, never about illness. Red-flag topics (meningitis, stroke, fainting, head injury, newborn jaundice) are never played for laughs. The last seconds are serious: one clear tip + «استشر الدكتور».
- Medical claims stay conservative and sourced exactly as for any other item (see the sources rules in the task prompt; never invent a source). If a claim cannot be sourced, leave `sources` empty and say it needs review.
- Name is `Swnw`; identity (colors, BigVesta/Hiragino fonts, orange key words, white caption box hugging 2–5 word chunks, logo top-left without a box, Western digits) as in `docs/claude-content-style.md`.
- Fixed ending, last: content → kit contact card (`sono/contact_video.jpg`, ≈3 s) → kit outro (`sono/outro.mp4`). Never build your own contact card.
- License: the kits are Shutterstock vector packs. Their parts are kept in the private kit only, never commit them to this repository. Using characters in educational content is fine; do not present a character as a trademark/logo of the center.

## 4. Voices (ElevenLabs)
**Approved Egyptian voices only (owner listening test 2026-11-13):** `doctor_male` (Hanafi), `woman_1`/`woman_2` (both = Yasmine), and `male_2`/`elder_man` as adult men. Fatima, Ghozlan and Sawsan were rejected (emphasised qaf, not Egyptian) and removed from the generator and the gateway. There is no approved grandmother voice: use the grandfather. Each voice is only reliably Egyptian on the models ElevenLabs lists for it (Hanafi, Yasmine and the elder man work on `eleven_multilingual_v2`, the default). Do not add or switch voices without an owner listening test.
Voices and settings: `docs/character-library/voices.json` (the voices were added to the center's ElevenLabs account; the default narrator remains the gateway voice `op=tts`).
1. Narrator / generic lines: gateway `?op=tts` as always (approved voice).
2. Each other character: call ElevenLabs directly, `POST https://api.elevenlabs.io/v1/text-to-speech/<voice_id>?output_format=mp3_44100_128` with the settings in `voices.json`. The key is stored in the environment's Network secrets (header `xi-api-key`, injected by the proxy: **do not add the header yourself**). If it answers 401/403/blocked, fall back to the gateway voice for all lines, report it in the final message, and carry on.
3. One request per character script (all that character's lines together, separated by blank lines). Never sentence-by-sentence for one voice.
4. Before generating, read the remaining quota (`GET /v1/user/subscription`; if it is refused, go ahead). A character reel needs about 350–450 characters. If less than that is left, make the normal reel.
5. Cut each take at its natural pauses (`ffmpeg -af silencedetect=noise=-38dB:d=0.18`) and place the pieces on the scenes; derive captions timing from the voice (proportional by characters inside each speech segment, with the measured pauses) and mouth movement from the voice envelope (rms every 1/24 s). See `example-cold-drink/plan.py`, `audio.py`, `anim.py`.
6. Tashkeel only on words the voice misreads (السِّنّة، المِينا، اللِّثّة، اسْتَشِر). Egyptian dialect; short sentences.

## 4b. Production tool — `scripts/reelkit/` (use this, do not hand-build)
Write a storyboard JSON (cast, scenes, lines; format and ready examples in `scripts/reelkit/README.md` and `scripts/reelkit/stories/`) and run one command:
`python3 scripts/reelkit/build.py story.json OUT --kit <KITDIR>` (`--dry` first for a free timing check). It makes the voices (one ElevenLabs request per character), captions (blue box with orange border, white text, key words highlighted), lip-sync, camera moves, transitions, SFX, music, contact card and outro.
Vary every reel: two visual styles (cartoon stickman looks, or the kit style: `dr_poses`, `kit_dr_f_auburn`, `kit_woman`, `kit_girl`, `kit_boy`), 8 sets, props, gestures, transitions, different cast and story shape than the last character reel (check the last two with the same marker). Put the chosen style/cast/set in `hypothesis_reason` so the next run can avoid repeating it.
Child voices (owner decision 2026-11-13): there are NONE. ElevenLabs refuses Voice Design for children, and a pitched-up adult voice was tried and rejected as not good. So kids NEVER speak: they react with expressions, gestures, sound effects and a short caption/thought bubble, and the dialogue is carried by adults (mama, doctor, grandfather, grandmother, papa). `male_2` is an adult man voice (approved for variety), not a boy.

## 4c. Item fields and cover (so the dashboard machinery works)
- Create the item like any reel (see the task prompt) with: `content_angle='character_reel'`, title ending `(ريل كوميدي)`, `video_template='medical_educational'`, `publish_platforms` as for any sono reel, `script_text` = the dialogue with speaker names, `hypothesis_reason` = style + cast + set used (so the next run avoids repeating it) + "محتاج مراجعة دكتور" for medical claims.
- ALWAYS save the storyboard in `video_storyboard` (the JSON you gave `build.py`): a reel that comes back in `needs_revision` is rebuilt from it (apply the comments to the text/cast, re-run `build.py`, re-export with the current ending, keep the same item).
- Cover: `python3 scripts/reelkit/cover.py OUT "<title with *key* words, \\n for line breaks>" "<tag>" "<subtitle>"` after `build.py` (it uses the clean frame `cover_frame.png` that build saves and the approved cover template, brand font checked), then upload `OUT/reel-cover.png` with `?op=upload_cover&content_id=<id>`. No diacritics on screen, ever (they are for the voice only, see `pron.json`).
- Sources: only a page you actually fetched and that answered; if the official site is unreachable from the environment, leave `sources` empty and flag it (never invent one).
- Staff cannot press «نفّذ» on these items and cannot edit them (database guard); only managers and Claude can.

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
