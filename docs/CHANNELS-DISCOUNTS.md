# Channels, platforms and patient discounts — Phase 1

Draft PR. **Not applied to production.** Migration `20261108130000_channels_discounts_p1.sql`, rollback `supabase/rollbacks/20261108130000_channels_discounts_p1.rollback.sql`.

## What changes (للكاشير والمحاسبة)

- **قنوات ومنصات (فيزيتا، اكشف، كلينيدو، كفارة وسلامتك، نادي، نقابة، تليفون، موقع)** تتسجل كقواعد من شاشة المالية ← تبويب الأطباء ← «القنوات والمنصات وخصومات المرضى». لا نسب مكتوبة في الكود.
- كل قاعدة: نسبة خصم للمريض، نسبة حصة القناة، نوع المستحق (لا شيء / عمولة / كاش باك)، تنطبق على الكشف فقط أو على كل شيء، فترة سريان.
- **القاعدة الجديدة لا تسري إلا بعد اعتماد شخص ثانٍ** (غير من أنشأها) مع سبب مكتوب. التعديل = إصدار جديد، والقديم يفضل كما هو في الفواتير القديمة.
- عند إنشاء الفاتورة يختار الكاشير القناة، يكتب إجمالي الكشف وإجمالي الخدمات، والنظام يحسب **المبلغ الذي يدفعه المريض** (للقنوات التعاقدية بعد الخصم). القاعدة تتجمد داخل الفاتورة وقت الحجز؛ تغيير النسب لاحقًا لا يغير فاتورة قديمة.
- حصة القناة تتخصم من إيراد الطبيب قبل حساب نسبته (نفس معامل المراجعة الحالي)، فتظهر في مستحقات الطبيب تلقائيًا.
- **تقرير آخر الشهر**: كم مستحق لكل منصة/جهة (بما فيه كاش باك كفارة وسلامتك) في الشهر، وجدول بكل فاتورة وقاعدتها.
- مصادر الحجز في الاستقبال اتزودت: تليفون، موقع، فيزيتا، اكشف، كلينيدو، كفارة وسلامتك، نادي، نقابة.

## الفواتير القديمة

بدون قناة = نفس الحساب بالظبط. ثُبت باختبار: فواتير وإرجاعات اتسجلت قبل الـmigration، ثم أُعيد الحساب بعدها، فلم يتغير أي مبلغ أو عدد قيود.

## Technical

- `clinic_finance.channel_rules` (maker-checker, versioned, status pending/active/rejected/retired), `clinic_finance.channel_allocations` (one frozen row per invoice).
- AFTER INSERT trigger on invoices reads the channel fields from `bill_payload`; rejects an inactive/out-of-date rule or an amount that does not equal `consultation + services − discount`.
- `clinic_finance.doctor_sync` re-created with an extra `channel_share × revenue / amount` deduction term; the migration has a guard that aborts if the live function is not the expected version (the one with the `returned_deduction` patch of 20261017011033) or if the finance snapshot chain is not complete. The rollback restores the pre-migration definition (same body without the channel term).
- RPC `clinic_finance_channel_command(action, payload, token)`: `create`, `review`, `retire`. The finance snapshot gains `channel_rules`, `channel_allocations`, `channel_payables`.
- Browser rounding is integer-cent half-up to match Postgres `round(numeric)`.

## Limits (by design in Phase 1)

0. `consultation_gross` / `services_gross` are sent by the client and only checked for consistency with the invoice amount; deriving them from the service catalogue is a later phase.
0. A contract has ONE rate per invoice. A mixed consultation + services invoice gets a single rate (e.g. a 50% contract, consultation 100 + services 200 on an external platform: doctor 137.5, while the owner's service rates are 40% or lower). Known Phase-1 limit.

1. One rate set per invoice (a mixed club + platform invoice is not modelled).
2. Payables are a **report only** — no ledger posting or payment tracking yet.
3. The channel is chosen manually on the invoice; auto-linking from the reception appointment source is a follow-up.
4. Open question for the owner: do clubs/syndicates discounts apply to services too, or the consultation only? Configurable per rule through `applies_to` — set on creation.

## Tests

`node tests/channels-sql.cjs` (real finance migrations on PGlite, incl. before/after regression), `node tests/channels-dom.cjs`.
