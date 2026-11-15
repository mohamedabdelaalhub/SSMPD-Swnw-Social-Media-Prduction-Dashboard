-- Rollback of 20261115150000_patient_portal_anon_hardening.
-- Restores the pre-migration (Supabase default) grants observed live on 2026-11-15.
-- Only use if something legitimate breaks; it re-opens anon privileges (RLS stays on).
begin;
grant execute on function public.approve_patient_identity_verification(uuid) to public, anon;
grant execute on function public.reject_patient_identity_verification(uuid, text) to public, anon;
grant execute on function public.revoke_patient_account_access(uuid, text, text) to public, anon;
grant execute on function public.patient_portal_service_reports() to public, anon;
grant all on table
  public.patient_accounts, public.patient_account_access, public.patient_identity_verifications,
  public.patient_verification_documents, public.patient_system_links, public.patient_portal_visibility,
  public.patient_portal_audit_log, public.patient_activation_codes,
  public.patient_nutrition_meal_completions, public.patient_visits
to anon;
commit;
