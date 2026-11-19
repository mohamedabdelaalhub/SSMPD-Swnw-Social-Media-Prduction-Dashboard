# Printed money documents — «شكل الفواتير والإيصالات» (owner rule, 2026-11-19)

**Owner, verbatim:** «موافق علي الشكل ودا يبقي شكل اي فاتورة او ايصال دلوقتي او مستقبلا … ومن غير كتابة اسم افضل، كفاية اللوجو بيأدي الغرض مفيش داعي لكتابة سونو … حول المطالبات كمان».

Every invoice, receipt, claim or payout slip the dashboard prints — today or in the future — uses ONE look. No exceptions, no
plain `win.document.write('<h2>…')` sheets.

## The look (approved mockups in `mockups/`)

| Document | Mockup | Renderer |
|---|---|---|
| Visit invoice («فاتورة / إيصال سداد») | `patient-invoice.html` | `assets/js/patient-invoice-print.js` |
| Claim invoice («فاتورة مطالبة») | `claim-invoice.html` | `assets/js/service-invoice-print.js` |
| Single-payment receipt («إيصال سداد») | `payment-receipt.html` | `SSMPDPrint.receiptHtml` (`swnw-print.js`) — used by `finance-cash.js` and `reception-bridge.js` |
| Doctor payout slip («إيصال استلام مستحقات طبيب») | `doctor-payout-receipt.html` | `reception-doctor-payout.js` |
| Entity claims (letter, detailed statement, invoice lines) + entity service invoice | same look, flowing pages | `entity-claims-print.js` |
| Internal finance invoice («فاتورة خدمة») | same look, flowing pages | `finance-controls.js` |

Elements, all from `assets/js/swnw-print.js` (`window.SSMPDPrint`) — CSS mirrors `mockups/_invoice-common.css`:

1. **Paper**: A4, `@page{margin:0}`, the official letterhead `assets/img/swnw-official-letterhead.png` as the full-page background.
   Body area: 44 mm from the top, 52 mm from the bottom, 16 mm sides — nothing may cover the logo band or the footer.
2. **No brand name in any title** — not «سونو», not «Swnw». The logo on the letterhead identifies the centre. Titles name the
   document only («إيصال سداد», «فاتورة خدمة», «مطالبة مالية» …).
3. **Title row** (`P.title`): document name in blue `#0F369D` 22px on the right; its number on the left — small grey label +
   bold orange `#F15A22` number, LTR (`RC-2026-000123`, `INV-2026-000045`, …); 2px blue rule under it.
4. **Facts band** (`P.meta`): light grey `#f4f6fb` rounded box, 3 columns, «label: value». Numbers, dates and codes LTR.
5. **Tables** (`P.table`): blue header row with white bold text, `#c7d0e6` borders, centred cells, the description column
   right-aligned, header repeats on every printed page, rows never split.
6. **Boxes** (`P.kv` inside `.box`): rounded outline, blue small heading, dashed separators; the key amount big and blue;
   the remaining balance red when due, green with the «مسدّدة بالكامل» tag when settled. Amounts also **in words** (`P.words`).
7. **Signatures** (`P.sig`): **no frame**, 92 px high, label in blue on top, a thin line with the name/«الاسم والتوقيع» under it.
   Always «ختم المركز» as the last slot.
8. **Note line**: small grey footnote (currency, print date/time, what the document is and is not).
9. Fonts: local BigVesta only. Colours: the identity palette only.

Layouts: `P.page(body)` for one fixed A4 page (receipts, short invoices); `P.flow(body)` for long documents — the letterhead
repeats on every printed page and table headers repeat (thead/tfoot spacer technique). `P.open(html, win)` prints after the
letterhead image loads; open the window synchronously in the click handler (`P.blank()` / `window.open`) to avoid popup blocking.

## Rule for every new or changed document

- Build it with `SSMPDPrint` (or the two approved renderers). Do not hand-write print HTML/CSS.
- Show the owner a mockup made with these same pieces before coding a new document type.
- Real numbers only: the sequential receipt/invoice number from the database, never a free-typed reference as the main number.
- Add a test that the output contains the letterhead and no brand name (see `tests/swnw-print-dom.cjs`,
  `tests/entity-claims-document-contract.test.cjs`).
- Internal reports (statements, shift movements, inventory lists) are not money documents; they may keep their own layout
  until the owner asks, but must not carry the old «سونو — …» titles either.
