-- Rollback for 20261125140000_family_card_legacy_visits.sql: family_visits back to new-system visits only; the old-system
-- entries, approvals and config are dropped (their audit rows stay in clinic_reception.audit).
do $$ declare d text; begin
  if to_regclass('clinic_reception.family_legacy_saved') is null then raise exception '20261125140000 مش متطبّق'; end if;
  select def into d from clinic_reception.family_legacy_saved where name = 'family_visits';
  execute d;
end $$;
revoke all on function clinic_reception.family_visits(uuid, uuid) from public, anon, authenticated;
drop function public.clinic_reception_family_legacy_review(uuid, boolean, text);
drop function public.clinic_reception_family_legacy_pending();
drop function public.clinic_reception_family_legacy(uuid, text, jsonb);
drop function clinic_reception.family_legacy_row(clinic_reception.family_legacy_visits);
drop function clinic_reception.family_legacy_role();
drop function clinic_reception.family_legacy_count(uuid);
drop table clinic_reception.family_legacy_approvals;
drop table clinic_reception.family_legacy_visits;
drop table clinic_reception.family_legacy_config;
drop table clinic_reception.family_legacy_saved;
