# Claude monthly staff summary — instructions (trusted, from the repository)

Run once per month, between the 1st and the 3rd (Cairo time), for the **previous** month. Reader: Mohamed (owner) and the general manager — Egyptian Arabic, short, fair, specific, never humiliating. This is a coaching note, not a verdict.

## 1. Check whether it is needed
`select count(*) from staff_monthly_summaries where month = (date_trunc('month', now() at time zone 'Africa/Cairo') - interval '1 month')::date and source = 'claude';`
If every active staff member with data already has a `claude` summary → stop silently. (On the 3rd a database fallback writes a rule-based `system` summary for anyone still missing; your version replaces it.)

## 2. Read the data (read-only, one call)
`select public.staff_kpi_month_data();` → JSON: `month`, `staff[]` (name, role, score 0–100, `kpis[]` with value, sample, target, score, prev_value, direction, unit, label; `review` = management's monthly rating/note if any), `inactive[]` (names with no recorded activity).
Also read the context that explains numbers: `select * from weekly_reports order by week_end desc limit 4;` (the weekly reports already say what happened that month).

## 3. Write one summary per active staff member
Three short fields (each ≤ 2 sentences, ≤ 300 characters, no markdown):
- **strength** — the strongest KPI (highest score with a sample ≥ the minimum, prefer higher weight), with the real number and the target.
- **improve** — the weakest KPI (lowest score with a sufficient sample) with the real number and target, and the likely reason **only if the data supports it**; otherwise say «محتاج متابعة» instead of guessing. If a KPI changed ≥ 20 % vs `prev_value`, mention the direction.
- **action** — ONE concrete step for next month (what, how much, by when), realistic for the role.
Rules: use only numbers from the JSON; a KPI whose `sample` is below the minimum is not a finding ("عينة صغيرة"); never judge character, health, or private matters; never compare people by name; honour management's `review` note if present; if a person has fewer than 2 scored KPIs write «بيانات الشهر غير كافية للتقييم» in `improve` and a data-quality action («سجّل شغلك في الداشبورد أولًا بأول»).
For `inactive` people write nothing — the report lists them.
Special cases: **Claude Creative** is an AI account — write its summary about throughput and quality of the generated content, and tell Mohamed anything that needs a human decision.

## 4. Save (idempotent, database function does validation + snapshot)
`select public.staff_summary_save('<admin_id>', '<month YYYY-MM-01>', '<strength>', '<improve>', '<action>', 'claude');` — one call per person. Do not insert into the table directly.

## 5. Report
Send Mohamed ONE short message: who got a summary, the 2–3 biggest things (best improvement, biggest gap, anyone with no data), and the link https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/ → «أداء الفريق». If a step fails, say exactly which and stop.

## Alerts (no action needed from you)
A daily database job writes `staff_kpi_alerts` when an important KPI (weight ≥ 2) falls below 40 % over the last 14 days (or 3+ overdue tasks). They reach the general manager and super admin in their personal-home inbox and in the «أداء الفريق» tab. Do not duplicate them; if the weekly report discusses performance, you may mention open alerts (`select message from staff_kpi_alerts where acknowledged_at is null`).
