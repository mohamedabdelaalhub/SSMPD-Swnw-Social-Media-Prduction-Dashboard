# Doctor payout Phase 2 - UI notes (2026-11-08)

New file `assets/js/finance-doctor-payout.js` (loaded after finance-channels.js in index.html) adds tax %, withholding %, a computed read-only withheld amount, a net line and a payable-now cap hint to the existing payout form, and gates the payout review button. It does NOT edit finance-doctors.js.

## One-line optional patch to `assets/js/db.js` (not applied here: db.js belongs to the statement branch)
Put next to `financeDoctorCommand` (line ~1352). Without it everything works except the "payable now" hint and the client-side review gate; the server enforces both anyway.

    financeDoctorPayable: function(key){return handle(client.rpc(clinic_finance_doctor_payable,{p_key:key||null}));},

## Release order
1. Release the dashboard (extra payload keys are ignored by the old DB).
2. Apply migration `20261108260000_doctor_payout_phase2.sql` (after local Docker rehearsal + backup, owner approval).
Rollback: `supabase/rollbacks/20261108260000_doctor_payout_phase2.rollback.sql`.
