# SSMPD Business Intelligence Brain

## الهدف

تحويل الداشبورد من مكان يسجل الشغل إلى Operating Intelligence System.

المسار المستهدف:

```text
Tasks / Projects / Employee Reports
Content / Content Performance
Meta Ads / Leads / Bookings
Operational Reports / Outcomes
Staff KPIs / Finance-ready signals
        ↓
Structured Knowledge Extraction
        ↓
Corporate Memory + Knowledge Graph
        ↓
Recommendations + Decisions
        ↓
Existing Tasks / Content / Campaign Actions
        ↓
Measured Results
        ↓
Validated Learning
        ↺
```

النظام لا ينشئ Task Engine جديدًا ولا Content Engine جديدًا. يستخدم الوحدات الحالية ويضيف فوقها طبقة معرفة وقرار وقياس.

## 1. Structured Knowledge

أي تقرير موظف معتمد يمكن أن ينتج عناصر معرفة من الأنواع التالية:

- Audience Insight
- Customer Pain
- Content Insight
- Marketing Opportunity
- Competitor Insight
- Operational Issue
- Recommendation
- KPI
- Risk
- Hypothesis
- Decision
- Result
- Brand Rule
- Service Insight
- Sales Insight

كل عنصر يحتفظ بالمصدر والمهمة والمشروع والموظف والتاريخ ومستوى الثقة وسبب الثقة ونطاق الخدمة أو التخصص والجمهور.

النص الأصلي يظل في `task_work_results`. طبقة الذكاء تحفظ خلاصة منظمة فقط.

## 2. Corporate Memory

أربع طبقات:

- `stable` معرفة ثابتة نسبيًا مثل قواعد البراند أو خصائص جمهور ثبتت عبر وقت أطول.
- `dynamic` معرفة سريعة التغير مثل زوايا المحتوى وسلوك العملاء والمنافسين.
- `decision` ما قررته الإدارة ولماذا.
- `result` ما حدث بعد التنفيذ وما تعلمناه.

الجداول الأساسية:

- `business_knowledge_items`
- `business_recommendations`
- `business_decisions`
- `business_measurements`

## 3. Confidence Lifecycle

المعلومة لا تنتقل من تقرير إلى حقيقة مباشرة.

الحالات:

1. `draft`
2. `ai_extracted`
3. `employee_confirmed`
4. `manager_approved`
5. `validated_by_data`
6. `outdated`
7. `superseded`

`validated_by_data` أعلى من `manager_approved`.

المحتوى الآلي يستخدم فقط `manager_approved` و`validated_by_data`.

## 4. Knowledge Decay

المعرفة لها:

- `valid_from`
- `last_validated_at`
- `review_after`
- `expires_at`
- `confidence`

القواعد الافتراضية الحالية:

- Hypothesis مراجعة بعد 30 يوم وانتهاء بعد 90 يوم.
- Content / Marketing / Competitor Insight مراجعة بعد 45 يوم وانتهاء بعد 120 يوم.
- Dynamic Knowledge مراجعة بعد 90 يوم وانتهاء بعد 180 يوم.
- Stable Knowledge مراجعة بعد 180 يوم وانتهاء بعد 365 يوم.
- Decisions / Results لا تنتهي تلقائيًا لأنها جزء من السجل الإداري، لكنها تراجع.

الانتهاء لا يحذف السجل. يحوله إلى `outdated`.

## 5. Feedback Loop

```text
Employee report
→ extracted insight
→ management approval
→ recommendation
→ existing task
→ execution
→ measurement
→ validated learning
→ future decisions/content
```

التوصية تتحول إلى Task من خلال `task_create` الحالي. لا يوجد نظام مهام موازٍ.

القياس يسجل baseline وmeasured value والوحدة والحكم والتفسير والدليل.

## 6. Knowledge Graph

`business_entity_links` يربط الوحدات بدون نسخ بياناتها.

أمثلة:

```text
Employee → contributed → Knowledge
Knowledge → derived_from → Task
Knowledge → belongs_to → Project
Knowledge → about → Service
Knowledge → targets → Audience
Recommendation → supported_by → Knowledge
Recommendation → implemented_as → Task
Decision → approved_from → Recommendation
Decision → executed_by → Task
Measurement → validates → Knowledge
Measurement → measures → Recommendation / Decision / Task
```

ده يسمح لاحقًا بأسئلة مثل:

- أي تقارير موظفين أدت إلى نتائج تجارية فعلية؟
- أي فرضيات عن الجمهور تحققت بالبيانات؟
- أي قرارات تسويقية أعطت نتيجة ثم تحولت إلى قاعدة معرفة؟
- أي خدمة ترتبط بأكثر فرص أو مشاكل متكررة؟

## 7. Content AI Integration

`business_content_brief(brand, specialty)` يرجع فقط المعرفة المعتمدة أو المتحققة.

`assets/js/business-intelligence.js` يضيف هذه الخلاصة إلى `performance_brief` قبل استدعاء `content-ai`.

ترتيب السياق المقصود:

1. Brief الحالي للمادة والهدف والتخصص.
2. بيانات المركز المعتمدة.
3. Performance Memory الحالية.
4. Approved Business Memory الجديدة.
5. التعليمات التشغيلية المعتمدة إن كانت مفعلة.

المعرفة التي يمكن تمريرها تشمل:

- الجمهور
- Pain Points
- Content Angles
- خدمات مطلوبة
- Marketing Opportunities
- Sales Insights
- Brand Rules
- Hypotheses مع وصفها كفرضيات

النص الخام لتقرير الموظف لا يدخل Content AI.

## 8. Marketing Strategy Engine

المخرجات المستهدفة داخل Owner Intelligence:

- فجوة بين اهتمام الجمهور وحصة المحتوى.
- فرص خدمة أو جمهور.
- توصيات حملة قابلة للتحويل إلى مهمة.
- ربط توصية بمؤشر قياس.
- متابعة هل التوصية دخلت التنفيذ أم لا.
- قياس ما إذا كان التنفيذ حسن النتيجة أم لم يحسنها.

التوصيات أنواعها:

- content
- marketing
- ads
- operations
- sales
- finance
- staff
- customer_experience

## 9. Ads Intelligence

البيانات الحالية تدعم:

- Campaign
- Ad / Creative
- Specialty
- Content Angle
- Hook Type
- Creative Type
- CTA
- Spend
- CTR / CPC / CPM
- Leads
- Cost per Lead
- Results / Cost per Result
- Lead attribution إلى Meta Ad / Campaign
- Booking conversion من Lead عندما تكون بيانات الحجز موجودة

ما لا ندعيه حاليًا:

- Revenue Attribution كامل للحملة.
- ROAS حقيقي بدون ربط مالي deterministic.

النظام يعرض `revenue_attribution_ready=false` بدل اختراع ROAS.

### Scenario Planning

`business_ads_scenario(extra_budget)`:

- يختار أفضل ثلاث حملات من البيانات المتاحة حسب Cost per Result التاريخي.
- يوزع الميزانية الإضافية بوزن عكسي لـCPR.
- يعرض Mechanical Projection.
- يعرض Stress/Sensitivity Band عند 80% و120%.

هذا ليس Confidence Interval ولا ضمان نتيجة.

قبل زيادة الإنفاق يجب مراجعة جودة الـLead والحجز والإيراد.

## 10. Owner Intelligence

يوضع أعلى شاشة `الملخص العام` للإدارة فقط.

النموذج الحالي يعرض:

- Today / This Week / This Month
- Completed tasks
- Overdue tasks
- Tasks waiting review
- Project progress
- New knowledge
- Knowledge waiting management review
- Validated knowledge
- Leads and booking conversion
- Open / repeated operational issues
- Recommendations
- Decisions & Learnings
- Contextual Alerts
- Contribution Impact
- Scenario Planning
- Owner Copilot

الهدف النهائي للواجهة:

- Today
- This Week
- This Month
- Needs My Decision
- Opportunities

المالك لا يحتاج قراءة كل تقرير. يبدأ بما يحتاج تدخله ثم يفتح المصدر عند الضرورة.

## 11. Contextual Alerts

بدل إشعار مثل `Task overdue` فقط، الخلاصة تبني إشارات مثل:

- عدد المهام المتأخرة التي تحتاج إعادة ترتيب أو معرفة السبب.
- مشكلة تشغيل ظهرت في 3 فترات مستقلة أو أكثر ولم تغلق.
- Knowledge Item وصل موعد إعادة التحقق.
- قرار حان موعد قياسه بلا نتيجة مسجلة.

المرحلة التالية تضيف dependency/blocker explanation عندما تتوافر علاقات كافية بين المهام.

## 12. Owner Copilot

له وضعان.

### Deterministic quick answers

تعمل بدون نموذج خارجي وتقرأ Snapshot مجمعًا فقط.

أمثلة:

- ما وضع المهام المتأخرة؟
- ما وضع Leads والحجوزات؟
- ما أهم المعرفة الجديدة؟
- ما التوصيات التي لم تنفذ؟
- ما المشكلات التشغيلية المفتوحة؟

### AI free question

مصمم في `business-intelligence` Edge Function لكنه غير مفعل افتراضيًا.

عند تفعيله:

- الإدارة فقط.
- يستخدم `business_copilot_context` المجمع.
- لا يرسل أسماء مرضى أو أرقام تليفونات.
- لا يرسل نصوص تقارير الموظفين الخام في Owner Q&A.
- يذكر فجوات البيانات بدل التخمين.
- لا يصدر قرار توظيف أو عقوبة تلقائية.

## 13. Employee Intelligence

لا يقيس النشاط فقط.

Contribution Impact الحالي يربط الموظف بـ:

- Tasks Completed
- Approved Knowledge
- Data-validated Knowledge
- Recommendations adopted into execution
- Positive measured outcomes

يستمر تاب `أداء الفريق` الحالي كمصدر KPIs التشغيلية مثل الالتزام والزمن والمراجعات. Owner Intelligence يضيف بعد الأثر ولا يستبدل KPIs الحالية.

لا يستخدم النظام Composite Score لاتخاذ قرار وظيفي تلقائي.

## 14. Strategic Memory

`business_decisions` يحتفظ بـ:

- القرار
- السبب
- المجال
- المعرفة التي بني عليها
- التوصية أو المهمة المرتبطة
- Expected Metric
- Review Date
- Result Summary
- Learning

الهدف هو الاحتفاظ بالإجابة عن:

- ماذا قررنا؟
- لماذا؟
- ماذا حدث؟
- ماذا تعلمنا؟

## 15. Report Extraction Queue

عند انتقال Task إلى `done`:

- آخر `task_work_results` بحالة `review` يدخل `business_extraction_queue` مرة واحدة.
- Trigger لا يتصل بأي AI.
- لا يوجد إرسال تلقائي خارجي.
- المعالجة تتطلب تفعيل `business_ai_enabled()` ثم استدعاء Edge Function من الإدارة.

الناتج يبقى `ai_extracted` وينتظر مراجعة بشرية.

## 16. External AI Boundary

حاليًا:

```text
business_ai_enabled() = false
```

وبالتالي:

- لا يتم إرسال تقارير الموظفين إلى OpenAI.
- Owner Copilot free-text الخارجي لا يعمل.
- Deterministic Owner Intelligence يعمل من SQL عند نشر قاعدة البيانات والواجهة.
- Content AI الحالي يظل يعمل كما هو، ويمكنه استهلاك Approved Business Memory لأنها خلاصة معتمدة وليست التقرير الخام.

قبل تشغيل external business AI يجب اتخاذ قرار إداري صريح بشأن نقل نصوص تقارير العمل.

## 17. AI Cost Controls

`business_ai_requests` و`business_ai_allow(mode)` يضيفان حدًا لكل مدير خلال 24 ساعة:

- Owner questions: 50
- Report extraction: 15

يمكن تعديل الحدود لاحقًا بناءً على التكلفة الفعلية.

## 18. Security

- كل جداول Business Intelligence الجديدة عليها RLS.
- الوصول للإدارة العامة والسوبر أدمن من خلال `operations_manager()`.
- Data API grants صريحة للجداول الجديدة.
- Service Role لا يظهر في الواجهة.
- Trigger helpers مسحوب منها direct execute للمستخدمين.
- AI prompts تعتبر report/context بيانات غير موثوقة وليست تعليمات.
- Raw patient identifiers غير موجودة في Owner Copilot context.
- Approved Business Memory فقط هي التي تدخل Content AI.

## 19. Existing Modules Reused

بدون استبدال:

- `task_work_results`
- `tasks`
- `task_projects`
- Operations reports/issues/actions/outcomes
- `content_learnings`
- Performance Memory
- `content-ai`
- `content_items`
- Meta Ads tables
- Lead attribution
- Leads / booking fields
- Staff KPI module

## 20. Activation Order

1. Apply `20261020_business_intelligence_brain.sql`.
2. Apply `20261020_business_intelligence_graph_limits.sql`.
3. Run Supabase security/performance advisors.
4. Deploy `business-intelligence` Edge Function with JWT verification enabled.
5. Load `business-intelligence.css` and `business-intelligence.js` from `index.html`.
6. Verify Summary for general_manager / super_admin.
7. Verify normal employee accounts do not see Owner Intelligence.
8. Verify recommendation → existing task.
9. Verify decision save.
10. Verify scenario calculation against stored Meta data.
11. Verify Content AI request contains Approved Business Memory only.
12. Keep `business_ai_enabled=false` until explicit approval for external report analysis.
13. After approval, enable extraction and test one non-sensitive report first.
14. Validate extracted items before using them in production decisions.

## 21. Definition of Done

المنظومة تعتبر مكتملة وظيفيًا عندما:

- كل تقرير معتمد يدخل Queue.
- المعرفة المستخرجة لها source + confidence + lifecycle + decay.
- الإدارة تستطيع اعتمادها أو إبطالها.
- المعرفة المعتمدة تغذي Content AI.
- التوصية تتحول إلى Task حقيقي.
- النتيجة تقاس وتعيد تحديث المعرفة.
- Owner Digest يختصر المهام والمشروعات والمشكلات والفرص.
- Owner Copilot يجيب من بيانات النظام فقط.
- Ads planning يوضح حدود attribution ولا يختلق ROAS.
- Employee view يقيس Contribution Impact بجانب KPIs الحالية.
- Decisions & Learnings يحتفظ بذاكرة القرارات.
- Knowledge Graph يربط المصدر بالفعل والنتيجة.
- كل ذلك يعمل بدون كسر الوحدات الحالية أو إنشاء مصدر حقيقة موازٍ.
