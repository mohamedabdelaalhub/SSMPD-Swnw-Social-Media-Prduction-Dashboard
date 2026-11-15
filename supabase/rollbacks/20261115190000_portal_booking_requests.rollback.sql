-- Rollback: redeploy the previous patient-portal-booking first (direct booking), then drop.
-- Pending requests in the table are lost: export/handle them before running this.
begin;
drop trigger if exists ppbr_enforce_limit on public.patient_portal_booking_requests;
drop function if exists public.ppbr_enforce_limit();
drop table if exists public.patient_portal_booking_requests;
commit;
