# Doctor contracts: department scope, many services at once, and one rate per service line

Draft PR. **Not applied to production.** Two additive migrations, each with a rollback:

| Migration | Rollback | What it adds |
|---|---|---|
| `20261108230000_department_contracts.sql` | `supabase/rollbacks/20261108230000_department_contracts.rollback.sql` | department-scope contracts, batch contract creation / review, service list |
| `20261108231000_doctor_service_lines.sql` | `supabase/rollbacks/20261108231000_doctor_service_lines.rollback.sql` | per-service-line doctor fee allocation on an invoice |

Order: `…230000` → (`20261108130000_channels_discounts_p1.sql` if/when PR #355 is applied) → `…231000`.

## ما الجديد (للمحاسب)

- **نطاق العقد** في «إضافة عقد»: «خدمة محددة» أو **«عدة خدمات محددة بنفس النسبة»** (بحث + تحديد متعدد؛ نسبة واحدة تنشئ عقدًا لكل خدمة، كلها بانتظار الاعتماد وتُعتمد معًا بزر «مراجعة المجموعة») أو **«كل خدمات قسم»**.
- **عقد الخدمة المحددة له الأولوية** على عقد القسم لنفس الطبيب.
- **لا استثناء للمعامل والأشعة والطوارئ**: هي أقسام عادية. الحماية من عقد خاطئ هي الاعتماد من شخص آخر بسبب مكتوب (كما كان).
- **فاتورة بأكثر من خدمة بنسب مختلفة**: في نموذج الفاتورة، اختر الطبيب في «توزيع الخدمات على الطبيب» وأدخل سطر لكل خدمة (كود/اسم + قيمة، وعلامة «كشف» لسطر الكشف). كل سطر يأخذ نسبة عقد خدمته (أو قسمه)، ومجموع الأتعاب = مجموع الأسطر. بدون هذا الاختيار الفاتورة تعمل كما كانت (عقد واحد).

## Why a new table (what the invoice stored)

Before this change an invoice stored one total (`clinic_finance.invoices.amount`), the stock lines (`bill_items`) and ONE doctor contract (`doctor_allocations.contract_id`, one rate). **No per-service detail was kept.** A 40% service and a 30% service on one invoice could not both be honoured, whichever contract the accountant picked.
`clinic_finance.doctor_allocation_lines` (additive, one row per service line: code, name, department, amount, contract, a frozen copy of the contract terms, the line's share of the stock deduction) is the minimal store for the split.

## Design

### Department scope (`…230000`)
- `service_scope = 'قسم:<department>'` (no table change); department names come from `clinic_reception.services.department` ∪ `pricing_services.category`.
- `clinic_finance_doctor_command` is moved to `clinic_finance.doctor_command_before_departments` and wrapped: department scopes are validated (format, department exists), then the unchanged function does the work (same payload, idempotency, maker-checker, overlap check by exact doctor+scope).
- `clinic_finance.doctor_contract_for_service(doctor, code, name, department, on_date)`: exact service contract first, else the department contract (same doctor, active, inside its dates).
- `clinic_reception.sync_doctor_contract` uses that resolver; `pricing_doctor_contracts()` returns `scope_kind` / `department`.
- No labs/emergency guard (removed on purpose).
- Guard: refuses to apply unless `sync_doctor_contract` and `pricing_doctor_contracts` have exactly the audited production md5 (`9940a1df7a26af0005b3dd3b9ab96348`, `2d64788544ad0c556ed070853df21d09`), or if already applied.

### Batch (`…230000`, same wrapper)
- `contract_batch`: the contract payload with `scopes: [...]` instead of `scope`; one pending contract per scope through the unchanged base function in one transaction (all or none); tokens derived from (batch token, scope) so a replay is idempotent. 1–200 scopes, no duplicates.
- `contract_review_batch`: `{ids, approve, note}`; each contract is reviewed by the unchanged base (creator still cannot approve; an overlap on any row rejects the whole batch).
- `clinic_finance_contract_services()`: read-only service list (code, name, department) for the multi-select.

### Per-line allocation (`…231000`)
- `public.clinic_finance_bill` → moved to `clinic_finance.bill_before_lines` and wrapped. **No `service_lines` in the payload ⇒ delegates unchanged.** With `service_lines: [{code, amount, kind?, name?, department?}]` + `doctor_key` (and no `doctor_contract_id`):
  - the lines must sum to the service amount without stock items (`invoice.amount − Σ stock sales`);
  - per line the contract is resolved by `doctor_contract_for_service` (department derived from the service code); **no contract ⇒ the whole bill is rejected** (nothing is saved); several contracts ⇒ rejected;
  - contracts must be on the service (not invoice base) and share the same accrual basis (performed / collected);
  - stock deduction (`cost` / `sale`) is shared across lines by amount, each line using its own contract's deduction kind.
- `clinic_finance.doctor_sync` → moved to `clinic_finance.doctor_sync_base` and wrapped. **An invoice without lines delegates to the base untouched** (so every existing invoice, refund, `returned_deduction` and `channel_share` case computes exactly as before). For invoices with lines, per contract: `greatest(0, base·revenue/amount − greatest(0, deduction − returned share) − channel share·revenue/amount) · rate/100`, summed; collected-basis scaling, rounding and the accrual posting are the same as the base. With one contract this is the base formula (tested for parity incl. refund and platform share).
- Platform (channel) share: taken off the **consultation** lines when the invoice has any (`kind: "consultation"`), otherwise spread over the lines by amount.
- The wrappers get exactly the privileges of the functions they wrap.
- **Guard**: refuses to apply unless `doctor_sync` has the audited production md5 (`e0d8058554453f61b8e2c11a0839e98c`) or is the channels version (channel tables present), and `clinic_finance_bill` / `doctor_bill_base` have the production md5s (`a8aeb2de4795afda4424863bf9170352` / `2661fea092b3a191e0099e5b4f2745b9`).
- **Privileges**: Supabase default privileges grant new public functions to `anon` too, so the wrapper first revokes from `public, anon, authenticated, service_role` and then re-grants exactly the base function's ACL (production: `clinic_finance_bill` = postgres/authenticated/service_role; `doctor_sync` = postgres only). Tested with default privileges simulated.
- **UI gate**: the invoice lines block appears only if `clinic_finance_lines_enabled()` answers true. If the SQL is not deployed the form keeps the old single-contract behaviour (an old `clinic_finance_bill` would otherwise ignore `service_lines` and save the invoice with no doctor allocation).
- Rules enforced per invoice: all line contracts share the same accrual basis **and the same stock-deduction kind**; if a channel applies, the lines flagged `consultation` must add up to the channel's consultation amount.
- The doctor allocations table shows «متعدد (n خدمات)» as the rate for line invoices (`terms.multi_rate`).
- Wrapping order: applying PR #355's channel migration AFTER this one would replace the wrapper (and its own guard would refuse); apply it before. Without channels (production today) `channel_share` is 0.

## Limitations

1. Reception pickers (`native_doctor_options`, pilot doctor selection) still list only doctors with per-service contracts; a department-only doctor is resolved at execution and in accounting invoices (follow-up).
2. Without lines, the invoice contract is still picked manually (one rate for the invoice) — the lines block is the way to mix rates.
3. A service line is identified by its **service code**; its department comes only from `clinic_reception.services` (a department sent by the client is ignored). A code that is not in the catalog is rejected.
4. Platform share attribution for mixed rates is by the rule above (consultation lines first); it is an allocation rule, not stored per line.
5. **Before any rollback of the lines migration, snapshot `doctor_allocations` (`earned`) and `doctor_allocation_lines`**: the rollback keeps the stored splits in `doctor_allocation_lines_rolled_back`; those invoices then fall back to the single contract on their allocation row until corrected.
6. A department contract must be `base_scope = service` and deduction `none|cost` to be used by reception execution (existing rule).

## Tests

- `node tests/department-contracts-sql.cjs`, `node tests/doctor-service-lines-sql.cjs`, `node tests/doctor-service-lines-nochannels-sql.cjs` (production state: no channel tables): real finance migrations on PGlite; byte-identical rollbacks incl. privileges.
- `node tests/department-contracts-dom.cjs`: contract form (single / many / department), group review, invoice lines block.
- The `sync_doctor_contract` / `pricing_doctor_contracts` md5s in the test are for the partial chain loaded there; `clinic_finance_doctor_command`'s md5 in the test slice is not production's (production also carries the `20261017015715` patch).
- Docker rehearsal (PG16, production function definitions): apply, second apply refused, behaviour, rollback byte-identical, re-apply.
