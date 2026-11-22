# Video writing styles chosen in the Brief (curiosity_loop, health_story, health_twist, egyptian_catchphrase, numbered_content)

Trusted instructions (repository file). Owner request, Mohamed 2026-11-17. The idea generator (ChatGPT through the dashboard's Bulk tool) writes the idea and the script; Claude builds the video. Everything in `docs/claude-content-style.md` still applies (page identity, fonts, caption box, cover, fixed ending, pronunciation, medical safety and sources). If no style marker is present, produce the video the usual way.

## 1. How the style reaches you
- The style is a marker at the start of the item's `angle`: `[curiosity_loop]`, `[health_story]`, `[health_twist]`, `[egyptian_catchphrase]` or `[numbered_content]`. A combination of two markers is allowed (for example `[health_story][curiosity_loop]`). No marker = normal production. `video_template` stays as usual (normally `medical_educational` for voice-over + b-roll).
- Brand (`sono` / `dr_dina`) decides voice and identity. `dr_dina` = brain and nerves content. Use the page's approved voice and look.
- `script` is the full text sent to the narrator voice (Instinct `op=vo_submit`, fallback ElevenLabs `op=tts` — docs/claude-content-style.md «Reel narrator voice»). `hook` is the opening sentence of `script` and `cta_text` is already inside it when spoken: never add either of them a second time.
- If a style was asked for but the item holds only `script`, find the cut phrases yourself from the script (only when they are clear). If they are not, produce the normal edit and write the reason in the delivery notes.

## 2. `[curiosity_loop]` — graded suspense
The video opens a practical question, gives an early useful answer, reveals a detail that opens a second question, and closes it with an actionable step before the CTA. Change the shot at the reveal and at the answer so the viewer follows the idea shift.

The edit points are two lines after the marker in `angle`:
```
[curiosity_loop]
النقلة | <exact phrase from script> | <stock shot description>
الإجابة | <exact phrase from script> | <stock shot description>
```
1. Make the voice first. Find the start time of each phrase from the voice alignment (`op=tts` with `timestamps`), or by checking the audio (an Instinct take has no timestamps: reelkit fits the timing to its pauses, so put each phrase on its own line). Cut the shot at exactly that time.
2. Open with a shot that places the viewer in the situation quickly. At each phrase pick a shot that shows the new action or object. Search stock in English (`op=stock`); if the exact shot is not available use a generic one with the same meaning. Note the substitute in the delivery notes.
3. People in stock are illustrative only: never present them as real patients or as Dr. Dina.
4. Check that the spoken words and the synced captions match, and that every question raised has its answer in the script. Keep the medical information in the order of the script. Emergency content: open with the urgent action directly (no suspense).
5. Delivery notes: the time of «النقلة» and «الإجابة» and any substitute shot, so the reviewer can check both points fast.

## 3. `[health_story]` — awareness story
A made-up character (أحمد / هبة / نادية …) lived a small situation that ends with a practical step and «اطلب تقييمًا طبيًا».
- Show the small on-screen label «قصة توعوية افتراضية» for the first 2 seconds only, small, in the page font. The narrator never says it.
- Never present the story as a real case or as a proven treatment result. No before/after, no real patient, no doctor face.

## 4. `[health_twist]` — surprising title that is clarified at once
A startling title (for example «ما تشربش مية كتير!»), then within the first seconds a small line that says who or which condition it applies to («لو طبيبك محدد لك كمية سوائل»). Never leave general advice that could hurt: say who it is for and send to the doctor. The small line is on screen, in the caption style.

## 5. `[egyptian_catchphrase]` — a known catchphrase as the title
- Put the catchphrase as the on-screen title (text only) and under it a small line that ties it to the topic and opens curiosity without giving the answer.
- Text only: never copy a film scene, a voice or any protected clip or audio. Do not say or show the work's name unless the item says it is confirmed. A catchphrase marked «تحتاج تحققًا» must not claim a film; mention that in the delivery notes.
- Never make up a catchphrase and present it as a famous quote.

## 6. `[numbered_content]` — numbered content
Signs, steps, questions before the reveal, common mistakes, comparison, documented facts or a countdown. The number in the title must equal the number of points shown and spoken. Each point pops on screen as it is spoken (see "Reel on-screen look"). Medical numbers only with a reliable source and clear context (`sources`).

## 7. Approval and quota (Mohamed, 2026-11-17) — MANDATORY
- A video made in any of these styles is **never approved automatically**. Leave it in `final_approval` with `claude_hold` active; only Mohamed gives the final approval that makes it ready to publish. Do not move it to `ready_to_publish`, do not schedule it, and do not let any auto-approve/auto-schedule path take it (set the hold, and say in the delivery notes that it waits for Mohamed).
- These videos are **extra content, outside the agreed daily numbers**. Do not count them in the usual 3 items per page per day, and do not skip or replace a normal item because one of these exists.

## 8. Shared rules
- One idea per video and one practical benefit. No remote diagnosis, no treatment promises, no scare. Medical information is reviewed by a specialist before publishing.
- Combine two styles only when it serves the idea («story + curiosity_loop», «catchphrase + numbered_content»).
- Report in the delivery notes: the style marker(s) found, the chosen catchphrase (if any), and the cut times.
