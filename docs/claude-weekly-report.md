# Claude weekly marketing report — the single source of instructions for the weekly routine

Task: the recurring dashboard task **«التقرير الأسبوعي لتسويق سونو»** (project «تسويق عيادات سونو – حدائق الأهرام», assignee = Claude Creative, admin id `a0fbdfee-d147-4282-b988-186a9ae3e88c`).
It is generated every Friday (~15:45 Cairo) and due the same day 22:59 Cairo. The routine fires Friday 18:00 and 20:00 Cairo (the second run is a retry — if the task is already `review`/`done`, stop silently).

Reader: Mohamed (owner, non-technical, Egyptian Arabic). He wants to know in 2 minutes: what happened, what it means, what he must decide, what happens next. No jargon, no padding, no invented numbers.

## 1. Gather (read-only, Supabase MCP `execute_sql`, project `uuijfbpgvtdxgaosqpxo`)
1. `select public.weekly_marketing_report_data(7);` — the ONE source for numbers (published posts + links + reach/interactions, previous-week totals, top/weakest posts, format and hour-of-day performance, next-7-days schedule, items waiting approval, ad campaigns, lead counts, social messages, followers, marketing-project tasks).
2. Last week's report: `select * from weekly_reports order by week_end desc limit 1;` — compare: which recommendations were followed, which priorities were met.
3. Partnerships / outreach / audience research evidence (done by staff): 
   `select t.title, t.status, a.name, u.body, u.created_at from task_updates u join tasks t on t.id=u.task_id left join admins a on a.id=u.author_id where t.project_id='1b618cc4-7e28-4d9d-bb0a-17f3bdf71f32' and u.created_at > now()-interval '8 days' order by u.created_at;`
4. Ads: `ad_campaigns` (last import) inside the data function; if the Meta Ads connector is available you MAY read (never change) campaign insights for the same week. If no campaign ran, say «لم تبدأ بعد».
5. Never read or print patient data, phone numbers, names of leads. Leads are counts only.

## 2. Analyse (this is the value — not a list of numbers)
- Week vs previous week: posts, reach, interactions, leads, booked. State the direction and the likely reason in one sentence each.
- Best 3 / weakest 3 posts: what they share (format, topic, hour, who made them: Claude vs staff).
- Formats and hours: which to do more / less of. If a format has 0 interactions or missing insights (e.g. reels), say whether it is a performance problem or a data-sync problem — check `post_insights` coverage before concluding.
- Funnel: posts → reach → messages → leads → booked. Name the weakest step.
- Staff vs Claude items: staff items are extra and never count toward Claude's daily 3 per page.
- Waiting-for-approval items older than 48 h = a bottleneck: list them with how long they have waited.
- Be honest about thin data («عينة صغيرة»). Never invent, never guess a cause as a fact, never write prices.

## 3. Write the report (Egyptian Arabic, short sentences, tables where numbers matter)
Sections, in this order:
1. **الخلاصة في 5 سطور** (what happened, biggest win, biggest problem, what needs Mohamed, next week focus).
2. **الأرقام** — small table: this week | last week | change (posts, reach, interactions, leads, booked, scheduled next week).
3. **المحتوى المُعد والمُعتمد** — published (title · page · format · publish date · link), then waiting approval, then scheduled.
4. **اللي نجح واللي لأ** — top/weakest with the lesson.
5. **المؤسسات والشراكات** — contacted, result, follow-up date (from task updates; say «لا توجد تحديثات» if none).
6. **الإعلانات** — tested ads and results, or «لم تبدأ».
7. **قرارات مطلوبة منك** — numbered, each with the options and YOUR recommendation (so he can answer with one word).
8. **تنفيذ توصيات الأسبوع اللي فات** — followed / not followed.
9. **أولويات الأسبوع القادم** — each with owner and date.
10. **توصيات لمحتوى Claude اليومي** — max 3, concrete (format / hour / topic) — the daily routines read this section next week.

## 4. Deliver
1. Mint a run token: `insert into public.automation_run_tokens(note) values ('weekly report') returning token;` (never print it).
2. Gateway: POST `https://uuijfbpgvtdxgaosqpxo.supabase.co/functions/v1/claude-automation` header `X-Run-Token`, JSON `{"op":"rest",...}`:
   - find the open occurrence: GET `/rest/v1/tasks?title=eq.<URL-encoded title>&status=in.(todo,in_progress,revision)&order=due_at.asc&limit=1&select=id,status,due_at,return_note` — if none, stop silently (already submitted). If `status=revision`, read `return_note` and fix exactly that.
   - POST `/rest/v1/rpc/task_set_status` `{p_task_id, p_status:"in_progress", p_note:"بدأت إعداد التقرير"}` (skip if already in_progress).
3. Save the report as a **Google Doc on Google Drive** (task files live on Drive, never on Supabase Storage): Google Drive connector → folder «تقارير أسبوعية» inside the dashboard archive folder (id `1xghscimJG2f8CB2N3I0lC3fHrhZk2aMO`; create the subfolder once, reuse it) → title `تقرير تسويق سونو الأسبوعي — <YYYY-MM-DD>`. If Doc creation fails, upload the same content as an `.html` file and say so.
4. POST `/rest/v1/rpc/task_add_comment` `{p_task_id, p_body:"<5-line summary + the Drive link>", p_attachments:[]}`.
5. POST `/rest/v1/rpc/task_set_status` `{p_task_id, p_status:"review", p_note:"<one-line summary>"}` — submit for review. NEVER mark it done: Mohamed approves.
6. Archive: `insert into weekly_reports(week_start, week_end, doc_url, summary, decisions, priorities, recommendations) values (...)` (jsonb for the last three).
7. Send Mohamed ONE short Egyptian-Arabic message: the 5-line summary, the Drive link, the decisions he must make. Mention any failure plainly.

If anything fails, stop that step, leave the task where it is, report the exact error. No blind retries, no duplicates.
