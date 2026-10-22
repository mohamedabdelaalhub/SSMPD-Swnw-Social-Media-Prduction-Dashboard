# Employee connected booking — 22 October 2026

The existing live workspace remains a connected pilot. Authorized reception and customer-service staff can book, while nursing and physicians can open the workspace without acquiring financial or booking-management permissions. Existing owners, manager membership and finance grants retain their action controls. Legacy writers and automatic messaging settings are unchanged. No real archive identity enters a trial workspace.

Lead details now offer “حجز كشف جديد للمريض” for linked and unlinked leads. The guarded prepare RPC enforces customer-service assignment scope, checks basic patient details, resolves normalized name plus phone under a transaction lock, or accepts an explicitly selected archive file. New records require a two-part name, phone and age. Existing demographics are preserved, with only missing/incomplete basics completed. Lead linking and reception attachment are atomic. Retry uses the same archive/reception identity.

The booking form fixes the prepared patient and carries the originating lead ID even while the optional lead selector is loading. Existing booking command idempotency and shared-record projections provide one appointment in lead/patient history. A booking does not create an invoice, payment or revenue journal. Clinical visits start on arrival, not on booking.

Validation: PGlite integration exercises role denial, assignment scope, basics, phone normalization, duplicate/retry handling, booking attribution and shared archive history. jsdom checks the details-to-booking transition. Live rollback checks test access through actual role identities without persistent test transactions. Broad smoke has the existing social-tabs assertion failure. Browser preview uses synthetic records and no live database connection.

At inspection, production had two enabled booking services, zero linked active providers and zero future availability entries. Staff cannot select real appointments until management links approved physician contracts and enters actual availability. No physician identity or schedule is invented by this change.
