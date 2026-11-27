# Meta App Review: Advanced Access for `pages_read_user_content`

App: «SwnW Social Publisher» (App ID 922152600507851), Page 181076558423040.

## Why we need it
Probe on 2026-11-24 (page token, `GET /v26.0/{comment}?fields=id,from{id,name}`): `from` is absent on every recent comment. The token already lists `pages_read_user_content`, but with Standard Access Meta only returns commenter identity for people with a role on the app. 3211 of 3221 stored Facebook comments have no author name, so the inbox cannot show who commented.

## Click path (labels may differ slightly; Meta changes the UI)
1. developers.facebook.com → My Apps → «SwnW Social Publisher».
2. Left menu → App Review → Permissions and Features.
3. Search `pages_read_user_content` → Request advanced access.
4. Complete the checklist shown (Business Verification must be Verified first; Data Use Checklist; Privacy Policy URL; Data Deletion instructions).
5. Paste the use case text below, upload a screencast (see below), Submit.

## Use case text (English)
Swnw Specialized Clinics Medical Center uses an internal dashboard to manage the comments left on its own Facebook Page. Staff read the comments, see who wrote them, and reply from one inbox, so no patient or customer waits unanswered. We request pages_read_user_content only to read the name of people who comment on our own Page's posts, to address the reply to the right person and to match a commenter with the same person's private conversation. We do not collect data from other pages or groups, do not sell or share the data, and do not use it for profiling. Data stays in our own database and can be deleted on request.

## نص الاستخدام (عربي)
مركز عيادات سونو التخصصية يستخدم لوحة داخلية لإدارة التعليقات على صفحته الرسمية على فيسبوك. الموظفون يقرأون التعليقات ويشوفوا اسم صاحب كل تعليق ويردّوا من صندوق واحد عشان محدش ينتظر من غير رد. بنطلب صلاحية pages_read_user_content لقراءة اسم اللي بيعلّق على بوستات صفحتنا بس، عشان الرد يتوجه للشخص الصح وعشان نربط صاحب التعليق بمحادثته الخاصة. مش بنجمع بيانات من صفحات أو جروبات تانية، ومش بنبيع البيانات أو نشاركها، ومش بنستخدمها في تحليل أو استهداف. البيانات بتفضل في قاعدة بياناتنا وبتتمسح عند الطلب.

## Screencast (what to record, 1-2 minutes)
Log in to the dashboard → open «التعليقات» → open a comment on a Facebook post → show the commenter name and the reply box → send a reply → show it on the Page.

## Notes
- Do not claim more than the dashboard does. Reviewers compare the screencast to the request.
- Business verification is pending (needs the backup admin and the legal-name fixes); advanced access normally requires it.
