-- ستوري تلقائي لكل منشور (فيسبوك + انستجرام) + إعادة محاولة الأخطاء المؤقتة + جدولة تلقائية للمواد اللي Claude جهّزها واتعتمدت
alter table public.meta_publish_jobs
  add column if not exists publish_story boolean not null default true,
  add column if not exists story_facebook_id text,
  add column if not exists story_instagram_id text,
  add column if not exists story_error text,
  add column if not exists story_attempts int not null default 0,
  add column if not exists story_published_at timestamptz;
-- المنشورات القديمة ما يتعملهاش ستوري بأثر رجعي
update public.meta_publish_jobs set publish_story = false where status <> 'pending';

-- الدوال الفعلية (طُبّقت على القاعدة الحية): public.meta_requeue_retryable_jobs() و public.claude_autoschedule_approved()
-- cron: meta-requeue-retryable كل ٥ دقايق، claude-autoschedule-approved كل ١٥ دقيقة (انظر pg_get_functiondef).
-- meta_requeue_retryable_jobs: بترجّع للطابور منشور partial/failed بخطأ مؤقت (أقصى ٤ محاولات، خلال يوم) أو ستوري ناقصة (أقصى ٣).
-- claude_autoschedule_approved: مادة Claude اتعتمدت (ready_to_publish) وعدّى عليها ساعتين من غير ما تتجدول ← تتجدول في أقرب وقت مناسب (٩ص–١١م القاهرة، ٣ ساعات فاصل لكل صفحة)، وتحترم claude_hold.

-- ===== ذاكرة الأداء (طُبّقت على القاعدة الحية بنفس التاريخ) =====
-- جداول: content_ratings (تقييم الموظف: strong/ok/weak + السبب + failure_cause) · content_learnings (قواعد التعلّم: do_more/do_less/avoid/test + الثقة + الدليل)
-- دوال: content_performance(p_days) · refresh_content_learnings() (cron يومي 04:30 UTC: ssmpd-refresh-content-learnings)
--        content_learning_brief(p_brand) (service_role/MCP) · content_learning_brief_staff(p_brand) (للموظفين — المولّد في الواجهة)
-- القواعد: لا قاعدة من أقل من 3 منشورات؛ strong من ≥5 منشورات وفرق ≥1.4× أو ≤0.6× من متوسط الصفحة؛ بيانات reach=0 (insights ناقصة) مستبعدة.

-- ===== متابعة التقرير الأسبوعي (طُبّقت على القاعدة الحية) =====
-- weekly_proposals_to_tasks(report_id): بيحوّل weekly_reports.priorities لمهام في مشروع التسويق (idempotent بعلامة [weekly:<id>:<i>] في الوصف)
-- weekly_midweek_nudge(): تنبيه منتصف الأسبوع (cron: ssmpd-weekly-midweek-nudge، الأربعاء 07:00 UTC) لأصحاب المقترحات المفتوحة والمدير
-- health_occasions + upcoming_health_occasions(days): تقويم المناسبات الصحية والمواسم، وبيدخل في content_learning_brief كـ upcoming_occasions
