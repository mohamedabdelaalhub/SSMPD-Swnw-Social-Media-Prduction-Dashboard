# Owner agreements: everything «UI & UX 4» inherits (compiled 2026-11-22)

Sources: transcripts of «UI & UX 1» (U1, session_01UqVZHZihapbfrPRQkyZErA, 11-17→11-18), «UI & UX 2» (U2, session_01UqVZHaDzDHmJj9fGDp8Czf, 11-18 22:39→11-19 01:36), «UI & UX 3» (U3, session_01UqVZHaB84bosb26ToEYYkt, 11-19→11-22), «UX audit» (UXA, session_01UqVZHXcvGgk7oVnSnFsg6m, 11-21 22:49→11-22 08:39). Also the handoff docs: `HANDOFF-UI-UX-20261118.md` (branch `origin/claude/ui-ux-handoff-20261118`), `HANDOFF-UI-UX-20261119.md` (`origin/claude/ui-ux-handoff-20261119`), `HANDOFF-UI-UX-3-20261122.md` (`origin/claude/handoff-ui-ux-20261122`), the U1 and U3 compaction summaries, and `docs/ui-references/README.md`.
Note: `docs/ui-references/HANDOFF-UI-UX-3-20261119.md`, which the 1122 handoff cites, **does not exist on any branch**. The real earlier files are the two `HANDOFF-UI-UX-2026111{8,9}.md` files above.
Gap: I only reached U3's 11-19→11-21 21:05 stretch through its compaction summary, so its "owner UI rules" list is consolidated, not verbatim. Owner messages that were only images were not readable.
Items marked **[NEW]** are not in any handoff or README.

---

## 1. Communication and process rules

1. **Language.** Reply to the owner in Egyptian Arabic only, never English, even for technical topics. Code, commits, PRs and messages to other chats may be in English. Copy this rule into any sub-agent prompt. (CLAUDE.md 11-16; every handoff)
2. **Owner profile.**
   - He is non-technical and works from his phone.
   - Never give him terminal commands.
   - Ask for a screenshot when something is unclear.
   - Keep replies short, with images. (U1, U3)
3. **Model.** This chat runs on Sonnet, set by the main chat. Never switch models and never ask the owner to, unless the main chat agrees. Sub-agents get an explicit model: Sonnet for UI and docs, Haiku for read-only searches. (U1 peer rule 11-18 19:32)
4. **Mockup first («تصور» / «ارسم التصور»).** Nothing is built before the owner types **«طبقه»** (also «طبق اللي اتعمل»). (All sessions)
   - **[NEW] Mockups must be INTERACTIVE HTML** that he can click: buttons open things, chips filter, cards open. Make it a single file with the fonts embedded as base64, send it with SendUserFile, and say «مفيش حاجة بتتحفظ». A static picture saved as .html makes him angry: «انت بتشتغلني يا اسطى، انت مديني نفس التصور اللي انت عامله صورة على HTML. انا عايز اشوف التصور الجديد بتاعك على HTML، اقدر ادوس على زرار يفتح لي كده يعني.» (UXA 11-21 23:07)
   - He also asked «عايز اشوفه html الاول» before approving. The default deliverable is therefore a before/after image plus an interactive HTML file. (UXA 23:06)
   - A before/after image is the standard: «قبل» on the right, «بعد» on the left, with a 390 mobile version and the opened card underneath. (UXA 11-21 22:56–23:04)
   - Earlier chats published mockups as private artifacts. That still works, but he did not like artifacts that open as code («بتفتح كود مش صفحة», U3 11-20). Give him a real rendered page.
5. **QA before any image is sent.**
   - `layout-check.cjs` must PASS at 390 and 1280/1440. Add 360 for reception screens. (UXA ran 360/390/768/1440.)
   - Check clipped text and overlap («النصوص داخلة في بعضها اتأكد ان النصوص واضحة علي كل الشاشات», UXA 11-21 23:22).
   - Run text-fit-check too.
   - Always regenerate the jsdom HTML dump before a screenshot. A stale dump once showed old colours, and he noticed. (U3 summary)
6. **«احنا ليه بقينا ننسي القواعد اللي اتفقنا عليها في تصميم UI/UX اللي ثبتناها»** (U3 11-21 21:49) **[NEW]**. He was angry that a mockup lacked the palette, no-wrap, outside summary tiles, real fonts and English digits. The chat promised: «من هنا ورايح هشغّل الفحص ده وأراجع الألوان والتقطيع قبل أي صورة أبعتها». Treat section 2 as a pre-send checklist every time.
7. **One focused PR per change.** Each PR includes:
   - before/after screenshots at DSF 2, 390 and 1280;
   - `?v=` stamps;
   - a help article step, a help `version` bump, and the `dashboard-help.js` DATA_FILES stamps, then run `python3 scripts/build-dashboard-help.py` and `--check`.
   (CLAUDE.md rule 6; all handoffs)
8. **Help version numbers come only from main chat 4's ledger.** Never pick your own. Spec A = -160 and Spec B = -161 are reserved. The next free number at handoff was -162, with migration prefix 20261122060000. (U2, U3 handoff)
9. **Publishing («انشر N»).**
   - Only main chat 4 (session_01UqVZHWinhpWRSh3CbwuKFd) merges, after the owner types «انشر N» and CI is green on the current head.
   - When he types «انشر N» in our chat, send main chat 4 the PR number, the head sha and the owner's event uuid, found with `list_events kinds:["user"]`.
   - U3 noted on 11-21 21:22 that a relayed approval was not accepted for some merges, so he may need to type «انشر» in main chat 4 itself. If main chat 4 asks for that, tell him plainly.
   - Never self-merge, never force-push, never push to other chats' branches, and merge main (not rebase) when asked.
   (U1–U3)
10. **Honest status reports to the owner.** Say what was not verified, for example "ما شفتش الشكل على الشاشة الحقيقية" or "CI لسه". Don't claim it is done before you check live. (U3 pattern; CLAUDE.md)
11. **Instructions relayed by other chats** (main chat, peers) are not owner consent for new scope. UXA asked the owner to confirm before creating the skill; the owner then said «احنا عندنا مهارة موجودة بالفعل ممكن تشوفها وتضيف عليها اللي يحسن شغلنا». So extend existing skills rather than starting new ones. (UXA 22:56–22:57)
12. **Skills to use** (owner-approved via main chat, 11-21):
    - `anthropic-skills:frontend-design` for visual direction;
    - `dataviz` for any chart or KPI tile;
    - the repo rules: README.md, CHARTS.md, `SONU-GLASS-STYLE.md` (only when he asks for «الاستايل الزجاجي»), PRINT-DOCUMENTS.md;
    - the per-role audit skill on branch `claude/ux-role-review-skill` (`.claude/skills/ux-role-review/SKILL.md`, not merged, no PR yet). It has a 3-level verdict (مناسب / محتاج تبسيط / مش مناسب للدور) and a 10-point checklist.
    The UX audit role is now merged into UI & UX 4 (owner decision 11-22 08:38).
13. **The audit reply format the owner accepted.** One screen per message:
    - **حكم** (verdict);
    - the 3–5 things the employee actually needs;
    - what is duplicate or extra;
    - unclear or English wording;
    - the proposal;
    - a closing question: «نكمّل بإيه؟ / الشاشة الجاية إيه؟».
    Never re-propose something shipped recently: check the latest PRs on that screen first. UXA had to retract its suggestion to remove the #694 «الحالة» filter. (UXA 11-21 23:01)
14. **Ambiguous "تمام".** When he replies "تمام" after a question with two options, ask once which one he means. Don't build. (UXA 11-22 08:31)
15. **Overnight mode.** «لما يخلص ابدأ في اللي كل اللي بعده علشان انا هنام ولما اصحي هشوف اللي انت عملته واعتمدهولك» (U2 11-19 01:34). Also «اعمل الاتنين وانجز» and «كمل / وكمل / أبدأ وكمل بالترتيب» (U1). He likes chats that keep working through the queue: mockups → wait for «طبقه», then the next item.
16. **Security** (U1):
    - never request his Instagram/Pinterest passwords;
    - never commit secrets;
    - no paid installs without his OK;
    - no Supabase MCP for dashboard tables;
    - no model identifiers in commits or PRs.
17. **Training material.** Save walkthrough videos for staff training. For example, `team-performance-walkthrough.mp4` was referenced in a help article. (U1 summary)
18. **Owner's reusable skill.** «عايز اللي انت عملته دا مهارة وسميها كفر لتر سونو الرسمي علشان اي شات تانية تعمل زي اللي انت عملته كدة». It was shipped as `.claude/skills/swnw-official-cover-letter` (#597). (U2 11-19 01:21)

## 2. Visual rules

1. **Identity.**
   - Fonts: `"Hiragino Kaku","BigVesta Arabic"`, local WOFF2 only, never Google Fonts. Mockups must use the real repo fonts: `@font-face ../../../assets/fonts`, or base64 for sent files.
   - Brand colours: `#0F369D` brand, `#F15A22` accent, `#16212E` ink, `#2F7D5C` positive, `#D0402A` negative.
   - The name is «Swnw».
   - RTL first.
   (CLAUDE.md, all)
2. **Status palette** (owner's picks via the colour picker, 11-17):
   - on time / new: `#00B0BD`
   - late / soon: `#FF8800`
   - absent: `#FF0000`
   - leave / old: `#525B6F`
   - none / not scheduled: `#F1F4F8`
   Always pair a colour with a legend or label.
3. **Text on coloured chips.**
   - The original rule was dark grey `#333` on teal and orange.
   - **Owner overrides:** a white number on the orange bell badge («لا خلي الرقم ابيض علي البرتقالي», U3 11-20), and **the «جديد» chip in white text on teal** («جديد خليها أبيض مش رمادي», U3 11-21 21:51).
   - White on `#525B6F` («قديم»).
   - When in doubt, show him both options.
4. **Digits are English (Latin) everywhere.** Use `ar-EG-u-nu-latn` for Arabic dates, for example «الأحد 22 نوفمبر». The UXA mockups showed Arabic-Indic digits («٢٢»), but the spec code uses latn, so follow latn. (U3 rule list; handoff)
5. **No wrapping inside buttons, chips, tiles or KPI lines, and no sideways scroll at any width.**
   - Use `.btn` nowrap with care: it has broken tile grids before (#674).
   - Use `minmax(0,1fr)` and `overflow-wrap:anywhere`.
   - Keep 44px touch targets and 16px inputs on phones.
   (U1, U3)
6. **No ugly gaps.** One gutter, aligned edges and equal column ends (layout-check).
   - Spacing: 16px on desktop and 12px on phones.
   - Use more line spacing when text feels cramped. (UXA fix)
7. **Summary and total buttons ALWAYS open a popup** with the list. They never filter in place, and one button never does two things: «انا عايز الزراير اللي فيها اجماليات دايما لما ادوس عليها تفتحلي بوب اب، علشان انا تايه، لما بدوس علي زرار فيه اتنين بتتوهني» (U1 11-18 22:19).
   - **Summary tiles sit outside popups** (on the screen, opening the list), not inside them. (U3 rule list, 11-21)
8. **Fewer details per row.** «مش عايز الموظف ظاهر معاه تفاصيل كتيرة … عايز القسم يبقي أروق وتفاصيل أقل ولما ادوس علي قسم او موظف يفتحلي البوب اب فيه التفاصيل». The pattern: a calm card, then a tap opens a popup with full details, with ✕/outside/Esc to close and «رجوع» to go back. (U1→U2 #595)
9. **Long lists.** «الشاشات الطويلة دي محتاجة طريقة أفضل في عرضها» → summary tiles plus a searchable, paged popup (#683).
   - «الحساب والفواتير بقا طويل جدا … collapsed … ظاهر آخر ٥ عمليات بس» → show the last 5 of each list plus «عرض الكل (N)» / «إظهار آخر 5 فقط».
   - Fold extra tools into a closed «أدوات إضافية» card (#705).
   - Loose buttons get grouped: «متسابين علي الشارع كدة … نلمهم في زرار او اتنين او حتي ٣» → groups «أدوات وإعدادات» and «الإدارة والتشغيل» (#667).
   (U3)
10. **Avatars are icons**, and use real line icons rather than an «أخرى» bucket. (U3 rule list; U1 #554)
11. **Wording.** Use «ماسا الجديد», not «الحالية». (U3)
    - Use plain Egyptian labels with no internal codes: «رقم الملف N», not «ملف F3» or DEMO-001.
    - Use Arabic month names for dates, not `11/22/2026`.
    - Leave no English leftovers. (UXA)
12. **Status chips are soft tinted pills.** Zero counts are muted: no orange "alarm" at 0.
    - Use one main button per row or card, and put the rest under «⋯».
    - A completed or cancelled item is struck through.
    (README; UXA)
13. **Opened card.** Use a neutral card with a status-coloured side bar, not a solid green block. (UXA spec B)
14. **Confirm before action** (#689, owner request «عايز لما ادوس على أي إجراء يديني تنبيه فيه تأكيد أو تراجع»):
    - title «تأكيد: <الإجراء>»;
    - the patient name and file number;
    - a one-line effect that says whether it can be undone;
    - buttons «تأكيد» / «تراجع»;
    - red confirm for actions that can't be undone (إنهاء الزيارة, لم يحضر, إلغاء, بدأ الكشف);
    - a note with the amount if the patient still owes money at «إنهاء الزيارة»;
    - on mobile, a bottom sheet with «تأكيد» above «تراجع»;
    - no confirm for open-only actions (details, timeline, collect, forms).
    Mistakes undone within about 2 minutes must not pollute KPIs («مش عايز أخطاء دي تحصل كتير علشان المؤشرات بعدين») → toast «اتشال بالغلط — مش هيتحسب في المؤشرات» (#691/#703). (U3 11-21)
15. **Motion and sound** (approved 11-17, `ui-motion.js`/`ui-motion.css`):
    - press: 0.97 scale with a tick;
    - hover lift only on `hover:hover`;
    - success: a drawn check with two notes;
    - error: a shake with a low tone;
    - no sound on hover;
    - respect `prefers-reduced-motion`;
    - a per-user sound toggle in «إعداداتي».
    (README)
16. **Charts** (CHARTS.md/dataviz):
    - time runs left to right inside an LTR box;
    - no unit signs on axes (put the unit in the subtitle);
    - tooltips plus a table view.
    - Masa net chart colours were picked by the owner himself: income `#00B0BD`, payouts `#FF8800`, net line `#003DB8`, bars at full opacity, expense-kind colours unchanged.
    - When he wants to choose colours, give him the colour-picker tool page («اديني التول اللي عملناها علشان اعدلك الالوان وانا هختار بنفسي»). (U3 11-20)
17. **Greens are calm.** «جميل بس عايز اللون الأخضر اهدي شوية» (U1 team performance #576).
18. **Printed invoices and receipts** use `swnw-print.js` on the official letterhead, with no centre name in the title (CLAUDE.md rule 7).
19. **Dark-blue hero leak.** Nothing may be injected inside the blue `.rx-header` hero; place boxes below it. This mistake was repeated twice (#683, #706).

## 3. Screen-specific decisions

**Header and navigation** (U3, 11-20)
- Header v2: a single-row header with unified SVG icons.
- The user menu holds language, kudos, help and logout.
- The bell badge is smaller, with a white number on orange, capped at «99+» (owner said «موافق»).
- The main menu drawer opens from the **left** («ممكن نخلي القايمة دي لما تفتح تبقي علي الشمال مش اليمين»).
- The bottom of the open drawer must be visible: thin visible scrollbar, scroll shadows, compact footer.
- Loose menu buttons fold into «أدوات وإعدادات» / «الإدارة والتشغيل» (#666/#667).

**Masa** (U3, 11-20/21)
- «صافي القديم (ماسا)» report (#674) uses the colours above, and the hero tile stays blue `#0F369D`.
- «أرشيف ماسا» is read-only search (#665).
- The no-time list is split new/old **by service name**, not by date. The owner explained: «بنفتح حجز جديد … بنكتب الخدمة المطلوبة استشارة و لو اسنان بنكتب استكمال … لكن مش بنكتب التاريخ القديم فالحجز الجديد». So «استكمال» = قديم and كشف/استشارة = جديد.
- He also said: «اعمل حسابك انه ممكن يكون فيه مواعيد مستقبلية زي بكرة او بعده او اي يوم في المستقبل». So the list is grouped by النهارده / بكرة / بعد بكرة / date.
- Two tiles outside the list («جديد» in white on `#00B0BD`, «قديم · استكمال» in white on `#525B6F`).
- Old items get «استكمال البيانات» and «نقل للأرشيف». The latter only dismisses the row; the patient file stays. (#697)
- Masa comparison alerts (#706):
  - placed below the hero, as a light-yellow card with dark text and an orange count circle;
  - one compact row per alert (patient · doctor · date · time) with «افتح الحجز» and «راجعته»;
  - more than 3 alerts → the first 3 plus «عرض كل التنبيهات (N)» opening a bottom sheet.

**تشغيل اليوم** (U3 + UXA, 11-21/22)
- The doctor «⋯» menu must not be clipped (#692).
- Filters: search (name, file number, phone, doctor) plus «الأطباء» and «الحالة» selects matching the booking list (#694). **The owner decided to keep «الحالة» in both screens**: «نسيبها في الاتنين».
- The 7 chips keep their names.
- SPEC A, approved with «طبق اللي اتعمل» on 11-22 08:34:
  - header: title, «حجز جديد» and «⋯»;
  - one Arabic date line with arrows; refresh and «يوم التشغيل» move into «⋯»;
  - the doctors strip collapses to one line, and «تفاصيل ⌄» shows the full cards including «صرف حساب الطبيب»;
  - one amber alert for the longest waiter with «نادي» (not «تحديد الأولوية»);
  - each chip shows time, name and short status;
  - the opened card shows the name once and «رقم الملف N», with one main button by status;
  - in the menu, الحساب and الخط الزمني are merged;
  - no «مدفوع» on patients who haven't finished; done and paid shows «✓ تم التحصيل».
  Full spec is in the 1122 handoff.
- **Owner: «عايزك تحافظلي علي التايملاين اللي كنت عامله، ممكن تحسن شكله لكن ماتلغيهوش»** (UXA 23:11). Improve the hour rail, never remove it. The vertical rail has a dot per hour, dimmed past hours and an orange «الآن · HH:MM» marker.
- Nursing and doctor_assistant views (no money, no «حجز جديد») are not yet reviewed.

**الحجز والاستقبال** (UXA SPEC B, approved 11-22)
- A small date line plus a big day name; the oversized «الأحد» title was clipping on mobile.
- Week strip:
  - one row Sat→Fri, no clipping at 360;
  - a dot on days with bookings;
  - holiday cell striped «أجازة», and the holiday notice stays.
- The 4 big tiles become small count chips (الكل / مؤكد / حضروا / لم يحضر), with zeros muted.
- Keep search, «الأطباء» and «الحالة». On mobile, search goes full width with the two selects in the next row.
- The floating «+» FAB is removed because it covered a patient; «حجز موعد» moves into the header.
- «تسجيل موعد يدوي» and the sound toggle («صوت التنبيهات: شغّال/مقفول») move into «⋯».
- Runs of empty hours collapse into «من H1 لـ H2 · فاضي».
- Opened card: one main button «تسجيل حضور»; the menu holds تأكيد / تغيير الميعاد / لم يحضر / إلغاء / ملف المريض; cancel and no-show go through the #689 confirm.
- Boundary between the two screens: **الحجز = bookings of any day; تشغيل اليوم = the live queue after arrival.**
- The owner asked «عايز افهم الفرق بين الشاشتين». The explanation he got: «الاستقبال والخدمات» is the big tab and «تشغيل اليوم» is one section inside it.

**الحساب والفواتير / requests** (U3, 11-21)
- Requests table (#704): columns «مقدّم الطلب» (name and time) and «اعتمده/رفضه» (name and note), with status in Arabic: معتمد / بانتظار المراجعة / مرفوض.
- On the extra buttons the owner asked «والجزء دا انا مش فاهمه … ليه فيه تفاصيل كتيرة اوي كدة»: they belong to other modules and are folded into «أدوات إضافية».
- In #705, «عرض الكل» expands in place: buttons inside a popup did not work.
- «المتابعة والتواصل» becomes its own reception section with Arabic message kinds and statuses (#712, open; owner already typed «انشر 712»).
- Section search finds reception sub-tabs and key actions (#698).

**Earlier screens, live, for consistency**
- Accounting (U1, 11-18):
  - side-rail shell and «نظرة عامة» overview;
  - tables become cards on phones;
  - one filled primary per section and a filled «حفظ»;
  - floating help and bot buttons never cover content, and stay fully on screen on phones (U3 11-20);
  - one period per screen.
- «أداء الفريق» (#576): 4 tiles and ranking, calmer green.
- «الملخص العام» v2 (#580).
- Admin user editor (#585): he said «لا تمام» to adding a confirm on the «مفعّل» switch for now.
- Home v2 and main menu v2 (#549–#557).
- Booking modal (U2):
  - searchable pickers;
  - patient search by phone, with the phone shown next to the name;
  - 3 numbered cards («مين المريض؟ / إيه الخدمة ومع مين؟ / امتى؟»);
  - switches for walk-in and external service;
  - sticky save bar;
  - phone bottom sheet (#596, never approved; check its status).
  - This came from an employee request: «عايزة بوكس سيرش … اكتب فيه اسم المريض او التخصص ويطلعلي اقرب حاجة».
- HR «الآن (مباشر)» (#595): totals open popups; calm department rows (name + status); tap opens details.
- Training module cards don't break titles letter by letter, and are full width on phones (U3 11-20).

## 4. Rejected or complained about (never repeat)

- **Static mockups dressed up as HTML** («انت بتشتغلني يا اسطى…»). (UXA 11-21 23:07)
- **Forgetting the agreed rules** in a mockup: palette, no-wrap, summary tiles outside, fonts, English digits, layout-check. (U3 11-21 21:49)
- Overlapping or clipped text on any screen width. (UXA 11-21 23:22)
- Stale screenshots or wrong colours. He spotted «لا دي مش الألوان اللي اخترتها» and «الألوان دي مش اللي انت واخدها». (U3 11-20)
- Applying a colour mapping the wrong way round: «انت ياعم العكس…». (U3 11-20)
- Artifact or tool links that open as code instead of a page: «بتفتح كود مش صفحة». (U3 11-20)
- One button doing two things, or filtering in place with a «فلتر نشط» bar. He gets lost. (U1 11-18)
- Crowded rows with too many per-employee details. (U1)
- Loose buttons scattered on a page. (U3)
- Very long screens and lists. (U3)
- Dark `#333` text on the teal «جديد» chip, and on the orange bell badge. (U3)
- Harsh green. (U1)
- Removing the hour rail or timeline. (UXA)
- Removing the «الحالة» filter, which he wants kept in both screens. (UXA)
- Hiding the doctor strip in a way that loses «صرف حساب الطبيب». (UXA self-correction)
- Re-proposing changes that just shipped. (UXA)
- A floating «+» that covers content. (UXA)
- An orange alarm on zero counts. (UXA)
- Codes like F3, DEMO-001 or INV-… and US dates shown to staff. (UXA)
- Boxes injected inside the blue hero header. (U3)

## 5. Open items and promises still pending

- **#712** «المتابعة والتواصل»: branch `claude/followup-move-20261122`, help -159. Main chat 4 merges it on green CI. If main moves, re-merge carefully and check stamps and help steps after resolving conflicts.
- **Build SPEC A (-160) and SPEC B (-161)** after #712 merges:
  - mockups on `claude/ux-reception-mockups`: `today-board-simplify.html`, `booking-reception-simplify.html`;
  - UI only;
  - tests and layout-check at 360/390/1440.
  The owner was told it would be built in «UI & UX 4».
- **UX audit queue** (inherited from UXA; exclude finance screens, which the finance chat reviews):
  - confirm-dialog coverage for the remaining dangerous buttons;
  - nursing and doctor_assistant views of تشغيل اليوم;
  - «الباكجز وأرصدة المرضى»;
  - «التحصيل والمستلزمات». Check with the finance chat first, since it may count as a finance screen. UXA proposed it next; the owner had not yet answered «نبدأ بـ«التحصيل والمستلزمات»؟».
  - The other reception sections: ملفات المرضى, الزيارات والخدمات, الإعدادات.
- `ux-role-review` skill branch: decide with main chat 4 whether to PR it (docs only).
- Promises from U3's earlier stretch, unfinished:
  - Tasks phases 3–6 PR;
  - inventory v2 mockup (awaiting «طبقه»);
  - patient-archive audit;
  - printed reports on letterhead;
  - other long lists, on request.
- From U2/U1:
  - #596 booking bottom sheet was never approved; check its current state;
  - audit of floating help and bot buttons overlapping content on phones outside accounting;
  - tax number conflict on the letterhead (758-688-423 vs the owner's 423-688-758);
  - the Hiragino web licence is unverified.
- The owner was told «من هنا ورايح هشغّل الفحص ده وأراجع الألوان والتقطيع قبل أي صورة أبعتها». Keep that promise.

## 6. Role merge (main chat 4, 2026-11-22)

- The UX audit role is now part of «UI & UX»: review a screen per role → one short Egyptian-Arabic verdict + interactive mockup → build only after «طبقه».
- Checklist skill: branch `claude/ux-role-review-skill` → `.claude/skills/ux-role-review/SKILL.md` (approved by the owner, no PR yet; open one only if asked).
- Finance screens are out of scope: the finance chat (`session_01UqVZHWa751JciR5NzZebwW`) reviews and builds its own. Ask it whether «التحصيل والمستلزمات» counts as finance before touching it.
- Open audit queue: confirm-dialog coverage on the remaining destructive buttons; nursing / doctor_assistant views of «تشغيل اليوم»; ملفات المرضى، الزيارات والخدمات، الباكجز وأرصدة المرضى، booking modal، visit card; consistency with the finance chat's «شغلي النهارده» (help -150).
- «وصل» exists in both reception screens; the owner has not decided to remove it.
- Next question for the owner after SPEC A/B: which screen to audit next.

## 7. Main button colour (owner, 2026-11-22) **[NEW]**
- «ماتخلي الاورنج دا الرمادي الغامق بتاعنا ولما يهوفر عليه يديله الاورنج أشيك» (said about the reception patients-list mockup).
- In mockups, the main row button (e.g. «حجز موعد», «افتح الزيارة», «تنفيذ») is our darkest colour `#16212E` (the identity's dark ink) with white text. The owner corrected `#525B6F` with «فيه لون أغمق بنستخدمه».
- On hover or keyboard focus it turns orange `#F15A22` with a soft orange shadow.
- Whether this also applies to buttons already live (e.g. «زيارة جديدة» in the patient file) is not decided. Ask the owner before changing live screens.
