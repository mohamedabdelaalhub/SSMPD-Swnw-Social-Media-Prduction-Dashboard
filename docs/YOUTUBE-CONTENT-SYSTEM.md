# YouTube — content system and Google approval (2026-11-14)

Owner's decision: make the content fit YouTube **before** connecting the two channels
(`sono` = عيادات سونو التخصصية، `dr_dina` = Dr. Dina Hosni).
Nothing here publishes anything. Connecting a channel and every upload still need the owner.

Live numbers could not be read in this session (the mailbox host `files.swnwclinics.com` is blocked by this
session's network), so this is written from the code and the database schema. Re-check the counts later.

## 1. How content is made today (from the code)

- `content_items`: `brand` (sono / dr_dina), `content_format` (`video`, `image_post`, `link_post`, `carousel`),
  `specialty`, `topic_service`, `hook_text`, `script_text`, `caption_text`, `cta_text`,
  `target_duration_min/max_seconds`, `video_template`, `video_storyboard`, `cover_settings`.
- Stages: idea_selection → initial_approval → in_design → final_approval → ready_to_publish → scheduled → published.
  A revision comment cancels pending YouTube jobs (`comment_auto_revision`), and rescheduling moves them too.
- Published text = `SSMPDPublicationText.compose()`: hook + caption + CTA + clinic address, phone and WhatsApp.
- Videos are vertical reels, made for Facebook/Instagram/TikTok. That makes them good YouTube Shorts.

## 2. What the YouTube box in the publish tab covers today

| Field | Today | Needed |
|---|---|---|
| Channel (sono / dr_dina) | ✅ follows the page chosen | — |
| Title ≤100 | ✅ prefilled from the item title | Add a counter and a warning if `#Shorts` is missing on Shorts |
| Privacy public/unlisted/private | ✅ | Default to **private** until Google's audit passes (YouTube locks it to private anyway) |
| Short / long | ✅ checkbox | Check it automatically: ≤3 min and 9:16 → Short |
| Description | ⚠️ the Facebook text is reused | Its own YouTube description: 2-line summary + clinic info + health notice + hashtags |
| Tags / hashtags | ❌ | Field, max 15 hashtags, 500 characters of tags |
| Category | ❌ (unknown what the worker sends) | Fixed: **26 Howto & Style** or **27 Education**; recommend 27 |
| Made for kids | ❌ in the UI | Always `selfDeclaredMadeForKids=false`, sent by the worker, shown read-only |
| Language | ❌ | `defaultLanguage=ar`, `defaultAudioLanguage=ar` |
| Thumbnail | ❌ | Long videos only: upload 1280×720 (`thumbnails.set` needs the channel to be phone-verified) |
| Playlist | ❌ | A playlist per specialty (needs the `youtube` scope — leave for later, add by hand in Studio) |
| Chapters | ❌ | Long videos: timestamps in the description (`00:00 …`) |
| Consent check | ❌ | Required tick: "no patient face or data, or written consent on file" |

The upload worker (`swnw-youtube-publish`) lives in the private infra repo, which this session can't open.
Category, made-for-kids, language and tags have to be checked and added there. Dashboard changes need a
migration (`youtube_publish_jobs`: `description`, `tags text[]`, `category_id`, `thumbnail_path`,
`consent_confirmed`) and a PR.

## 3. Content system per channel

### Shorts (both channels): reuse every approved reel
- Vertical 9:16, 1080×1920, **≤60s** (YouTube accepts up to 3 min, but ≤60s performs best).
- Hook in the first 2 seconds (`hook_text` on screen and in the voice), burned-in Arabic captions (already done).
- Title ≤100 characters: question or result + specialty + area, e.g.
  `تبييض الأسنان بيضرّ المينا؟ 🦷 | عيادات سونو حدائق الأهرام #Shorts`
- Description:
  1. Two lines on what the video says.
  2. `⚠️ المعلومات دي توعوية ومش بديل عن الكشف. استشير الطبيب قبل أي علاج.`
  3. Address / phone / WhatsApp (same as `publication-text.js`).
  4. 3–5 hashtags: `#Shorts #عيادات_سونو #حدائق_الأهرام #<التخصص>`.
- Don't bring TikTok/Instagram watermarks over (YouTube ranks those lower).

### Long videos (5–12 min)
| Type | Structure | Channel |
|---|---|---|
| Doctor explainer | Hook 15s → who it's for → what happens → myths → when to see a doctor → CTA | both |
| FAQ (10 questions) | One chapter per question | sono |
| "What to expect at your visit" | Reception → exam → after → price range "starts from" with no promises | sono |
| Dr. Dina — expert talk | Personal explanation, case stories with no identifying details | dr_dina |

- Chapters in the description: `00:00 مقدمة`, … (first one must be 00:00, at least 3, each ≥10s).
- Thumbnail 1280×720: the doctor's face + 3–4 big words, brand colors #0F369D / #F15A22, fonts
  "Hiragino Kaku","BigVesta Arabic". No before/after photos of patients.
- Title ≤70 characters visible: keyword first. `زراعة الأسنان: المراحل والمدة والتكلفة | د. …`

### Medical-content rules (required for every video)
- No diagnosis and no promises ("علاج نهائي"، "مضمون ١٠٠٪"، "بدون أي ألم").
- Nothing that contradicts health authorities (Egyptian Ministry of Health / WHO). YouTube's medical
  misinformation policy removes this and gives the channel a strike.
- No patient face, voice, name or file without **written** consent kept at the clinic. Blur when unsure.
- Before/after: only with consent, and with "النتائج بتختلف من شخص للتاني".
- The doctor's name and specialty on screen in explainers (this helps YouTube's health-source labels).
- No prices as a promise. Write "ابتداءً من" or "حسب الحالة".

### Egyptian Arabic keywords (starting list)
- أسنان: تقويم الأسنان، زراعة الأسنان، تبييض الأسنان، حشو العصب، دكتور أسنان حدائق الأهرام
- ليزر: إزالة الشعر بالليزر، جلسات الليزر كام جلسة، ليزر للرجالة
- علاج طبيعي: علاج الانزلاق الغضروفي، آلام الضهر، علاج طبيعي بعد الكسور
- عام: عيادات حدائق الأهرام، دكتور قريب مني ٦ أكتوبر، كشف أطفال

### Playlists (create them by hand in YouTube Studio)
sono: أسنان · ليزر وجلدية · علاج طبيعي · أطفال · تغذية · "زيارتك للعيادة" · Shorts نصايح سريعة.
dr_dina: by her specialty + "أسئلة المتابعين".

### Posting cadence
- Shorts: 4–5 a week per channel (from the reels already approved).
- Long: 1 a week on sono, 2 a month on dr_dina.
- Same time slot each day (start at 8–9 PM Cairo time and adjust from Analytics after 4 weeks).

## 4. Google forms: ready-to-paste answers

### OAuth consent screen
- App name: **Swnw Social Publisher**
- User support email / developer contact: the center's official email
- App home page: `https://dashboard.swnwclinics.com/`
- Privacy policy: `https://dashboard.swnwclinics.com/privacy.html` (YouTube section added in this PR)
- Terms: `https://dashboard.swnwclinics.com/terms.html`
- Authorized domain: `swnwclinics.com` (verify it in Google Search Console with the same Google account)
- Scopes: `youtube.upload`, `youtube.readonly`

### App purpose (English, for the form)
> Swnw Social Publisher is the internal content-production dashboard of Swnw Specialized Clinics (Hadayek
> El Ahram, Giza, Egypt). Staff write, design and approve educational health videos inside the dashboard. After
> two human approvals, a super admin schedules an approved video, and our server uploads it to the clinic's own
> YouTube channels (2 channels, both owned by the clinic). The app is used only by our staff. It never publishes
> on any other channel and never reads viewer data.

### Scope justification
- **youtube.upload**: "Needed to upload the clinic's approved videos (Shorts and long videos) to the clinic's own
  channels at the scheduled time, with title, description, privacy status and made-for-kids = false. Uploads run
  only after two staff approvals in our workflow."
- **youtube.readonly**: "Needed only to read the connected channel's id, title and thumbnail. We show them in the
  dashboard so staff can confirm which channel a video will go to before scheduling, and to read the status of
  our own uploaded videos. We do not read subscribers, comments or analytics."

### YouTube API Services: audit form (so uploads can be public)
- Use case: "Scheduled upload of first-party content to 2 channels we own; no third-party users."
- Quota: default 10,000 units/day is enough (1 upload ≈ 1,600 units → about 6/day). Ask for **no** increase now.
- Data storage: refresh token only, server-side, never shown to users; deleted when the channel is disconnected.

### Demo video script (2–3 min, screen recording, English captions)
1. Open `https://dashboard.swnwclinics.com/`, log in as super admin (show the URL bar).
2. Publish tab → open an approved video → tick YouTube → the YouTube box appears.
3. Click «ربط قناة يوتيوب» → show the Google consent screen with **the app name and both scopes**,
   choose the clinic channel → Allow → back to the dashboard showing the channel name.
4. Fill the title, choose privacy "Private", schedule 5 minutes later.
5. Show the job status turn to published, and open the video in YouTube Studio (it is on the clinic channel).
6. Show the privacy page's YouTube section and where to revoke (Google account → Security → Third-party access).
Upload it to YouTube as **Unlisted** and paste the link in the verification form.

## 5. Owner steps in Google Cloud (summary — the chat gives them one at a time)
1. https://console.cloud.google.com/projectcreate → project name `Swnw Social Publisher`.
2. https://console.cloud.google.com/apis/library/youtube.googleapis.com → **Enable**.
3. https://console.cloud.google.com/auth/branding → fill in section 4 above.
4. https://console.cloud.google.com/auth/scopes → add the two scopes.
5. https://console.cloud.google.com/auth/clients → Create client → **Web application** →
   Authorized redirect URI: `https://api.swnwclinics.com/functions/v1/youtube-auth`.
6. Copy the Client ID and Secret **straight into** the dashboard: publish tab → tick YouTube → «حفظ بيانات التطبيق».
   Never send them in chat.
7. https://console.cloud.google.com/auth/audience → **Publish app** → In production → submit verification.
8. Connect `sono`, then `dr_dina`, each logged in with the Google account that owns that channel.
