# SSMPD — لوحة إنتاج محتوى السوشيال ميديا لمركز Swnw

> اقرأ هذا الملف كاملاً قبل أي تعديل. أي شات جديد يشتغل على هذا المشروع
> لازم يبدأ من هنا.

---

## ما هذا المشروع

لوحة داخلية لتنظيم عمل إنتاج محتوى السوشيال ميديا لـ **مركز عيادات Swnw
التخصصية — فرع حدائق الأهرام**. أربعة أدوار (موظف صفحات، مصمم، مسؤول
اعتماد، سوبر أدمن) يشتغلوا على سير عمل واحد من الفكرة لحد النشر، مع
اعتماد مزدوج، كومنتات تعديل، أرشيف Google Drive تلقائي، وتحديث لحظي
(Realtime) بين كل الشاشات.

مشروع **مستقل تماماً** عن باقي أنظمة المركز (`sono-dashboard`، `hris`،
`swnw-erp`، `patients`) — ريبو منفصل + مشروع Supabase منفصل بالكامل.

منشور على GitHub Pages:
`https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/`

**مسار النسخة المحلية على ماك المستخدم** (كلون قديم للريبو، مش وسيلة
النشر — النشر يتم حصرياً عن طريق GitHub Web UI كما هو موضح تحت):
`/Users/m.ibrahim/Work Archives/SwnW Specialized Clinics Medical Center 2/Website/SSMPD - Swnw Social Media Prduction Dashboard/SSMPD-Swnw-Social-Media-Prduction-Dashboard`
⚠️ هذه النسخة غالباً قديمة (متأخرة عن الريبو الحي على GitHub) — لا تُستخدم
كمصدر لرفع ملفات، فقط للرجوع إليها لو المستخدم طلب فتح الفولدر على جهازه.

---

## المستخدم

**محمد عبدالعال — غير تقني بالكامل.** لذلك:

- لا تُعطَ أوامر Terminal يكتبها بنفسه — أي خطوة تقنية تحتاج منه تُسلَّم
  كملف `.command` بالعربي يفتحه بدبل كليك، أو زرار يضغط عليه
- الشرح خطوة خطوة بالعربية المصرية
- عند أي خطأ: اطلب صورة الشاشة بدل الوصف
- خطوات تسجيل الدخول (GitHub / Supabase / Google) يعملها هو بنفسه في
  المتصفح — الشات يكمّل بعدها بالأتمتة

---

## البنية

موقع ثابت بالكامل — HTML/CSS/JavaScript عادي. **لا build ولا npm.**
الباك إند بالكامل Supabase (Auth + Postgres + Realtime).

```
index.html              نقطة الدخول — يحمّل كل الملفات بالترتيب
config.js                إعدادات المركز + مفاتيح Supabase + رابط جسر Drive
assets/css/styles.css    كل التصميم — خطوط وألوان الهوية
assets/fonts/            BigVesta Arabic + Hiragino Kaku (WOFF2)
assets/img/               logo.svg · mark.svg
assets/js/
  db.js                  طبقة الاتصال بـ Supabase (كل الاستعلامات من هنا)
  roles.js               الأدوار وصلاحيات كل تاب
  workflow.js             تعريف مراحل الـ Kanban وحالات أيقونة المصمم
  auth.js                 دخول/خروج/تسجيل عبر Supabase Auth
  drive.js                رفع ملفات التصميم لجسر Google Drive
  comments.js              مكوّن الكومنتات (Thread) + عداد "تعليق جديد" + حالة كل كومنت
  render-summary.js        شاشة الملخص العام
  render-production.js     شاشة إنتاج المحتوى (موظف الصفحات)
  render-review.js         شاشة إدارة المحتوى — Kanban (مسؤول الاعتماد)
  render-design.js         شاشة التصميم (المصمم) + رفع Drive
  render-publish.js        تاب النشر — المواد المعتمدة (محتوى+تصميم)، جدولة/نشر
  render-archive.js        شاشة الأرشيف — كالندر شهري
  render-admin.js          لوحة المستخدمين والصلاحيات (سوبر أدمن)
  app.js                   Bootstrap + الشِل العام + التنقّل + Realtime
supabase/setup.sql         سكريبت قاعدة البيانات كاملاً (RLS + Realtime)
apps-script/Code.gs        جسر أرشيف Google Drive (Apps Script Web App)
test/smoke.js              اختبار jsdom — Supabase مموّه بالكامل
```

كل ملف JS نمط **IIFE** يعلّق نفسه على `window.SSMPD*` — بدون أي تعارض
تسمية، وبدون أي build tool.

مكتبة خارجية واحدة من CDN: `@supabase/supabase-js@2`.

---

## قاعدة البيانات (Supabase)

مشروع Supabase منفصل بالكامل — **لا تخلطه بمشاريع الأنظمة الأربعة
التانية**. رابط SQL Editor بتاع المشروع ده مباشرة:
`https://supabase.com/dashboard/project/uuijfbpgvtdxgaosqpxo/sql/new`

الجداول:

| الجدول | الوظيفة |
|---|---|
| `admins` | المستخدمين والأدوار (`page_manager`/`designer`/`approver`/`general_manager`/`super_admin`/`reception`/`customer_service`) + عمود `has_archive_access` (boolean منفصل عن الرول، بيفعّل الوصول لموديول أرشيف المرضى لأي رول) |
| `content_items` | كل مادة محتوى — العنوان والنص والمرحلة (`stage`)، `design_received_at` (وقت ضغط المصمم "استلام")، `scheduled_publish_at`/`scheduled_by` (معاد النشر المجدول ومين حددّه — تاب النشر)، `stage_history` (jsonb — سجل كل انتقالة مرحلة، أساس حساب أوقات الرحلة في تقرير الأرشيف) |
| `comments` | كومنتات التعديل، مرتبطة بالمادة كـ thread، وفيها `status` (`pending`/`done` — "في انتظار التعديل"/"تم التعديل") |
| `comment_reads` | آخر وقت قرا فيه كل مستخدم كومنتات كل مادة — أساس عداد "تعليق جديد" (أحمر/رمادي) |
| `activity_log` | سجل كل تغيير حالة (Audit trail) |
| `weekly_social_metrics` | إدخال يدوي أسبوعي لمؤشرات السوشيال ميديا (أو استيراد CSV من Meta Business Suite/Meta Ads/Google Ads عبر مطابقة أعمدة تلقائية في `render-summary.js`) |
| `ad_campaigns` | تقرير حملات إعلانات مدفوعة (Meta Ads Manager) مستورد يدوياً من CSV — كل استيراد جديد بيستبدل القديم بالكامل، صف واحد لكل حملة (مجمّع) |
| `patients` | **جدول مشترك** بين موديول "أرشيف المرضى" وموديول "إدارة الليدز" (قيد الإنشاء) — `patient_code` رقم تعريف قصير قابل للقراءة (`P-YYYY-000001`)، `national_id_hash` (هاش SHA-256+pepper بس، مش الرقم الخام)، `phone_normalized` للمطابقة مع الليدز |
| `patient_files` | metadata ملفات المرضى (الملف الفعلي على Google Drive عبر Service Account، مش هنا) — `category` (`id_document`/`insurance`/`radiology`/`lab_result`/`other`)، `checksum`، `drive_file_id` |
| `archive_access_log` | سجل كل عملية (`view`/`download`/`upload`/`delete`) على ملفات/بيانات المرضى — مين عملها وامتى |
| `leads` | (قيد الإنشاء) ليدز موديول "إدارة الليدز" — بيانات الرسالة الخام، الحالة (`current_status`)، التوزيع (`assigned_to`)، ربط اختياري بـ`patients` عبر `patient_id` |
| `lead_attempts` | (قيد الإنشاء) سجل كل محاولة تواصل مع الليد (متعدد لكل ليد) |
| `lead_status_log` | (قيد الإنشاء) سجل تغييرات `current_status` تلقائياً (بتريجر `trg_log_lead_status_change`) — أساس مؤشرات الأداء |
| `lead_feedback_tags` | (قيد الإنشاء) تصنيف اختياري (إيجابي/سلبي/محايد) لكل ليد أو محاولة تواصل |
| `patient_accounts` | (Patient Portal — Foundation، Pre-Live) حساب دخول المريض بس (`auth_user_id` فريد) — بدون ربط مباشر بمريض؛ الربط عن طريق `patient_account_access` |
| `patient_account_access` | (Patient Portal — Foundation) مين المسموح له يوصل لأي `patients.id` وبأي صفة (`self`/`guardian`/`authorized`) وبحالة `verification_status` (`pending`/`approved`/`rejected`/`revoked`/`expired`) — حساب واحد لأكتر من مريض، ومريض واحد لأكتر من ولي أمر معتمد |
| `patient_identity_verifications` | (Patient Portal — Foundation) طلبات تحقّق الهوية/الصلاحية قبل ما تتحوّل لصف `approved` في `patient_account_access` — مراجعة موظف إلزامية، مفيش موافقة ذاتية |
| `patient_verification_documents` | (Patient Portal — Foundation) مستندات التحقّق الرسمية (منفصلة تماماً عن `patient_files` العادية — أمنية داخلية، مش مرئية للمريض ولا لأولياء أمور تانيين) |
| `patient_system_links` | (Patient Portal — Foundation) ربط `patients.id` بمريضه الحقيقي في IHospital لاحقاً — mapping بس، بدون اتصال فعلي حالياً (uniqueness: `(hospital_id, ihospital_patient_id)` و`(supabase_patient_id, hospital_id)` — مريض حقيقي واحد ↔ مريض Supabase واحد لكل مستشفى) |
| `patient_portal_visibility` | (Patient Portal — Foundation) جدول lookup مشترك (`entity_type`+`entity_id`+`portal_status`: `internal`/`approved`/`hidden`) — الافتراضي `internal` (متخفيش حاجة عن الـDashboard، بس متتعرضش للبورتال لحد ما تتعتمد) |
| `patient_portal_audit_log` | (Patient Portal — Foundation) سجل تدقيق **مفروض بتريجرز على مستوى القاعدة** (مش app code) لكل تغيير حالة تحقّق/وصول — كتابة عن طريق service role/التريجرز بس، قراءة لموظف صلاحية التحقّق/سوبر أدمن |

**Patient Portal**: البنية الآمنة (Phase 1 — Final Foundation + تصحيح أمني)
دلوقتي جاهزة في `setup.sql` (قسم ٥٢) — **لسه ماتشغلتش على Supabase Live**.
لسه من غير UI أو صفحة دخول للمريض. القاعدة الأمنية الأساسية: **الوصول لأي
سجل طبي (حتى وصول المريض لملفه هو نفسه) لازم تحقّق هوية/صلاحية رسمي
معتمد من الموظفين — الـOTP بيثبت ملكية رقم التليفون بس، مش هوية.**
`patients.id` هو المعرّف الدائم دايماً.

**إنفاذ فعلي على مستوى القاعدة (مش convention بس)**: مفيش أي INSERT/UPDATE
مباشر مسموح من العميل على `patient_account_access` ولا
`patient_identity_verifications` خالص — الكتابة الوحيدة عن طريق 3 دوال
`SECURITY DEFINER`: `approve_patient_identity_verification()` (بتتأكد إن
فيه مستند تحقّق واحد على الأقل مرفوع قبل ما توافق)،
`reject_patient_identity_verification()`، و`revoke_patient_account_access()`.
التدقيق نفسه بتريجرز تلقائية (مش معتمد على كود التطبيق). مستندات التحقّق
في Supabase Storage bucket خاص (`patient-verification-documents`) —
مفيش SELECT policy خالص عليه (حتى للموظف)، القراءة المستقبلية لازم
تعدّي عن طريق سيرفر/Edge Function بيسجّل الوصول أولاً. موظف عنده صلاحية
أرشيف عادية **مايقدرش** يعتمد تحقّق هوية — محتاج
`has_verification_management_access` أو سوبر أدمن. التفاصيل الكاملة في
مشروع Claude (`changelog/07-patient-portal-phase1.md`).

**ثمان مراحل Kanban** (`content_items.stage`) — المفاتيح مخزّنة في القاعدة،
**لا تُغيَّر** بلا Migration:

```
idea_selection → initial_approval → in_design → final_approval
              → needs_revision (يرجع لـ initial_approval أو final_approval)
              → ready_to_publish → scheduled (اختياري — تاب النشر) → published
```

مرحلة `scheduled` اختيارية: من `ready_to_publish` ممكن تتنشر مباشرة
(تروح لـ`published`)، أو تتجدول الأول (تروح لـ`scheduled` بمعاد نشر
محدد `scheduled_publish_at`) ولحد ما حد يأكد إنها اتنشرت فعلاً (تتحول
لـ`published`)، أو تتلغي جدولتها (ترجع لـ`ready_to_publish`).

الحارس `guard_content_transition()` في `setup.sql` يمنع كل دور من تخطي
حدوده (مثلاً مصمم مايقدرش يعتمد نفسه، وموظف صفحات مايقدرش يلمس مادة
غيره). راجعه قبل أي تعديل على منطق الاعتماد.

RLS مفعّل على كل الجداول. `is_super()` و`my_role()` و`my_admin_id()`
دوال `SECURITY DEFINER` — بدونها السياسات تدخل في تكرار لا نهائي (نفس
الدرس اتعلّم في `sono-dashboard`).

**لتشغيل السكريبت أول مرة**: Supabase → SQL Editor → الصق `setup.sql`
كامل → عدّل البريد في القسم الأخير لو مختلف → Run.

---

## أرشيف Google Drive

القرار: **Apps Script Web App منشور من حساب Google الخاص بالمركز نفسه**
(مش حساب موظف). السبب: أبسط وأثبت من OAuth مباشر في موقع ثابت بدون
سيرفر، وبيضمن إن الأرشيف يفضل ملك المركز حتى لو الموظف اتغيّر.

**البنية على الدرايف** (فولدر جذر واحد مُشارَك، أنشأه المستخدم يدوياً
وشاركه معنا رابطه، وجوّاه 3 فولدرات ثابتة كل واحد بيتنظم سنة/شهر/يوم
تلقائياً):

```
SSMPD - Swnw Social Media Prduction Dashboard/   (الفولدر الجذر — من المستخدم)
  إنتاج المحتوى/     ← category: "content"   (id: 1dYiejCkw31-DP6SnWBo4KSOP1oRY3Wzq)
  التصميمات/         ← category: "design"    (id: 1E9OsjadaOUGc8asCzscrVHG5OFP_HVaS)  (الافتراضي)
  الأرشيف/           ← category: "archive"   (id: 1xghscimJG2f8CB2N3I0lC3fHrhZk2aMO)
```

الـ 3 فولدرات دي اتعملت مرة واحدة عبر الـ Google Drive MCP (مش سكريبت) —
**متتكررش تعمل فولدرات تانية بنفس الاسم**، استخدم نفس الـ IDs المذكورة.
لو الـ IDs دي اتغيّرت لأي سبب، حدّث `CATEGORY_FOLDER_IDS` في
`apps-script/Code.gs` (لازم إعادة نشر الـ Apps Script بعدها).

الكود في `apps-script/Code.gs` — بيستقبل الملف (base64) من `drive.js`
عبر `fetch(POST)` مع `category` ("content"/"design"/"archive")،
وبينشئ فولدرات `سنة / شهر / يوم` تلقائياً جوه فولدر النوع المناسب،
ويرفع الملف جواها، ويرجّع الرابط.

`drive.js` بيوفّر 3 دوال رفع ملفات: `uploadDesignFile` (مستخدمة فعلياً في
شاشة المصمم) و`uploadContentFile` و`uploadArchiveFile` (جاهزين للاستخدام
لو احتجنا رفع من شاشات تانية لاحقاً).

بعد نشر الـ Apps Script، الرابط يتحط في `config.js → driveBridge.webAppUrl`.

### ملفات التتبع (Excel) التلقائية — داخل كل فولدر نوع

كل فولدر من الـ 3 (إنتاج المحتوى/التصميمات/الأرشيف) فيه ملف Google Sheet
ثابت واحد بيتعمل أول مرة تلقائياً وبيتحدّث مع كل حدث في سير العمل:

- **تتبع - إنتاج المحتوى**: الفكرة، تاريخ الإضافة، الموقف الحالي (في
  الاعتماد/تم الاعتماد/تم التصميم/تم النشر)، لينك النشر.
- **تتبع - التصميمات**: عنوان التصميم، تاريخ ووقت الإرسال للتصميم، تاريخ
  ووقت رفع التصميم للاعتماد، تاريخ ووقت النشر، لينك النشر.
- **تقرير الأداء - الأرشيف**: صف واحد لكل مادة اتنشرت — رحلتها كاملة
  (فكرة → تصميم → نشر) + **إجمالي وقت الرحلة** + **وقت كل مرحلة على حدة**،
  محسوبين تلقائياً من `content_items.stage_history`.

المنطق كله في `apps-script/Code.gs` (`handleLog_`, `getOrCreateTrackingSheet_`,
`upsertTrackingRow_`, `computeDurations_`) و`drive.js` (`logIdea`,
`logDesignSent`, `logDesignUploaded`, `logPublished`) — الاستدعاءات
الفعلية في `render-production.js`/`render-review.js`/`render-design.js`
عند كل انتقالة مهمة. التسجيل دا **عملية خلفية غير حرجة**: لو الجسر لسه
مش متظبط أو حصل خطأ شبكة، بيتجاهل بهدوء وميوقفش سير العمل الأساسي.

⚠️ **ملاحظة ملكية**: الفولدرات الفرعية التلاتة اتعملت من حساب
`mohamadmh32@gmail.com` (المتصل بـ Claude) جوه فولدر جذر ملك
`swnwclinics@gmail.com` — مش مشكلة أمنية (الفولدر الجذر نفسه ملك حساب
المركز ومشارك)، لكن لو حبيت ملكية 100% لحساب المركز، ينشئوا يدوياً من
نفس الحساب بدل الاتنين دول.

---

## الهوية البصرية

نفس هوية Swnw في كل الأنظمة — **لا تغييرها بلا رجوع لملف الهوية
المركزي** (`Website/AGENTS.md`).

- الخطوط: `"Hiragino Kaku","BigVesta Arabic",system-ui,Tahoma,sans-serif`
  — ملفات WOFF2 محلية، ممنوع أي خط من Google Fonts
- الألوان: الأساسي `#0F369D` · التنبيه `#F15A22` · النص الداكن `#16212E`
  · الإيجابي `#2F7D5C` · السلبي `#D0402A`
- الاسم بالإنجليزي دايماً `Swnw` — لا `Sono` في أي نص يراه المستخدم

---

## ⚠️ قواعد لا تُكسر

1. **`config.js` لا تُعِد كتابته بالكامل** — فيه مفاتيح Supabase الحقيقية.
   عدّل سطراً بعينه فقط.
2. **بصمة الكاش `?v=N`** على كل `<script>`/`<link>` في `index.html` —
   ترفع مع أي تعديل JS/CSS، وإلا المستخدم هيشوف نسخة قديمة. الرقم الحالي: `23`.
3. **مفاتيح `stage` الثمانية ثابتة** — أي تغيير يكسر الحارس في SQL وكل
   منطق العرض.
4. **`guard_content_transition()`** هو مصدر الحقيقة لصلاحيات الانتقال —
   عدّله في `setup.sql` وطبّقه فعلياً في القاعدة، مش بس في الواجهة.
5. **الخصوصية**: هذا نظام محتوى تسويقي، لا علاقة له ببيانات المرضى —
   لا تُدخل أي بيانات مريض هنا أبداً.

---

## اختبار

بلا متصفح حقيقي في الساندبوكس → jsdom مع Supabase مموّه بالكامل:

```bash
npm install jsdom   # مرة واحدة
node test/smoke.js
```

يغطّي: شاشة الدخول، الشِل العام والتابات حسب الدور، الملخص العام،
الأرشيف (الكالندر)، Kanban السبع أعمدة.

**بعد أي تعديل**: شغّل `test/smoke.js`، وارفع بصمة الكاش، وتأكد يدوياً
من الرابط اللايف (سكرين شوت) قبل ما تقول للمستخدم "خلصت".

---

## حالة المشروع وتاريخ التطوير الكامل

كل تاريخ التطوير التفصيلي (كل فيتشر/إصلاح بتفاصيله الكاملة، من أغسطس ٢٠٢٦
لحد دلوقتي) اتنقل لمشروع Claude المرتبط بهذا الشات ("SSMPD - Swnw Social
Media Prduction Dashboard") — عشان الملف هنا يفضل خفيف وأي شات جديد
يقدر يبدأ بسرعة من غير ما يحمّل تاريخ كامل مش محتاجه دايمًا.

**استخدم `project_search`/`project_read` في مشروع Claude** بدل قراءة أي
ملف تاريخي هنا. ابدأ بقراءة `changelog/00-index.md` في المشروع — فيه فهرس
بالملفات الستة وموضوع كل واحد (أرشيف مرضى/ليدز، تقارير طبية/Echo/أسنان/
علاج طبيعي، Meta Ads/Content Intelligence/Media Buyer، الحسابات ومراجعات
معمارية، إلخ). لو عندك سؤال عن فيتشر بعينه أو بلاغ باگ في حاجة قديمة،
دوّر بـ`project_search` بكلمة من اسم الفيتشر قبل أي حاجة تانية.

**الحالة الحالية باختصار** (آخر تحديث ٢٠٢٦-٠٩-٠٩): كل الموديولات شغالة
لايف — SSMPD الأساسية (إنتاج محتوى/اعتماد/تصميم/نشر/أرشيف)، أرشيف
المرضى، إدارة الليدز، الحسابات، إعلانات Meta Ads، Content Intelligence،
Media Buyer Control Center (اعتماد بشري + Worker محلي observability)،
Meta Auto Publisher (قسم ٤٣ — محتاج خطوات نشر يدوية من المستخدم لسه).
بصمة الكاش الحالية لكل ملف موجودة في `index.html` نفسه — شوفه مباشرة لو
محتاج تعرف آخر رقم `?v=`.

**لو بتعمل تعديل جديد**: اتبع نفس آلية الإصدارات (قسم "آلية الإصدارات"
فوق)، وسجّل التفاصيل الكاملة في مشروع Claude (`project_write` لملف جديد
أو إضافة لملف الشهر/الموضوع المناسب) بدل ما تضيفها هنا في CLAUDE.md —
الملف ده دلوقتي مخصص للبنية/القواعد الثابتة بس، مش changelog.
