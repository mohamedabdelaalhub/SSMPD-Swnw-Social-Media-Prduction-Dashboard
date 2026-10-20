# Account statements and treasury vouchers

The account statement reads posted `clinic_finance.entries` and `lines`, independently of the 200-row finance snapshot. A selected parent expands through `account_config.parent_code`, never code prefixes. Each journal line contributes once. Internal transfers inside a selected parent can appear on both subsidiary accounts but cancel in the parent's net balance.

The server calculates opening before the selected period, full-period debit/credit and closing, and each running balance before paging. Ordering is business date, event number, entry UUID and account. The first response captures an event-number watermark. Subsequent pages and full print/CSV reuse it. CSV protects textual cells from spreadsheet formulas. All export pages are requested explicitly, 500 rows each, with filters locked during export. No polling or file storage.

Entry actions preserve the existing source router. New cash vouchers open their saved document, including gross, withholding, net, recipient, branch/cost-centre text, creator and reviewer. Print includes approval status. Branch is descriptive metadata, not a new ledger dimension, and historical entries without branch metadata show an empty marker.

New generic vouchers are cash-only, require the creator's open main-treasury shift, and remain pending until another authorized reviewer approves. Gross is positive, withholding is nonnegative and less than gross, and values have two decimals. The existing cash-availability guard, period lock, register direction, ledger line guard and global lock are reused. The withholding balance posts to existing account 2141 and the cash line contains only the net. Rejected/pending vouchers do not post. Tokens are idempotent with original-payload comparison. References are unique.

Operational accounts and their descendants retain their source workflows. The selector shows active movement accounts and routes doctors, suppliers, payroll, bank, stock, tax and other controlled accounts to those sections. The server blocks bypass, including system posting accounts and bound treasury accounts. A generic voucher is not a substitute for a patient collection, doctor payout, supplier settlement, payroll, bank transfer or opening balance.

The existing doctor payout form gains an editable document-based withholding rate and a live gross/withholding/net preview. The payload remains the existing `clinic_finance_doctor_command('payout', ...)`, preserving doctor balances, review and withholding entries. No fixed tax rate or statutory payment deadline is introduced.

## Access

Reports and source-document lookup require existing financial review permission. Voucher creation requires create permission and a main shift owned by the caller. List returns own vouchers unless the caller has review permission. Independent approval requires review permission. Anonymous calls and direct private-table access are denied. There are no new role grants or exposed private schemas.

Database advisor findings expected by the existing architecture are documented: private `cash_vouchers` has RLS with no direct-access policies, and three authenticated RPCs are SECURITY DEFINER with `require_access` checks and fixed search paths. Private helpers/base router have EXECUTE revoked from public/anon/authenticated.

## Verification

- `tests/account-statements-vouchers.cjs`: more than 200 entries, opening and running totals, parent rollup, frozen pages, receipt, 1000 gross / 50 withholding / 950 cash, independent review, replay, cash limit, precision, controlled-account denial and anonymous/reception denial.
- `tests/account-statements-dom.cjs`: real finance modal helper and treasury request form, paging, all-page print, escaping, tax-rate/amount synchronization, doctor payload, selection and Escape.
- `tests/account-statements-live-rollback.sql`: real existing roles and main treasury through public RPCs, fully rolled back. No persistent financial documents are generated.
- Existing accountant workspace, doctor finance, treasury first-binding, help coverage and help-fields DOM checks.
- Baseline smoke has one existing navigation assertion failure on commit 3388bd1, also reproduced without these changes. No navigation policy changes are included.

The synthetic fixture is `tests/account-statements-fixture.html?release=1`, with 1280/390/320 controls. It cannot persist transactions.
