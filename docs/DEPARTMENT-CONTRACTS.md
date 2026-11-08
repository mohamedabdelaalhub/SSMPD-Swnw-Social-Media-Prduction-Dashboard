# Department-scope doctor contracts

Draft PR. **Not applied to production.** Migration `20261108230000_department_contracts.sql`, rollback `supabase/rollbacks/20261108230000_department_contracts.rollback.sql`.

## ما الجديد (للمحاسب)

- في الحسابات ← الأطباء والأتعاب ← «إضافة عقد»: حقل **نطاق العقد**: «خدمة محددة» (كما كان) أو **«كل خدمات قسم»** مع قائمة بالأقسام الموجودة فعلًا.
- عقد القسم الواحد يغطي كل خدمات القسم (مثال: الأسنان) بدل عقد لكل خدمة (1391 خدمة).
- **عقد الخدمة المحددة له الأولوية** على عقد القسم لنفس الطبيب. عقد القسم يسري فقط على الخدمات التي ليس للطبيب فيها عقد خدمة خاص.
- **المعامل والطوارئ** لا يدخلان تحت عقد قسم آخر أبدًا، ولا يمكن إنشاء عقد لقسم منهما إلا بتأكيد صريح في النموذج.
- الاعتماد كما هو: منشئ العقد لا يعتمده، يحتاج سببًا مكتوبًا، ولا يوجد اعتماد تلقائي.
- لا يتغير حساب الأتعاب ولا الفواتير القديمة ولا قنوات/خصومات PR #355.

## Design

- Storage format in `clinic_finance.doctor_contracts.service_scope`: `قسم:<department>` (no space after the colon, department text exactly as in `clinic_reception.services.department` / `pricing_services.category`). Everything else is an exact service code/name as before. **No table or column change.**
- `public.clinic_finance_doctor_command` is moved to `clinic_finance.doctor_command_before_departments` and wrapped: for `contract` with a `قسم:` scope it validates the format, that the department exists (`clinic_finance.contract_departments()`), and that labs/emergency (`department_restricted`: معمل|مختبر|تحاليل|طوار) carry `allow_restricted = true`; then it delegates unchanged (same payload, token idempotency, maker-checker, overlap check). The existing overlap check already compares `doctor_key + service_scope` exactly, so two active contracts for the same doctor and the same department cannot overlap; different departments (or a department + an exact service) can coexist.
- `clinic_finance.doctor_contract_for_service(doctor, code, name, department, on_date)`: exact code/name contracts first; only if none, the department contract (restricted departments only when the contract carries `allow_restricted`, defence in depth).
- `clinic_reception.sync_doctor_contract` (reception execution): identical function except it resolves the contract with the resolver above; behaviour for exact contracts is unchanged.
- `public.pricing_doctor_contracts()`: same output plus `scope_kind` (`service|department`) and `department`.
- `public.clinic_finance_contract_departments()`: department list for the form (`name`, `restricted`).
- JS: contract form (`finance-doctors.js`), readable labels in the contracts table / invoice picker, service editor (`render-accounting.js`) auto-selects a department contract when the service's department matches and no exact contract exists.
- `doctor_sync`, `doctor_bill_base`, `channel_*` are **not replaced**: a bill copies the chosen contract's terms into `doctor_allocations`, so department contracts need no change there.

## Limitations

1. The reception pilot/native cut-over pickers (`native_doctor_options`, doctor selection by department in the management pilot) still list only doctors that have a per-service contract; a doctor with only a department contract is resolved at execution (`sync_doctor_contract`) and in the accounting invoice, but is not offered by those two reception pickers yet (follow-up).
2. Invoice contract picking is still manual by id; an invoice has no single service, so the picker lists all active contracts (department ones labelled «كل خدمات قسم …»).
3. A department contract must use `base_scope = service` and `deduction none|cost` to be usable by reception execution (existing rule).
4. Department text is matched exactly; a renamed department needs a new contract (or an exact-text rename).
5. The restricted list is a name pattern (`معمل|مختبر|تحاليل|طوار`), not a table.

## Tests

`node tests/department-contracts-sql.cjs` (real finance migrations + channels on PGlite, reception stubs, byte-identical rollback of every replaced function), `node tests/department-contracts-dom.cjs`.
