# TikTok Content Posting API: audit submission pack

Goal: get the dashboard's TikTok app audited, so reels post **publicly** to the Sono TikTok account, the
same way Facebook and Instagram already do.

## Why posting fails today

- Until the audit passes, TikTok only lets an app post to **private** TikTok accounts, with limits on
  users per day. The Sono account is public.
- So the only real attempt (job `08c6df4e`, 2026-11-10, privacy "Only me") was refused with
  *"Please review our integration guidelines"*.
- The worker now shows this case in Arabic:
  - "تطبيق الداشبورد لسه مستني مراجعة TikTok".
  - It is not retried automatically.

## What the post screen does now (Content Sharing Guidelines)

Code: `assets/js/tiktok-post-panel.js`, opened from the Publish tab card → Platforms → TikTok.
Tests: `tests/tiktok-post-panel.cjs` and `tests/tiktok-audit-sql.cjs`.

The guidelines are at https://developers.tiktok.com/doc/content-sharing-guidelines/. That site is
blocked from the build environment, so the rules below were checked against TikTok's guideline summary and
public audit write-ups. **Re-read the live page once before submitting.**

| Guideline | How the dashboard does it |
|---|---|
| Fetch the latest `creator_info` when the post page renders | Fetched every time the TikTok box opens or the page (brand) changes. No cache. The worker fetches it again right before uploading. |
| Show which account receives the post | Avatar, nickname and @username: "Posting to …". |
| Preview of the content | Video player (or Drive preview) inside the TikTok box, plus the full post preview before the final confirm. |
| User can edit the title/caption | Caption box, prefilled from the approved caption, max 2,200 characters. That exact text is sent. |
| Privacy options = `privacy_level_options`, **no default** | The dropdown only lists the returned options and starts on "Select privacy". Posting is refused until the user picks one. |
| Comment / Duet / Stitch | All unchecked by default. Greyed out and locked when the account disabled them (`comment_disabled`, etc.). |
| `max_video_post_duration_sec` | Shown in the box. The video length is read from the player. Posting is blocked if the video is too long, and the worker checks again. |
| Account can't post (daily cap / banned / user cap) | The box shows the reason and the post buttons are disabled. |
| Commercial content disclosure | "Disclose video content" toggle, off by default, with the "Your brand" and "Branded content" options. If it is on and neither option is picked, the buttons are disabled with: "You need to indicate if your content promotes yourself, a third party, or both." |
| Labels | Your brand → "Your video will be labeled as 'Promotional content'". Branded (or both) → "… 'Paid partnership'". |
| Branded content can't be private | "Only me" is disabled with: "Branded content visibility cannot be set to private." The database also refuses it. |
| Declaration | Normal posts: "By posting, you agree to TikTok's Music Usage Confirmation." Branded posts: "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation." Both have links. In English mode the wording is TikTok's own. |
| Explicit consent before upload | Consent checkbox, then the preview dialog with a confirm button. Nothing is sent to TikTok before that. |
| AI-generated content | Optional toggle, sent as `is_aigc`. |
| Processing notice | "TikTok may take a few minutes to process the video…". Status and the post link appear on the card. |
| No watermarks / no changes to the video | The file is uploaded as approved (FILE_UPLOAD, chunked). |

## Fields to paste in the TikTok developer portal

**App name:** Swnw Content Dashboard (keep the current name if it is already set).

**Category:** Business / Productivity.

**Platform:** Web.

**Website URL:** https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/

**Terms of Service URL:** https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/terms.html

**Privacy Policy URL:** https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/privacy.html

Both pages have an English section at the bottom (`#en`), added in this PR, so they are live only after it
merges.

**Login Kit Redirect URI** (must match exactly; the server moved on 2026-11-10):
`https://api.swnwclinics.com/functions/v1/tiktok-auth`

If the old `https://uuijfbpgvtdxgaosqpxo.supabase.co/functions/v1/tiktok-auth` is still listed, keep it
or remove it; only the new one works now.

**App description (paste):**

> Swnw Content Dashboard is the internal publishing tool of Swnw Specialized Clinics Medical Center (Cairo,
> Egypt). Our marketing team plans, writes, designs and approves short educational health videos for the
> center's own TikTok account in a review workflow (idea → approval → design → final approval). When a video is
> approved, a staff member opens the Publish tab, sees the connected TikTok account (avatar and nickname), a
> preview of the video and its caption (editable), chooses who can view it from the options TikTok returns, sets
> comment/duet/stitch permissions, discloses commercial content if any, reads TikTok's Music Usage Confirmation,
> consents, and posts now or at a scheduled time. The video is uploaded with the Content Posting API (Direct
> Post) to the center's own account only. The tool is used by a small team of authorized staff, posts only the
> center's own content, and never reads followers, messages or other accounts' data.

**Products / scopes and why (paste one per scope):**

- **Login Kit, `user.info.basic`:**

  > Used once when a staff member connects the center's TikTok account, and to show the account's display
  > name and avatar on the post screen, so the user always sees which account will receive the video. We
  > do not store or use any other profile data.

- **Content Posting API, Direct Post, `video.publish`:**

  > Used to publish videos that our team has approved to the center's own TikTok account, directly from
  > our dashboard. Before every post the user sees creator info, picks the privacy level (no default),
  > interaction settings and commercial disclosure, previews the video, and consents. We use FILE_UPLOAD
  > with chunked upload and poll the post status to show the result to the team.

**How the reviewer can test (paste if asked):**

> The dashboard is internal (staff login only). The demo video shows the full flow end to end on our real
> account. If a test login is required, tell us and we will create a temporary reviewer account limited to the
> Publish tab.

Only offer a reviewer login if TikTok actually asks. It would be a real staff account: the super admin
creates it with the page_manager role and removes it after the review.

## Demo video script (screen recording, about 2–3 minutes, phone or laptop)

Record in **English mode** (some older labels around the card stay Arabic — fine; the TikTok box, buttons and declaration are English): the EN button at the top of the dashboard. Show one take, without cuts, from
login to the published post. Use a short, approved Sono reel that you are happy to make public.

1. Open the dashboard link and log in. Point out the address bar (shows the website URL).
2. Press **EN** to switch the interface to English.
3. Open the **Publish** tab and pick an approved video. Press **Open details**.
4. Choose the page **Sono**. Tick **TikTok** in the platforms.
5. Stop for 2 seconds on each of these:
   - "Posting to" with the avatar and nickname (TikTok account).
   - The video preview: press play for a second.
   - The maximum video length line.
6. Edit the caption a little (add a hashtag), to show it is editable.
7. Open the privacy dropdown. Show it starts on "Select privacy". Show the options. Choose **Everyone**.
8. Tick **Comment**. Leave Duet/Stitch as they are, or tick them. Show that a greyed option can't be ticked,
   if the account has one.
9. Turn on **Disclose video content**:
   - Show the posting buttons become disabled and the hint appears.
   - Tick **Your brand**: show the "Promotional content" label.
   - Tick **Branded content**: show the "Paid partnership" label. Open the privacy dropdown and show "Only
     me" is disabled. Show the declaration changes to "Branded Content Policy and Music Usage Confirmation".
   - Untick both and turn the toggle **off** again (the real post is not commercial).
10. Show the declaration "By posting, you agree to TikTok's Music Usage Confirmation". Tap the link once,
    then come back.
11. Tick the consent box. Press **Publish social now**.
12. The preview dialog opens. Scroll it. Press **Confirm**.
13. Show the card status "processing". Wait about a minute and refresh. Show "Published" and the TikTok link.
14. Open the link: the video is on the Sono TikTok profile.

Before the audit passes, step 13 fails for a public account. That is expected, and TikTok's audit form
says so. If you prefer, record steps 1–12, then show the failure message.

⚠️ Recording this video publishes a real post. Do it only after the owner approves that specific video.

## "Send to TikTok as a draft" (works before the audit)

Approved by the owner on 2026-11-16 ("موافق على زرار المسودة").

**What it is**
- It uses the Content Posting API **Upload** flow (scope `video.upload`, `/v2/post/publish/inbox/video/init/`).
- The video lands in the TikTok app's inbox as a draft. The owner pastes the caption, picks the cover and taps
  Post in TikTok.
- Third-party guides agree this flow works for unaudited apps and public accounts. The audit restriction is on
  Direct Post. TikTok's own docs could not be opened from the build environment, so re-check this once in the
  portal.
- One guide mentions a limit of about 5 pending drafts per 24 hours. Send a few at a time.

**Where the button is**
- Dashboard → Publish tab → bottom box "TikTok — فيديوهات لسه ماتنشرتش عليه". Only the super admin sees it.
- The box lists videos with a file and no TikTok link.
- A press does three things:
  1. Copies the caption to the clipboard.
  2. Calls `queue_tiktok_inbox_draft(content_id)`. This is super admin only, refuses a second draft of the
     same reel unless the first failed, and writes to `activity_log`.
  3. The `tiktok-publish-process` worker uploads the video within a minute.
- The content item itself is never changed.
- The hub page (hub.swnwclinics.com/assets/tiktok-reels/) can keep showing the reels. For sending, open the
  dashboard's Publish tab: this needs no new endpoint, no CORS and no CSP change on the hub.

**After the audit passes:** set `tiktokDirectPostAudited: true` in `config.js` (one line). The same button then
opens the full Direct Post panel (caption, privacy, interactions, disclosure) and posts directly.

**Setup, in order** (the main chat deploys; the owner does the portal step):
1. Apply migration `20261118040000_tiktok_inbox_drafts.sql`. Deploy `tiktok-auth` and `tiktok-publish-process`.
   - This is safe before the portal step: the current token keeps refreshing with its old scopes.
2. TikTok portal → our app → Products → Content Posting API: make sure **Upload** is on and the scope
   `video.upload` is added. Press Submit/Save. If TikTok asks for an app review for the new scope, wait for it.
3. Only after step 2, the owner reconnects the Sono TikTok account once from the dashboard: Publish → a video →
   TikTok → "ربط حساب TikTok". That grants `video.upload`.
   - Until then, the button answers "أعد ربط حساب TikTok…".
   - Reconnecting before step 2 fails on TikTok's page.

Rollback: `supabase/rollbacks/20261118040000_tiktok_inbox_drafts.rollback.sql`. It deletes the draft rows.

## After approval

- Nothing to change in the code: the same screen posts publicly.
- About 16 Sono reels from 28 Oct onwards never went to TikTok. The main chat is giving the owner a
  manual-posting page for those, so don't publish them from here.
