# Service orders, providers, referral and reports — design (Claude Code, 2026-11-06)
Status: DESIGN ONLY. No migration applied, no production change, no merge. Built on PR #335 head 45fa172.

## Owner/accountant decisions (chat, 2026-11-06)
- One invoice per department (consult / labs / radiology / medicines+supplies); many lines per invoice (serial column).
- Labs: open to all requesting doctors. Radiology: any doctor may request; the PERFORMING doctor is limited per service (e.g. EEG one doctor; ultrasound for OBGYN/internal medicine; doppler/echo for vascular/cardiology). Referring doctor and performing doctor are separate fields; referral optional (walk-in = center case).
- Ultrasound invoice is a "radiology" invoice; claim "service type" = radiology; shows performing doctor + specialty.
- Referral commission: computed on the NET amount, rate differs by service type (consult/follow-up/consultation, radiology, labs); set when the doctor is registered; posts automatically to the doctor account; services only, never medicines/supplies.
- Medicines/supplies: patient pays in full with no discount unless the service is marked as including them (then patient share 0); some contracts allow a patient share percentage.
- Services are linked to SPECIALTIES; doctors to a specialty (+grade); reception shows the doctor's services.
- Reception order types: service/consult, radiology request, labs request, medicines+supplies request. Labs/radiology: internal (center department, staff added at contract) or external (provider added at contract).
- Pricing: external lab sends a cost price list; center pays the lab that cost; selling price = the center price list for the year. Internal radiology = center price list. External radiology = agreed percentage of the amount the patient pays.
- Who bills the patient is who files the insurer claim.
- External providers get a daily board: referred / scheduled / attended / cancelled / service done. Provider sees only own cases; minimum data: patient name + phone (+ requested service, date).
- Provider uploads the report -> attaches to the patient file -> patient sees it in the Sono patient portal. Reports go to the patient directly after upload (no doctor review; keep a per-type switch).
- Notification: email only unless WhatsApp has no extra cost (Meta billing). WhatsApp is last and needs explicit approval after checking Meta pricing. Message carries no medical detail; the link opens the portal after verification.

## Model: one "service order" object
order(type lab|radiology|medicine|service, mode internal|external, provider_id, referring_doctor_id, performing_doctor_id, status, billing_party center|provider, price_center, cost_or_share, invoice_id, report_file_id)
status: referred -> scheduled -> attended | cancelled | no_show -> done -> report_uploaded -> patient_notified.

## Accounting rules (to confirm items marked ?)
- billing_party=center: appears on the patient invoice; center files the insurer claim; provider payable = lab cost (labs) or provider share % of paid amount (radiology external).
- billing_party=provider: NOT on the center patient invoice; provider files the claim; center receivable = center share % of the amount collected.
- ? Whether external lab lines show on the patient invoice at the center price (provider name hidden) — assumed: yes when center bills.
- Referral commission posts per order from net, rate by service type, services only.

## Steps (each on staging with synthetic data first)
1. Rules and data: service<->specialty, performer allow-list, order object, referring doctor + rates, department invoices (tests; extends proposals/doctor-insurance-20261105 helpers).
2. Reception UI. 3. Accounting (commission, payables/receivables). 4. Provider board + report upload. 5. Patient portal + notification (email first).

## Security
Provider role with RLS (own cases only), private storage with expiring links, audit on every open, upload type/size limits. Any DB migration is written for review, not applied by Claude.
